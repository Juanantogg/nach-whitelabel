import { apiFetch } from './client';

/** Item del listado de registros (design: nombre completo, ADR 26). */
export interface RecordItem {
  sequence: number;
  name: string;
  createdAt: string;
}

interface FetchRecordsDeps {
  /** `fetch` a usar; inyectable en tests. Default: `fetch` global. */
  fetchFn?: typeof fetch;
  /** Base URL del backend (sin trailing slash). Default: `env.apiUrl`. */
  apiUrl?: string;
}

/**
 * Capa de red del listado: `GET /records` vía `apiFetch` (que centraliza base
 * URL, `Accept` y la forma de error `ApiError`). Resuelve el array tipado; un
 * error de red → `ApiError` (status 0); un HTTP 500 → `ApiError` (status 500).
 */
export function fetchRecords(deps: FetchRecordsDeps = {}): Promise<RecordItem[]> {
  return apiFetch<RecordItem[]>('/records', undefined, deps);
}
