/**
 * Tests RED — POST /names con consecutivo real (feature consecutive_counter).
 *
 * Cubre los Grupos 1 y 2 del design (`progress/consecutive_counter/design.md`,
 * sección "Criterios de aceptación traducibles a tests"):
 *
 *  Grupo 1 — Secuencia del consecutivo (service MOCKEADO, sin Mongo):
 *   - #1 dos peticiones válidas → números crecientes que provienen del service.
 *   - #2 el controller invoca el service con el nombre YA descifrado.
 *   - #3 round-trip sigue devolviendo un número que el front descifra (/^\d+$/).
 *   - #4 fallo de persistencia (service lanza) → 500 internal_error.
 *
 *  Grupo 2 — Validación de longitud ≤ 15 (falla-cerrado):
 *   - #5 nombre descifrado de 16 chars → 400 invalid_payload y el service NO se invoca.
 *   - #6 nombre descifrado de exactamente 15 chars → 200.
 *
 * Estrategia de mock: `counter.service` aún NO existe (RED por módulo ausente).
 * Se mockea `../services/counter.service.js` para (a) inyectar la secuencia sin
 * Mongo y (b) espiar con qué argumento lo invoca el controller. El controller
 * de producción debe importar `createRecord` desde esa ruta para que el mock
 * intercepte.
 *
 * MOTIVO DE FALLO ESPERADO (RED legítimo): hoy el controller usa un `stubCounter`
 * en memoria y NO importa `counter.service`; el módulo mockeado no existe, así
 * que `createRecord` nunca se invoca (aserciones de `toHaveBeenCalledWith`
 * fallan) y la longitud 16 pasa el techo actual de 256 devolviendo 200 en vez
 * de 400. El síncrono/global `stubCounter` tampoco garantiza que el número
 * provenga del service.
 *
 * La privada de test se inyecta vía `CRYPTO_PRIVATE_KEY` ANTES de importar la
 * app; `vi.resetModules()` + import dinámico evita fugas de estado del contador.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  decryptReturnAsFront,
  encryptNameAsFront,
  generateTestKeyPair,
  type TestKeyPair,
} from '../services/__test__/cryptoTestKit.js';

/**
 * Mock del service de consecutivo. `vi.mock` se hoistea; el factory declara la
 * spy que luego reconfiguramos por test. La ruta coincide con el especificador
 * que el controller de producción debe usar para importar `createRecord`.
 */
const createRecordMock = vi.fn<(name: string) => Promise<number>>();
vi.mock('../services/counter.service.js', () => ({
  createRecord: (name: string): Promise<number> => createRecordMock(name),
}));

/** Forma del body de respuesta (Supertest tipa `res.body` como `any`). */
interface NamesBody {
  iv?: string;
  ciphertext?: string;
  error?: string;
}

/** Carga una app fresca con la privada dada inyectada en el entorno. */
async function appWithPrivateKey(privateKeyPem: string): Promise<Express> {
  vi.resetModules();
  vi.stubEnv('CRYPTO_PRIVATE_KEY', privateKeyPem);
  const { createApp } = await import('../app.js');
  return createApp();
}

