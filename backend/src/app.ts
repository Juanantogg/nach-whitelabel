import express, { type Express } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env, isProd } from './config/env.js';
import { httpLogger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.routes.js';
import { cryptoRouter } from './routes/crypto.routes.js';
import { namesRouter } from './routes/names.routes.js';

/**
 * Opciones de CORS: permite solo los orígenes de la allowlist (`env.corsOrigins`)
 * y las peticiones sin `Origin` (curl, same-origin, health checks). Un origen no
 * permitido se responde con `callback(null, false)` (sin cabeceras CORS, sin 500):
 * el navegador bloquea la lectura de la respuesta, pero no se ensucia el
 * errorHandler ni los logs.
 */
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST'],
  credentials: false,
};

/**
 * Construye la app de Express sin arrancar el servidor ni conectar a Mongo.
 * Separar `app` de `server` permite testear los endpoints con Supertest
 * sin abrir un puerto ni depender de la base de datos.
 *
 * Orden de middlewares (en Express 5 el orden de `use` es el de ejecución):
 * helmet → cors → express.json → pino-http → routers → notFoundHandler → errorHandler.
 */
export function createApp(): Express {
  const app = express();

  // Confía en UN hop de proxy (App Runner/CloudFront delante en prod) para que el
  // rate-limit lea la IP real de `X-Forwarded-For` en vez de meter a todos en el
  // mismo cubo. Nunca `true` (spoofeable); solo en prod, donde ese proxy existe.
  if (isProd) app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(httpLogger);

  app.use('/health', healthRouter);
  app.use('/crypto', cryptoRouter);

  // Rate-limit solo en el endpoint de escritura, contando por IP. Al exceder el
  // límite responde JSON `{ error, message }` (mismo contrato que el resto de la
  // API), no el HTML por defecto de express-rate-limit. El texto es genérico y no
  // sensible.
  const namesLimiter = rateLimit({
    max: env.rateLimitMax,
    windowMs: 60_000,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'too_many_requests',
        message: 'Demasiadas peticiones, inténtalo más tarde',
      });
    },
  });
  app.use('/names', namesLimiter, namesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
