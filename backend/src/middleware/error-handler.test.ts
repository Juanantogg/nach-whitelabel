/**
 * Tests RED — error handler centralizado (feature backend_hardening, ADR 15.4).
 *
 * El contrato del error handler (JSON `{ error, message }`, stack solo fuera de
 * prod, message genérico en 5xx de prod) se prueba montando una app Express
 * MÍNIMA en el propio test: una ruta que lanza + el `errorHandler` exportado
 * como último middleware. Así NO se añade ninguna ruta de prueba al `app.ts` de
 * producción y se ejercita el handler real (no un doble).
 *
 * `isProd` se resuelve al IMPORTAR `config/env.ts` (lee `NODE_ENV`). El handler
 * lo consume, así que para variar prod/dev hay que fijar `NODE_ENV` ANTES de
 * importar `error-handler.ts`, con `vi.resetModules()` + import dinámico — mismo
 * patrón que `config/env.validate.test.ts` y `crypto.routes.test.ts`.
 *
 * MOTIVO DE FALLO ESPERADO (RED legítimo): hoy NO existe
 * `backend/src/middleware/error-handler.ts`, así que el import dinámico del
 * módulo falla (módulo ausente) y todo el describe queda en rojo por la razón
 * correcta: código de producción todavía inexistente.
 *
 * Para el 404: solo se prueba si el diseño implementa `notFoundHandler`
 * (opcional, ADR 15). Se marca como tal y se monta también en la app mínima.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import request from 'supertest';

/** Forma del JSON de error del contrato. */
interface ErrorBody {
  error?: string;
  message?: string;
  stack?: string;
}

/**
 * Carga `errorHandler` (y opcionalmente `notFoundHandler`) con `NODE_ENV` fijado
 * ANTES del import, para que `isProd` de `env.ts` tome ese valor.
 */
async function loadMiddleware(nodeEnv: string): Promise<{
  errorHandler: ErrorRequestHandler;
  notFoundHandler?: RequestHandler;
}> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  const mod = (await import('./error-handler.js')) as {
    errorHandler: ErrorRequestHandler;
    notFoundHandler?: RequestHandler;
  };
  return mod;
}

/**
 * App mínima: una ruta `/boom` que lanza el error dado (o uno con `status`
 * fijado) + el `errorHandler` real como último middleware. En Express 5 el
 * throw síncrono de un handler se reenvía al error handler automáticamente.
 */
function appThatThrows(errorHandler: ErrorRequestHandler, error: unknown): Express {
  const app = express();
  app.get('/boom', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler — contrato JSON consistente', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('responde JSON application/json con forma { error, message }', async () => {
    const { errorHandler } = await loadMiddleware('test');
    const app = appThatThrows(errorHandler, new Error('algo falló'));

    const res = await request(app).get('/boom');

    expect(res.headers['content-type']).toContain('application/json');
    const body = res.body as ErrorBody;
    expect(typeof body.error).toBe('string');
    expect(typeof body.message).toBe('string');
  });

  it('respeta el status del error cuando trae uno (p.ej. 400)', async () => {
    const { errorHandler } = await loadMiddleware('test');
    const err = Object.assign(new Error('payload inválido'), { status: 400 });
    const app = appThatThrows(errorHandler, err);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(400);
  });

  it('un error sin status devuelve 500', async () => {
    const { errorHandler } = await loadMiddleware('test');
    const app = appThatThrows(errorHandler, new Error('sin status'));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
  });
});

describe('errorHandler — stack según entorno', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('en producción un 5xx NO incluye stack y el message es genérico', async () => {
    const { errorHandler } = await loadMiddleware('production');
    // Error con detalle interno sensible que NO debe filtrarse.
    const app = appThatThrows(errorHandler, new Error('detalle interno secreto de la clave'));

    const res = await request(app).get('/boom');
    const body = res.body as ErrorBody;

    expect(res.status).toBe(500);
    expect(body.stack).toBeUndefined();
    // Mensaje genérico: no filtra el texto interno del Error.
    expect(body.message).not.toContain('detalle interno secreto');
    expect(typeof body.message).toBe('string');
    expect(body.message?.length).toBeGreaterThan(0);
  });

  it('fuera de producción el error SÍ incluye stack (para depurar)', async () => {
    const { errorHandler } = await loadMiddleware('development');
    const app = appThatThrows(errorHandler, new Error('boom dev'));

    const res = await request(app).get('/boom');
    const body = res.body as ErrorBody;

    expect(typeof body.stack).toBe('string');
    expect(body.stack?.length).toBeGreaterThan(0);
  });
});

describe('notFoundHandler — 404 JSON (opcional según diseño)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('una ruta inexistente responde 404 con JSON { error } (no el HTML de Express)', async () => {
    const { notFoundHandler, errorHandler } = await loadMiddleware('test');
    // Si el diseño no implementa notFoundHandler, este test lo señala en rojo
    // (undefined → falla la aserción de tipo), documentado como opcional.
    expect(typeof notFoundHandler).toBe('function');

    const app = express();
    app.get('/existe', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    if (notFoundHandler) app.use(notFoundHandler);
    app.use(errorHandler);

    const res = await request(app).get('/no-existe');
    const body = res.body as ErrorBody;

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(typeof body.error).toBe('string');
  });
});
