/**
 * Configuración central leída de variables de entorno.
 * Toda la app consume la config desde aquí — nunca `process.env` directo.
 */
export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongodbUri: process.env.MONGODB_URI ?? '',
  cryptoSecret: process.env.CRYPTO_SECRET ?? '',
} as const;

export const isProd = env.nodeEnv === 'production';
