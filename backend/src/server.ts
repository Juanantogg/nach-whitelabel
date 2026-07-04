import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env, validateEnv } from './config/env.js';

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
    console.error('Configuración de entorno inválida:', issues);
    process.exit(1);
  }

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
