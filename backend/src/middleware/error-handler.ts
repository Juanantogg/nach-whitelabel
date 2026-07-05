import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isProd } from '../config/env.js';
import { logger } from '../config/logger.js';

/** Extrae un `status` numérico del error si lo trae; si no, 500. */
function statusOf(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
    return err.status;
  }
  return 500;
}

/**
 * Manejador de errores centralizado (firma de 4 args, obligatoria para que
 * Express 5 lo reconozca como error handler). Responde JSON consistente
 * `{ error, message }`, respeta `err.status` (default 500), incluye `stack` solo
 * fuera de producción y da un `message` genérico en los 5xx de producción para
 * no filtrar detalle interno. Loguea por pino, nunca por `console.*`.
 */
// El 4º parámetro (`next`) es obligatorio para que Express 5 reconozca esto como
// error handler, aunque no se use.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = statusOf(err);
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Error';

  // Log estructurado del error. `req.log` lo inyecta pino-http; si no está
  // (app mínima sin el middleware), se cae al logger raíz.
  (req.log ?? logger).error({ err, status }, 'request_failed');

  const body: Record<string, unknown> = {
    error: 'internal_error',
    // En prod los 5xx dan un mensaje genérico: no se filtra el detalle interno.
    message: isProd && status >= 500 ? 'Error interno del servidor' : message,
  };
  // Stack SOLO fuera de producción, para depurar sin exponer nada en prod.
  if (!isProd && err instanceof Error && err.stack) {
    body.stack = err.stack;
  }

  res.status(status).json(body);
};

/**
 * Manejador de 404: responde JSON `{ error }` consistente para rutas no
 * montadas, en vez del HTML por defecto de Express. Se monta justo antes del
 * `errorHandler`.
 */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Recurso no encontrado' });
};
