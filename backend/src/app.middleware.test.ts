/**
 * Tests RED — endurecimiento de `createApp()` (feature backend_hardening).
 *
 * Cubre, sobre Supertest contra `createApp()`, la acceptance de:
 *  - CORS por allowlist (ADR 15.1/15.2): origen permitido refleja la cabecera;
 *    origen NO permitido no la incluye (y NO revienta con 500); preflight OPTIONS
 *    de /names anuncia POST y GET.
 *  - helmet activo (ADR 15.3): cabeceras de seguridad en cualquier respuesta.
 *  - express-rate-limit en POST /names (ADR 15.7): superar el límite → 429 con
 *    el MISMO contrato JSON `{ error, message }` que el resto de la API (no el
 *    HTML por defecto del limitador).
 *
 * MOTIVO DE FALLO ESPERADO (RED legítimo): hoy `app.ts` solo monta
 * `express.json()` + routers. No hay `helmet`, ni `cors` con allowlist, ni
 * rate-limit, así que:
 *  - la cabecera `access-control-allow-origin` no aparece para el origen permitido,
 *  - no hay `x-content-type-options` de helmet,
 *  - el preflight `OPTIONS /names` cae al 404 de Express (no anuncia métodos),
 *  - todas las peticiones a /names devuelven 200/4xx del contrato, nunca 429.
 * Es el RED que el implementer cerrará montando los middlewares del diseño.
 *
 * CONTRATO CON EL IMPLEMENTER (rate-limit): el techo del limitador debe ser
 * configurable por entorno vía `RATE_LIMIT_MAX` (leído en `env.ts`), para que
 * este test fije un límite bajo (2) y no dependa del valor de producción ni
 * dispare miles de requests reales. Sin esa var el test es imposible de hacer
 * determinista; se documenta en `progress/backend_hardening/tests.md`.
 *
 * La app se carga con `vi.resetModules()` + import dinámico DESPUÉS de fijar las
 * envs (CORS_ORIGINS, RATE_LIMIT_MAX, CRYPTO_PRIVATE_KEY) porque `env.ts` las lee
 * al importarse. El `counter.service` se mockea para no arrancar Mongo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  encryptNameAsFront,
  generateTestKeyPair,
  type TestKeyPair,
} from './services/__test__/cryptoTestKit.js';

/** Origen que SÍ estará en la allowlist del test. */
const ALLOWED_ORIGIN = 'https://elektra.garcia3apps.com';
/** Origen que NO estará en la allowlist. */
const DENIED_ORIGIN = 'https://evil.example';

/**
 * El consecutivo se persiste en Mongo vía `createRecord`. Sin conexión, Mongoose
 * haría buffering y colgaría el test hasta el timeout. Mockeamos el borde (el
 * service) devolviendo un número resuelto: el foco de este archivo son los
 * middlewares, no la lógica de contador ni de cifrado.
 */
vi.mock('./services/counter.service.js', () => ({
  createRecord: vi.fn().mockResolvedValue(1),
}));

/**
 * Carga una app fresca con las envs de hardening ya fijadas. `env.ts` lee
 * CORS_ORIGINS / RATE_LIMIT_MAX / CRYPTO_PRIVATE_KEY al importarse, así que hay
 * que stubear ANTES del import dinámico.
 */
async function loadApp(options: {
  corsOrigins?: string;
  rateLimitMax?: string;
  privateKeyPem: string;
}): Promise<Express> {
  vi.resetModules();
  if (options.corsOrigins !== undefined) vi.stubEnv('CORS_ORIGINS', options.corsOrigins);
  if (options.rateLimitMax !== undefined) vi.stubEnv('RATE_LIMIT_MAX', options.rateLimitMax);
  vi.stubEnv('CRYPTO_PRIVATE_KEY', options.privateKeyPem);
  const { createApp } = await import('./app.js');
  return createApp();
}

describe('createApp — CORS por allowlist', () => {
  let keys: TestKeyPair;

  beforeEach(() => {
    keys = generateTestKeyPair();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refleja access-control-allow-origin cuando el Origin está en la allowlist', async () => {
    const app = await loadApp({ corsOrigins: ALLOWED_ORIGIN, privateKeyPem: keys.privateKeyPem });

    const res = await request(app).get('/health').set('Origin', ALLOWED_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('NO incluye access-control-allow-origin para un Origin fuera de la allowlist (y no da 500)', async () => {
    const app = await loadApp({ corsOrigins: ALLOWED_ORIGIN, privateKeyPem: keys.privateKeyPem });

    const res = await request(app).get('/health').set('Origin', DENIED_ORIGIN);

    // El servidor procesa la request (no la convierte en 500); solo omite la
    // cabecera CORS → el navegador bloqueará la lectura de la respuesta.
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight OPTIONS /names desde un Origin permitido anuncia POST y GET', async () => {
    const app = await loadApp({ corsOrigins: ALLOWED_ORIGIN, privateKeyPem: keys.privateKeyPem });

    const res = await request(app)
      .options('/names')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    // Preflight exitoso: 204 (o 200) y anuncio de métodos permitidos.
    expect([200, 204]).toContain(res.status);
    const allowMethods = (res.headers['access-control-allow-methods'] ?? '').toUpperCase();
    expect(allowMethods).toContain('POST');
    expect(allowMethods).toContain('GET');
  });

  it('una petición SIN header Origin (curl/same-origin) se procesa normal', async () => {
    const app = await loadApp({ corsOrigins: ALLOWED_ORIGIN, privateKeyPem: keys.privateKeyPem });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
  });
});

describe('createApp — helmet activo', () => {
  let keys: TestKeyPair;

  beforeEach(() => {
    keys = generateTestKeyPair();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('añade x-content-type-options: nosniff a las respuestas', async () => {
    const app = await loadApp({ corsOrigins: ALLOWED_ORIGIN, privateKeyPem: keys.privateKeyPem });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    // Cabecera estable de helmet (no depende de HTTPS, a diferencia de HSTS).
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('createApp — rate limit en POST /names', () => {
  let keys: TestKeyPair;

  beforeEach(() => {
    keys = generateTestKeyPair();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('devuelve 429 cuando se supera el límite de peticiones (RATE_LIMIT_MAX=2)', async () => {
    // Límite bajo inyectado por entorno → determinista y rápido (no miles de reqs).
    const app = await loadApp({
      corsOrigins: ALLOWED_ORIGIN,
      rateLimitMax: '2',
      privateKeyPem: keys.privateKeyPem,
    });
    const agent = request.agent(app);

    async function postName(): Promise<import('supertest').Response> {
      const env = encryptNameAsFront('Ana', keys.publicKeyPem);
      return agent
        .post('/names')
        .send({ encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext });
    }

    const r1 = await postName(); // dentro del límite
    const r2 = await postName(); // dentro del límite
    const r3 = await postName(); // supera el límite → debe cortar

    expect(r1.status).not.toBe(429);
    expect(r2.status).not.toBe(429);
    expect(r3.status).toBe(429);

    // El 429 respeta el MISMO contrato que el resto de la API: JSON
    // `{ error, message }`, no el HTML por defecto de express-rate-limit.
    expect(r3.headers['content-type']).toContain('application/json');
    const body = r3.body as { error?: string; message?: string };
    expect(typeof body.error).toBe('string');
    expect(typeof body.message).toBe('string');
  });
});
