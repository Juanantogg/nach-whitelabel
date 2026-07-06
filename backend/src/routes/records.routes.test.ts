/**
 * Tests RED — GET /records (feature records_list).
 *
 * Deriva de `progress/records_list/design.md` §"Criterios de aceptación
 * traducibles a tests", criterios de backend 1-4 y 6:
 *
 *   #1 service devuelve 2 registros → 200 y body = array de esos registros en el
 *      orden que devuelve el service (desc).
 *   #2 service devuelve [] → 200 y body [].
 *   #3 service hace throw → 500 { error: 'internal_error' } (sin stack/detalle).
 *   #4 la respuesta no incluye _id, __v ni updatedAt (solo lo que da el service).
 *   #6 /records NO está rate-limitado: N > rateLimitMax peticiones siguen dando
 *      200 (a diferencia de /names, que sí lo está).
 *
 * Estrategia de mock: idéntica a `names.routes.test.ts`/`voice.routes.test.ts`.
 * Se mockea el service `record.service` (borde: la base de datos) con una spy
 * `listRecordsMock` reconfigurable por test, y se monta la app real con
 * `createApp()` vía import dinámico. El especificador coincide con el que el
 * controller de producción deberá usar para importar `listRecords`.
 *
 * MOTIVO DE FALLO ESPERADO (RED legítimo): aún NO existen `records.routes.ts`,
 * `records.controller.ts` ni el montaje `app.use('/records', ...)` en `app.ts`.
 * Express responde 404 a `GET /records` en vez de 200/500 del contrato, y el
 * service mockeado nunca se invoca.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/** Forma del item que devuelve el service (design: { sequence, name, createdAt }). */
interface RecordListItem {
  sequence: number;
  name: string;
  createdAt: string;
}

/**
 * Mock del service de records. `vi.mock` se hoistea; la spy se reconfigura por
 * test. La ruta coincide con el especificador que el controller de producción
 * debe usar para importar `listRecords`.
 */
const listRecordsMock = vi.fn<() => Promise<RecordListItem[]>>();
vi.mock('../services/record.service.js', () => ({
  listRecords: (): Promise<RecordListItem[]> => listRecordsMock(),
}));

/** Forma del body de respuesta (Supertest tipa `res.body` como `any`). */
interface RecordsErrorBody {
  error?: string;
}

/** Privada cualquiera: /records no la usa, pero createApp la lee al construirse. */
const ANY_PRIVATE_KEY = 'no-importa-para-records';

/**
 * Carga una app fresca. `rateLimitMax` opcional para el test de "no rate-limit":
 * fijándolo bajo (p.ej. 2) probamos que /records lo IGNORA aunque /names no.
 */
async function loadApp(opts: { rateLimitMax?: number } = {}): Promise<Express> {
  vi.resetModules();
  vi.stubEnv('CRYPTO_PRIVATE_KEY', ANY_PRIVATE_KEY);
  if (opts.rateLimitMax !== undefined) {
    vi.stubEnv('RATE_LIMIT_MAX', String(opts.rateLimitMax));
  }
  const { createApp } = await import('../app.js');
  return createApp();
}

const DOS_REGISTROS: RecordListItem[] = [
  { sequence: 42, name: 'Juan', createdAt: '2026-07-05T10:12:00.000Z' },
  { sequence: 41, name: 'Ana', createdAt: '2026-07-05T10:08:00.000Z' },
];

describe('GET /records — listado de registros (service mockeado)', () => {
  beforeEach(() => {
    listRecordsMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('#1 service devuelve 2 registros → 200 con el array en el orden del service (desc)', async () => {
    listRecordsMock.mockResolvedValue(DOS_REGISTROS);
    const app = await loadApp();

    const res = await request(app).get('/records');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(DOS_REGISTROS);
    // Orden descendente preservado tal cual lo entrega el service.
    const body = res.body as RecordListItem[];
    expect(body.map((r) => r.sequence)).toEqual([42, 41]);
    expect(listRecordsMock).toHaveBeenCalledTimes(1);
  });

  it('#2 service devuelve [] → 200 con body []', async () => {
    listRecordsMock.mockResolvedValue([]);
    const app = await loadApp();

    const res = await request(app).get('/records');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('#3 el service lanza → 500 { error: "internal_error" } sin stack ni detalle interno', async () => {
    listRecordsMock.mockRejectedValue(new Error('mongo caído: connection refused 27017'));
    const app = await loadApp();

    const res = await request(app).get('/records');
    const body = res.body as RecordsErrorBody;

    expect(res.status).toBe(500);
    expect(body.error).toBe('internal_error');
    // El detalle interno del error NO se filtra al cliente.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/mongo/i);
    expect(serialized).not.toContain('27017');
    expect(serialized).not.toMatch(/stack/i);
  });

  it('#4 la respuesta contiene solo sequence, name y createdAt (sin _id, __v ni updatedAt)', async () => {
    listRecordsMock.mockResolvedValue(DOS_REGISTROS);
    const app = await loadApp();

    const res = await request(app).get('/records');
    const body = res.body as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    for (const item of body) {
      expect(Object.keys(item).sort()).toEqual(['createdAt', 'name', 'sequence']);
      expect(item).not.toHaveProperty('_id');
      expect(item).not.toHaveProperty('__v');
      expect(item).not.toHaveProperty('updatedAt');
    }
  });

  it('#6 /records NO está rate-limitado: más peticiones que rateLimitMax siguen dando 200', async () => {
    listRecordsMock.mockResolvedValue(DOS_REGISTROS);
    // Límite bajo a propósito: si /records tuviera limiter, la 3ª daría 429.
    const app = await loadApp({ rateLimitMax: 2 });

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/records');
      statuses.push(res.status);
    }

    // Ninguna respuesta es 429: el endpoint no se limita.
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    expect(statuses).not.toContain(429);
  });
});
