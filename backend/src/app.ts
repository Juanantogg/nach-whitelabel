import express, { type Express } from 'express';
import { healthRouter } from './routes/health.routes.js';

/**
 * Construye la app de Express sin arrancar el servidor ni conectar a Mongo.
 * Separar `app` de `server` permite testear los endpoints con Supertest
 * sin abrir un puerto ni depender de la base de datos.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.use('/health', healthRouter);

  return app;
}
