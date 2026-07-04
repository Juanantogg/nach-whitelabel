/**
 * Obtiene la clave pública del back (`GET /crypto/public-key`) para cifrar.
 * Deps inyectables (`fetchFn`/`apiUrl`) al estilo de `loadBrand`, para testear
 * sin red. `apiUrl` viene de `VITE_API_URL` por defecto. No cachea: el cacheo,
 * si hace falta, es de welcome_screen.
 */
interface FetchPublicKeyDeps {
  fetchFn?: typeof fetch;
  apiUrl?: string;
}

interface PublicKeyResponse {
  publicKey: string;
  alg: string;
}

/** `VITE_API_URL` tipada sin depender de `vite/client` (que este paquete no referencia). */
const DEFAULT_API_URL: string =
  (import.meta.env as Record<string, string | undefined>).VITE_API_URL ?? '';

export async function fetchPublicKey(deps: FetchPublicKeyDeps = {}): Promise<string> {
  const { fetchFn = fetch, apiUrl = DEFAULT_API_URL } = deps;

  const res = await fetchFn(`${apiUrl}/crypto/public-key`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`No se pudo obtener la clave pública (HTTP ${res.status})`);
  }

  const body = (await res.json()) as PublicKeyResponse;
  return body.publicKey;
}
