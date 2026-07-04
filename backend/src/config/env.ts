/**
 * Configuración central leída de variables de entorno.
 * Toda la app consume la config desde aquí — nunca `process.env` directo.
 */
export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongodbUri: process.env.MONGODB_URI ?? '',
  /** Clave privada RSA (PEM PKCS#8) del esquema híbrido asimétrico. Solo de entorno, nunca hardcodeada. */
  cryptoPrivateKey: process.env.CRYPTO_PRIVATE_KEY ?? '',
} as const;

export const isProd = env.nodeEnv === 'production';
