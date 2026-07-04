import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * Configuración central leída de variables de entorno.
 * Toda la app consume la config desde aquí — nunca `process.env` directo.
 *
 * IMPORTANTE: la evaluación de este módulo NO valida ni aborta al importarse
 * (así los tests que hacen `import { env }` sin MONGODB_URI siguen corriendo).
 * El fail-fast real lo aplica `server.ts` llamando a `validateEnv` al boot.
 */
export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongodbUri: process.env.MONGODB_URI ?? '',
  /** Clave privada RSA (PEM PKCS#8) del esquema híbrido asimétrico. Solo de entorno, nunca hardcodeada. */
  cryptoPrivateKey: process.env.CRYPTO_PRIVATE_KEY ?? '',
} as const;

export const isProd = env.nodeEnv === 'production';

/** ¿La cadena carga como clave privada PEM válida? (valida de verdad, no solo el prefijo). */
function loadsAsPem(value: string): boolean {
  try {
    crypto.createPrivateKey(value);
    return true;
  } catch {
    return false;
  }
}

/** Schema del entorno: red de seguridad del arranque (fail-fast). */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI debe ser una URI mongo válida'),
  CRYPTO_PRIVATE_KEY: z
    .string()
    .refine(loadsAsPem, 'CRYPTO_PRIVATE_KEY debe ser un PEM PKCS#8 cargable'),
});

/** Configuración validada del entorno (forma normalizada para el bootstrap). */
export interface ValidatedEnv {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  mongodbUri: string;
  cryptoPrivateKey: string;
}

/** Resultado de `validateEnv`: convención "devuelve resultado" (no lanza). */
export type EnvResult =
  { success: true; data: ValidatedEnv } | { success: false; error: z.ZodError };

/**
 * Valida el entorno de forma pura y testeable (NO llama a `process.exit`; el
 * fail-fast real vive en `server.ts`). Devuelve `{ success, data | error }`.
 */
export function validateEnv(source: Record<string, string | undefined> = process.env): EnvResult {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    return { success: false, error: parsed.error };
  }
  const { PORT, NODE_ENV, MONGODB_URI, CRYPTO_PRIVATE_KEY } = parsed.data;
  return {
    success: true,
    data: {
      port: PORT,
      nodeEnv: NODE_ENV,
      mongodbUri: MONGODB_URI,
      cryptoPrivateKey: CRYPTO_PRIVATE_KEY,
    },
  };
}
