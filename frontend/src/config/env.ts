import { z } from 'zod';

/**
 * Fuente ÚNICA, tipada y validada, del acceso a `import.meta.env.VITE_*`.
 * Espejo conceptual del `backend/src/config/env.ts` (objeto `env` + schema Zod +
 * `validateEnv` pura), pero LAZY-RESILIENTE: a diferencia del backend, NO hace
 * fail-fast al importarse. Una env ausente degrada a su default; la app nunca
 * queda en blanco (coherente con la filosofía de `brand_config`).
 *
 * El front NO lleva clave de cifrado: la pública se pide al backend en runtime
 * (`fetchPublicKey`). Solo hay dos vars: `VITE_API_URL` y `VITE_DEFAULT_BRAND`.
 */
export interface Env {
  /** Base URL del backend, normalizada sin trailing slash. `''` válido en dev. */
  apiUrl: string;
  /** Marca por defecto en dev/tests; `undefined` si la var está ausente o vacía. */
  defaultBrand?: string;
}

/**
 * Schema del entorno del front. Ambas vars son opcionales-con-default: ninguna
 * es requerida, por lo que `safeParse` nunca falla con las vars actuales.
 * `VITE_API_URL` NO se valida como URL absoluta (en dev es legítimamente
 * relativa/vacía); solo se recorta el trailing slash para evitar la doble barra.
 * `VITE_DEFAULT_BRAND` vacío se normaliza a `undefined`.
 */
const envSchema = z.object({
  VITE_API_URL: z
    .string()
    .default('')
    .transform((value) => value.replace(/\/+$/, '')),
  VITE_DEFAULT_BRAND: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

/** Resultado de `validateEnv`: convención "devuelve resultado" (no lanza). */
export type EnvResult = { success: true; data: Env } | { success: false; error: z.ZodError };

/**
 * Valida el entorno de forma pura y testeable. `source` es inyectable (default
 * `import.meta.env`) para no depender del entorno global en tests. NUNCA lanza:
 * usa `safeParse` y, con las vars actuales, siempre devuelve `{ success: true }`.
 */
export function validateEnv(
  source: Record<string, string | undefined> = import.meta.env,
): EnvResult {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    return { success: false, error: parsed.error };
  }
  return {
    success: true,
    data: {
      apiUrl: parsed.data.VITE_API_URL,
      defaultBrand: parsed.data.VITE_DEFAULT_BRAND,
    },
  };
}

/**
 * Configuración del entorno ya resuelta y validada, lista para consumir en toda
 * la app. Con las vars actuales `validateEnv` nunca falla; el fallback a los
 * defaults del schema es la red de seguridad si en el futuro se añade una var.
 */
export const env: Env = ((): Env => {
  const result = validateEnv();
  return result.success ? result.data : { apiUrl: '' };
})();

/** Flag dev/prod nativo de Vite, centralizado aquí como fuente única. */
export const isDev = import.meta.env.DEV;
