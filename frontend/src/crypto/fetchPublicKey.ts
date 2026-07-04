import { apiFetch, ApiError } from '../api';
import { env } from '../config/env';

/**
 * Obtiene la clave pública del back (`GET /crypto/public-key`) para cifrar.
 * Delega en la capa `api` (`apiFetch`) para no repetir base URL ni manejo de
 * errores. Deps inyectables (`fetchFn`/`apiUrl`) al estilo de `loadBrand`, para
 * testear sin red. `apiUrl` viene de `env.apiUrl` por defecto. No cachea: el
 * cacheo, si hace falta, es de welcome_screen.
 */
interface FetchPublicKeyDeps {
  fetchFn?: typeof fetch;
  apiUrl?: string;
}

interface PublicKeyResponse {
  publicKey: string;
  alg: string;
}

export async function fetchPublicKey(deps: FetchPublicKeyDeps = {}): Promise<string> {
  const { fetchFn = fetch, apiUrl = env.apiUrl } = deps;

  try {
    const body = await apiFetch<PublicKeyResponse>(
      '/crypto/public-key',
      { headers: { Accept: 'application/json' } },
      { fetchFn, apiUrl },
    );
    return body.publicKey;
  } catch (error) {
    // Re-mapea el error HTTP al mensaje específico de este endpoint, preservando
    // el contrato de error histórico. Un fallo de red (ApiError status 0) o
    // cualquier otro se propaga tal cual.
    if (error instanceof ApiError && error.status >= 400) {
      throw new Error(`No se pudo obtener la clave pública (HTTP ${error.status})`, {
        cause: error,
      });
    }
    throw error;
  }
}
