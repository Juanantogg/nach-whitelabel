/**
 * Tests RED — api/fetchRecords (capa de red del listado de registros).
 * Feature records_list, design §"Frontend — capa API" y criterio 7.
 *
 * `fetchRecords(deps?)` hace `GET /records` reusando `apiFetch<RecordItem[]>` (que
 * ya centraliza base URL, `Accept` y la forma de error `ApiError`). Resuelve el
 * array tipado; un error de red → `ApiError` con status 0; un HTTP 500 → `ApiError`
 * con status 500. Deps inyectables (`fetchFn`/`apiUrl`) al estilo de
 * `apiFetch`/`transcribeVoice`.
 *
 * `fetchFn` SIEMPRE mockeado — nunca red real.
 *
 * RED esperado: `./fetchRecords` aún no existe → el import falla y todos los tests
 * quedan en rojo por "módulo ausente".
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchRecords } from './fetchRecords';
import { ApiError } from './apiError';

/** fetch mockeado con respuesta ok que devuelve `body` como JSON. */
function okFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status,
      json: () => Promise.resolve(body),
    }),
  ) as unknown as typeof fetch;
}

const DOS_REGISTROS = [
  { sequence: 42, name: 'Juan', createdAt: '2026-07-05T10:12:00.000Z' },
  { sequence: 41, name: 'Ana', createdAt: '2026-07-05T10:08:00.000Z' },
];

describe('fetchRecords — camino feliz (criterio 7)', () => {
  it('hace GET a /records vía apiFetch y resuelve el array tipado', async () => {
    const fetchFn = okFetch(DOS_REGISTROS);

    const records = await fetchRecords({ fetchFn, apiUrl: 'https://api.example.com' });

    expect(records).toEqual(DOS_REGISTROS);

    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0] as [string, RequestInit | undefined];
    // URL correcta bajo la base inyectada.
    expect(url).toBe('https://api.example.com/records');
    // Es una lectura: GET (o método por defecto de fetch, sin POST).
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('resuelve [] cuando el backend devuelve un array vacío', async () => {
    const fetchFn = okFetch([]);

    const records = await fetchRecords({ fetchFn, apiUrl: 'https://api.example.com' });

    expect(records).toEqual([]);
  });
});

describe('fetchRecords — errores (criterio 7)', () => {
  it('HTTP 500 → rechaza con ApiError cuyo status es 500', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'internal_error' }),
      }),
    ) as unknown as typeof fetch;

    const promise = fetchRecords({ fetchFn, apiUrl: 'https://api.example.com' });

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 500 });
  });

  it('rechazo de red (fetchFn throw) → ApiError con status 0', async () => {
    const cause = new TypeError('Failed to fetch');
    const fetchFn = vi.fn(() => Promise.reject(cause)) as unknown as typeof fetch;

    const promise = fetchRecords({ fetchFn, apiUrl: 'https://api.example.com' });

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 0 });
  });
});