describe('POST /names — consecutivo real (service mockeado)', () => {
  let keys: TestKeyPair;

  beforeEach(() => {
    keys = generateTestKeyPair();
    createRecordMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('#1 dos peticiones válidas consecutivas devuelven números crecientes provenientes del service', async () => {
    // El service es la fuente del número: devuelve 1 y luego 2.
    createRecordMock.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const app = await appWithPrivateKey(keys.privateKeyPem);

    const env1 = encryptNameAsFront('Ana', keys.publicKeyPem);
    const res1 = await request(app)
      .post('/names')
      .send({ encryptedKey: env1.encryptedKey, iv: env1.iv, ciphertext: env1.ciphertext });
    const body1 = res1.body as NamesBody;

    const env2 = encryptNameAsFront('Luis', keys.publicKeyPem);
    const res2 = await request(app)
      .post('/names')
      .send({ encryptedKey: env2.encryptedKey, iv: env2.iv, ciphertext: env2.ciphertext });
    const body2 = res2.body as NamesBody;

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const n1 = decryptReturnAsFront(
      { iv: body1.iv ?? '', ciphertext: body1.ciphertext ?? '' },
      env1.sessionKey,
    );
    const n2 = decryptReturnAsFront(
      { iv: body2.iv ?? '', ciphertext: body2.ciphertext ?? '' },
      env2.sessionKey,
    );

    expect(n1).toMatch(/^\d+$/);
    expect(n2).toMatch(/^\d+$/);
    // El número proviene del service (1 y 2), no de un stub global.
    expect(Number(n1)).toBe(1);
    expect(Number(n2)).toBe(2);
    expect(Number(n2)).toBeGreaterThan(Number(n1));
    expect(createRecordMock).toHaveBeenCalledTimes(2);
  });

  it('#2 invoca el service con el nombre YA descifrado', async () => {
    createRecordMock.mockResolvedValue(7);
    const app = await appWithPrivateKey(keys.privateKeyPem);
    const env = encryptNameAsFront('Sofía', keys.publicKeyPem);

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext });

    expect(res.status).toBe(200);
    // El service recibe el nombre en claro, no el ciphertext.
    expect(createRecordMock).toHaveBeenCalledTimes(1);
    expect(createRecordMock).toHaveBeenCalledWith('Sofía');
  });

  it('#3 round-trip: 200 con IV nuevo y el front descifra un número (/^\\d+$/)', async () => {
    createRecordMock.mockResolvedValue(42);
    const app = await appWithPrivateKey(keys.privateKeyPem);
    const env = encryptNameAsFront('Marta', keys.publicKeyPem);

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext });
    const body = res.body as NamesBody;

    expect(res.status).toBe(200);
    expect(typeof body.iv).toBe('string');
    expect(typeof body.ciphertext).toBe('string');
    // IV de la vuelta ≠ IV de la ida (misma clave AES, IV nuevo).
    expect(body.iv).not.toBe(env.iv);

    const numero = decryptReturnAsFront(
      { iv: body.iv ?? '', ciphertext: body.ciphertext ?? '' },
      env.sessionKey,
    );
    expect(numero).toMatch(/^\d+$/);
  });

  it('#4 fallo de persistencia (el service lanza) → 500 internal_error', async () => {
    createRecordMock.mockRejectedValue(new Error('mongo caído'));
    const app = await appWithPrivateKey(keys.privateKeyPem);
    const env = encryptNameAsFront('Nora', keys.publicKeyPem);

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext });
    const body = res.body as NamesBody;

    expect(res.status).toBe(500);
    expect(body.error).toBe('internal_error');
  });

  it('#5 nombre descifrado de 16 caracteres → 400 invalid_payload y el service NO se invoca', async () => {
    createRecordMock.mockResolvedValue(1);
    const app = await appWithPrivateKey(keys.privateKeyPem);
    const nombre16 = 'a'.repeat(16); // 16 code units > 15
    expect(nombre16.length).toBe(16);
    const env = encryptNameAsFront(nombre16, keys.publicKeyPem);

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext });
    const body = res.body as NamesBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_payload');
    // Falla-cerrado: no se reserva número ni se persiste.
    expect(createRecordMock).not.toHaveBeenCalled();
  });

  it('#6 nombre descifrado de exactamente 15 caracteres → 200 (límite inclusivo)', async () => {
    createRecordMock.mockResolvedValue(3);
    const app = await appWithPrivateKey(keys.privateKeyPem);
    const nombre15 = 'a'.repeat(15);
    expect(nombre15.length).toBe(15);
    const env = encryptNameAsFront(nombre15, keys.publicKeyPem);

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext });
    const body = res.body as NamesBody;

    expect(res.status).toBe(200);
    expect(createRecordMock).toHaveBeenCalledWith(nombre15);
    const numero = decryptReturnAsFront(
      { iv: body.iv ?? '', ciphertext: body.ciphertext ?? '' },
      env.sessionKey,
    );
    expect(numero).toMatch(/^\d+$/);
  });
});
