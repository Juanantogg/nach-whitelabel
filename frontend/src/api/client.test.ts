/**
 * Tests RED — api/client (`apiFetch` centraliza fetch, base URL y forma de error).
 *
 * Mapea acceptance del design:
 *  #4 respuesta ok → devuelve el JSON parseado tipado como T.
 *  #5 `!res.ok` → lanza `ApiError` cuyo `status` es el HTTP status.
 *  #6 rechazo de red (fetchFn throw) → `ApiError` con `status === 0` y `cause` preservada.
 *  #7 URL = apiUrl + path con UNA sola barra; header `Accept: application/json`
 *     por defecto sin pisar headers del llamador.
 *
 * fetchFn SIEMPRE mockeado — nunca red real. Patrón de deps inyectables igual que
 * loadBrand/fetchPublicKey.
 *
 * RED esperado: `./client` y `./apiError` aún no existen → import falla, tests en rojo.
 */
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client';
import { ApiError } from './apiError';

interface Payload {
  value: string;
}

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

describe('apiFetch — camino feliz', () => {
  it('con respuesta ok devuelve el JSON parseado tipado como T', async () => {
    const fetchFn = okFetch({ value: 'hola' });

    const data = await apiFetch<Payload>('/echo', undefined, {
      fetchFn,
      apiUrl: 'https://api.example.com',
    });

    expect(data).toEqual({ value: 'hola' });
  });
});

describe('apiFetch — errores', () => {
  it('ante !res.ok lanza ApiError cuyo status es el HTTP status', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'boom' }),
      }),
    ) as unknown as typeof fetch;

    await expect(
      apiFetch('/fail', undefined, { fetchFn, apiUrl: 'https://api.example.com' }),
    ).rejects.toMatchObject({ status: 500 });

    // Y es un ApiError, no un Error genérico.
    await expect(
      apiFetch('/fail', undefined, { fetchFn, apiUrl: 'https://api.example.com' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('ante rechazo de red (fetchFn throw) lanza ApiError con status 0 y preserva cause', async () => {
    const cause = new TypeError('Failed to fetch');
    const fetchFn = vi.fn(() => Promise.reject(cause)) as unknown as typeof fetch;

    const promise = apiFetch('/down', undefined, {
      fetchFn,
      apiUrl: 'https://api.example.com',
    });

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 0, cause });
  });
});

describe('apiFetch — construcción de URL y headers', () => {
  it('construye la URL con UNA sola barra cuando apiUrl trae trailing slash', async () => {
    const fetchFn = okFetch({ value: 'x' });

    await apiFetch('/crypto/public-key', undefined, {
      fetchFn,
      apiUrl: 'https://api.example.com/',
    });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.example.com/crypto/public-key',
      expect.anything(),
    );
  });

  it('construye la URL con UNA sola barra cuando apiUrl no trae trailing slash', async () => {
    const fetchFn = okFetch({ value: 'x' });

    await apiFetch('/crypto/public-key', undefined, {
      fetchFn,
      apiUrl: 'https://api.example.com',
    });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.example.com/crypto/public-key',
      expect.anything(),
    );
  });

  it('añade Accept: application/json por defecto', async () => {
    const fetchFn = okFetch({ value: 'x' });

    await apiFetch('/echo', undefined, { fetchFn, apiUrl: 'https://api.example.com' });

    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
  });

  it('no pisa los headers que pase el llamador (merge, no reemplazo)', async () => {
    const fetchFn = okFetch({ value: 'x' });

    await apiFetch(
      '/echo',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { fetchFn, apiUrl: 'https://api.example.com' },
    );

    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    // Se conserva el header del llamador...
    expect(headers.get('Content-Type')).toBe('application/json');
    // ...y sigue estando el Accept por defecto.
    expect(headers.get('Accept')).toBe('application/json');
    // ...y el método del llamador se respeta.
    expect(init.method).toBe('POST');
  });
});
