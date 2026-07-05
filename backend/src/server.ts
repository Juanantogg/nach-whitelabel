import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env, validateEnv } from './config/env.js';
import { logger } from './config/logger.js';

/** Margen máximo para que el cierre ordenado drene antes de forzar la salida. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Punto de entrada: valida el entorno (fail-fast), conecta a Mongo y levanta el servidor HTTP. */
async function bootstrap(): Promise<void> {
  // Fail-fast: entorno inválido aborta el arranque antes de tocar Mongo o el puerto.
  const result = validateEnv();
  if (!result.success) {
    // Solo path + message: nunca el valor recibido, para no filtrar secretos al log.
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    logger.error({ issues }, 'env_invalid');
    process.exit(1);
  }

  await connectDb();

  const app = createApp();
  const httpServer = app.listen(env.port, () => {
    logger.info({ port: env.port }, 'server_listening');
  });

  /**
   * Cierre ordenado: deja de aceptar conexiones nuevas, drena las en curso,
   * cierra Mongoose y sale. Una red de seguridad fuerza la salida si algo se
   * cuelga más allá del timeout.
   */
  function shutdown(signal: string): void {
    logger.info({ signal }, 'shutdown_start');
    httpServer.close(() => {
      disconnectDb()
        .then(() => {
          logger.info('shutdown_complete');
          process.exit(0);
        })
        .catch((err: unknown) => {
          logger.error({ err }, 'shutdown_error');
          process.exit(1);
        });
    });
    // `.unref()` para que el timeout no mantenga vivo el proceso por sí mismo.
    setTimeout(() => {
      logger.error('shutdown_timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err: unknown) => {
  logger.error({ err }, 'bootstrap_error');
  process.exit(1);
});
