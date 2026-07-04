/**
 * Tests RED — endpoints de cifrado sobre `createApp()` (Supertest).
 *
 * Mapeo a "Qué se testea (RED)" del design:
 *  - #1 GET /crypto/public-key → 200 { publicKey: <PEM SPKI>, alg: 'RSA-OAEP-256' }.
 *  - #4 POST /names end-to-end → 200 round-trip completo (front descifra la vuelta).
 *  - #5 POST /names con tag GCM manipulado → 422 decryption_failed.
 *  - #6 POST /names con encryptedKey de OTRA pública → 422 decryption_failed.
 *  - #7 payload incompleto / no base64 → 400 invalid_payload.
 *  - #8 clave privada de env ausente/inválida → 500 crypto_unavailable.
 *
 * La privada de test se inyecta vía `process.env.CRYPTO_PRIVATE_KEY` ANTES de
 * cargar `createApp` (que lee la config de `env`). Se usa `vi.resetModules()` +
 * import dinámico para poder variar la clave por bloque sin fugas de estado.
 *
 * RED esperado: no existen aún ni las rutas ni el service → GET/POST devuelven
 * 404 (Express sin la ruta) en vez de los códigos del contrato.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  decryptReturnAsFront,
  encryptNameAsFront,
  generateTestKeyPair,
  type FrontEnvelope,
  type TestKeyPair,
} from '../services/__test__/cryptoTestKit.js';

/**
 * Formas del body de respuesta. Supertest tipa `res.body` como `any`; se castea
 * a estas interfaces para no acceder a miembros de un `any` (regla
 * `no-unsafe-member-access`). No cambia ninguna aserción.
 */
interface PublicKeyBody {
  publicKey?: string;
  alg?: string;
  error?: string;
}
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /crypto/public-key', () => {
  let keys: TestKeyPair;

  beforeEach(() => {
    keys = generateTestKeyPair();
  });

  it('responde 200 con la pública en PEM SPKI y alg RSA-OAEP-256', async () => {
    const app = await appWithPrivateKey(keys.privateKeyPem);

    const res = await request(app).get('/crypto/public-key');
    const body = res.body as PublicKeyBody;

    expect(res.status).toBe(200);
    expect(body.alg).toBe('RSA-OAEP-256');
    expect(typeof body.publicKey).toBe('string');
    expect(body.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    // El front debe poder cifrar contra esta pública → no PKCS#1.
    expect(body.publicKey).not.toContain('BEGIN RSA PUBLIC KEY');
  });

  it('responde 500 public_key_unavailable si la privada de env es inválida', async () => {
    const app = await appWithPrivateKey('clave-basura-no-pem');

    const res = await request(app).get('/crypto/public-key');
    const body = res.body as PublicKeyBody;

    expect(res.status).toBe(500);
    expect(body.error).toBe('public_key_unavailable');
  });
});

describe('POST /names — round-trip end-to-end', () => {
  let keys: TestKeyPair;

  beforeEach(() => {
    keys = generateTestKeyPair();
  });

  it('descifra el nombre y devuelve el consecutivo cifrado (200) que el front descifra', async () => {
    const app = await appWithPrivateKey(keys.privateKeyPem);
    const env = encryptNameAsFront('Sofía', keys.publicKeyPem);

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext });
    const body = res.body as NamesBody;

    expect(res.status).toBe(200);
    expect(typeof body.iv).toBe('string');
    expect(typeof body.ciphertext).toBe('string');
    // IV de la vuelta ≠ IV de la ida (misma clave AES, IV nuevo).
    expect(body.iv).not.toBe(env.iv);

    // El front descifra la vuelta con la clave de sesión que él mismo generó.
    const numero = decryptReturnAsFront(
      { iv: body.iv ?? '', ciphertext: body.ciphertext ?? '' },
      env.sessionKey,
    );
    expect(numero).toMatch(/^\d+$/); // consecutivo stub: un número
  });

  it('devuelve 422 decryption_failed si el tag GCM del nombre fue manipulado', async () => {
    const app = await appWithPrivateKey(keys.privateKeyPem);
    const env = encryptNameAsFront('Nadia', keys.publicKeyPem);
    const raw = Buffer.from(env.ciphertext, 'base64');
    raw[0] ^= 0xff; // corromper el ciphertext → el tag no valida
    const tampered = raw.toString('base64');

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: tampered });

    expect(res.status).toBe(422);
    expect((res.body as NamesBody).error).toBe('decryption_failed');
  });

  it('devuelve 422 decryption_failed si encryptedKey fue envuelta con OTRA pública', async () => {
    const app = await appWithPrivateKey(keys.privateKeyPem);
    const otherKeys = generateTestKeyPair();
    const env = encryptNameAsFront('Iker', otherKeys.publicKeyPem);

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext });

    expect(res.status).toBe(422);
    expect((res.body as NamesBody).error).toBe('decryption_failed');
  });

  it('devuelve 400 invalid_payload si falta un campo del body', async () => {
    const app = await appWithPrivateKey(keys.privateKeyPem);
    const env = encryptNameAsFront('Bea', keys.publicKeyPem);

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: env.encryptedKey, iv: env.iv }); // sin ciphertext

    expect(res.status).toBe(400);
    expect((res.body as NamesBody).error).toBe('invalid_payload');
  });

  it('devuelve 400 invalid_payload si un campo no es base64', async () => {
    const app = await appWithPrivateKey(keys.privateKeyPem);
    const env: FrontEnvelope = encryptNameAsFront('Gael', keys.publicKeyPem);

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: '!!!no-base64!!!', iv: env.iv, ciphertext: env.ciphertext });

    expect(res.status).toBe(400);
    expect((res.body as NamesBody).error).toBe('invalid_payload');
  });

  it('devuelve 500 crypto_unavailable si la privada de env es inválida', async () => {
    const app = await appWithPrivateKey('clave-basura-no-pem');
    // Sobre bien formado, pero el back no puede cargar su privada.
    const goodKeys = generateTestKeyPair();
    const env = encryptNameAsFront('Zoe', goodKeys.publicKeyPem);

    const res = await request(app)
      .post('/names')
      .send({ encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext });

    expect(res.status).toBe(500);
    expect((res.body as NamesBody).error).toBe('crypto_unavailable');
  });
});
