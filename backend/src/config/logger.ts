import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { isProd } from './env.js';

/**
 * Rutas censuradas en los logs (defensa en profundidad): headers de auth/cookie y
 * el body de la request. Hoy no se loguea el body, pero blinda contra fugas de PII
 * si en el futuro se activara o llegaran headers de autenticación. Como `httpLogger`
 * reutiliza este logger raíz, el redact aplica también a los logs de pino-http.
 */
const REDACT_PATHS = ['req.headers.authorization', 'req.headers.cookie', 'req.body'];

/**
 * Logger raíz de pino (JSON estructurado). Lo usan `server.ts` y `config/db.ts`
 * para los mensajes de ciclo de vida (arranque, shutdown, conexión). Una sola
 * configuración compartida para que no diverjan dos setups.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  redact: REDACT_PATHS,
});

/**
 * Middleware `pino-http`: inyecta `req.log` (logger con `req.id`) en cada
 * request, consumido por controllers y por el `errorHandler`. Reutiliza el
 * logger raíz para compartir nivel y formato.
 */
export const httpLogger = pinoHttp({ logger });
