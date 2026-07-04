import { env } from '../config/env';
import { ApiError } from './apiError';

interface ApiFetchDeps {
  /** `fetch` a usar; inyectable en tests. Default: `fetch` global. */
  fetchFn?: typeof fetch;
  /** Base URL del backend (sin trailing slash). Default: `env.apiUrl`. */
  apiUrl?: string;
}

/**
 * Envoltura sobre `fetch` que centraliza base URL, header por defecto y forma de
 * error del backend. Deps inyectables (`fetchFn`/`apiUrl`) al estilo de
 * `loadBrand`/`fetchPublicKey`. Devuelve el JSON parseado tipado por el llamador.
 *
 * - URL = `apiUrl + path`: `apiUrl` viene sin trailing slash y `path` con leading
 *   slash → una sola barra.
 * - Rechazo de red → `ApiError(status 0)` preservando la causa.
 * - `!res.ok` → `ApiError` con el status HTTP.
 * - Mezcla `Accept: application/json` por defecto sin pisar los headers del
 *   llamador (que puede sobreescribir, p.ej. `Content-Type` para POST).
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  { fetchFn = fetch, apiUrl = env.apiUrl }: ApiFetchDeps = {},
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  // `env.apiUrl` ya viene sin trailing slash, pero normalizamos aquí también por
  // robustez ante un `apiUrl` inyectado con `/` final → siempre una sola barra.
  const base = apiUrl.replace(/\/+$/, '');

  let res: Response;
  try {
    res = await fetchFn(`${base}${path}`, { ...init, headers });
  } catch (cause) {
    throw new ApiError('No se pudo conectar con el servidor', 0, { cause });
  }

  if (!res.ok) {
    throw new ApiError(`El servidor respondió con un error (HTTP ${res.status})`, res.status);
  }

  return (await res.json()) as T;
}
