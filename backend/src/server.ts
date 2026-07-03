import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';

/** Punto de entrada: conecta a Mongo y levanta el servidor HTTP. */
async function bootstrap(): Promise<void> {
  await connectDb();

  const app = createApp();
  app.listen(env.port, () => {
    console.info(`🚀 nach-backend escuchando en http://localhost:${env.port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Error al arrancar el servidor:', err);
  process.exit(1);
});
