import { S3_BASE_URL } from './constants';
import { DEFAULT_BRAND } from './registry';
import { parseBrandConfig, type BrandConfig, type BrandKey } from './schema';

interface LoadBrandDeps {
  fetchFn?: typeof fetch;
  s3BaseUrl?: string;
  isDev?: boolean;
}

/**
 * Obtiene la config de una marca por su key abierta (Rev.2 — S3 manda). En
 * dev/tests (o sin `s3BaseUrl`) devuelve el `DEFAULT_BRAND` sin tocar la red. En
 * producción hace `fetch` del `<key>.json` en S3 y lo valida con Zod; cualquier
 * fallo (rechazo de red/CORS, `!res.ok`/404, JSON malformado, error de Zod,
 * key inexistente) cae SIEMPRE a `DEFAULT_BRAND`. Nunca lanza.
 */
export async function loadBrand(key: BrandKey, deps: LoadBrandDeps = {}): Promise<BrandConfig> {
  const { fetchFn = fetch, s3BaseUrl = S3_BASE_URL, isDev = false } = deps;

  if (isDev || !s3BaseUrl) {
    return DEFAULT_BRAND;
  }

  try {
    const res = await fetchFn(`${s3BaseUrl}/${key}.json`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return DEFAULT_BRAND;
    }
    return parseBrandConfig(await res.json());
  } catch {
    return DEFAULT_BRAND;
  }
}
