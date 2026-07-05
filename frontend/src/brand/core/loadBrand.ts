import { S3_BASE_URL } from './constants';
import { DEV_SEEDS } from './devSeeds';
import { DEFAULT_BRAND } from './registry';
import { parseBrandConfig, type BrandConfig, type BrandKey } from './schema';

interface LoadBrandDeps {
  fetchFn?: typeof fetch;
  s3BaseUrl?: string;
  isDev?: boolean;
  /**
   * Registro de seeds bundleadas: key → JSON crudo (sin parsear). Inyectable en
   * los tests como se inyecta `fetchFn`. Por defecto, el registro real de
   * `seeds/*.json` PERO solo en dev: en prod queda vacío (las seeds no se
   * bundlean, ver `devSeeds.ts`). Se consulta únicamente en dev tras fallo de S3.
   */
  seeds?: Record<string, unknown>;
}

// Default del registro de seeds resuelto por entorno: en dev, las seeds reales;
// en prod, un registro vacío (la rama con `DEV_SEEDS` se elimina por
// tree-shaking al ser `import.meta.env.DEV` un `false` literal en el build).
const DEFAULT_SEEDS: Record<string, unknown> = import.meta.env.DEV ? DEV_SEEDS : {};

/**
 * Intenta traer el `<key>.json` de S3 y validarlo con Zod. Devuelve la
 * `BrandConfig` parseada, o `null` ante CUALQUIER fallo de S3 (rechazo de
 * red/CORS, `!res.ok`/404, JSON malformado o error de Zod). Nunca lanza.
 *
 * El fetch es un GET "simple", con un init vacío (sin headers no-estándar como
 * `Accept`): así no dispara un preflight `OPTIONS` que el origen S3 privado con
 * OAC rechazaría con 403 (ADR 19). S3 ignora `Accept` de todos modos; el parseo
 * lo hace `res.json()`.
 */
async function fetchFromS3(
  key: BrandKey,
  fetchFn: typeof fetch,
  s3BaseUrl: string,
): Promise<BrandConfig | null> {
  try {
    const res = await fetchFn(`${s3BaseUrl}/${key}.json`, {});
    if (!res.ok) {
      return null;
    }
    return parseBrandConfig(await res.json());
  } catch {
    return null;
  }
}

/**
 * Resuelve la seed bundleada de una key: parsea con `parseBrandConfig` (mismo
 * camino de validación que el JSON de S3). Devuelve `null` si no hay seed para
 * la key o si no valida. Nunca lanza.
 */
function loadSeed(key: BrandKey, seeds: Record<string, unknown>): BrandConfig | null {
  const raw = seeds[key];
  if (raw === undefined) {
    return null;
  }
  try {
    return parseBrandConfig(raw);
  } catch {
    return null;
  }
}

/**
 * Obtiene la config de una marca por su key abierta (Rev.3 — cadena de fallback
 * por entorno, decisión aprobada en `CLAUDE.md`). Nunca lanza; siempre devuelve
 * un `BrandConfig`:
 *
 *   - Dev  (`isDev:true`):  S3 por key → si falla → seed bundleada de esa key →
 *                           si no hay seed → `DEFAULT_BRAND`.
 *   - Prod (`isDev:false`): S3 por key → si falla → `DEFAULT_BRAND`
 *                           (las seeds NO participan en prod).
 *
 * Sin `s3BaseUrl` no hay S3 que intentar: cae directo al fallback sin tocar la red.
 */
export async function loadBrand(key: BrandKey, deps: LoadBrandDeps = {}): Promise<BrandConfig> {
  const { fetchFn = fetch, s3BaseUrl = S3_BASE_URL, isDev = false, seeds = DEFAULT_SEEDS } = deps;

  if (s3BaseUrl) {
    const fromS3 = await fetchFromS3(key, fetchFn, s3BaseUrl);
    if (fromS3) {
      return fromS3;
    }
  }

  // S3 falló (o no hay bucket). En dev intentamos la seed de la key antes del
  // default; en prod las seeds no participan.
  if (isDev) {
    const fromSeed = loadSeed(key, seeds);
    if (fromSeed) {
      return fromSeed;
    }
  }

  return DEFAULT_BRAND;
}
