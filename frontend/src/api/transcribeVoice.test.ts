/**
 * Tests RED — api/transcribeVoice (capa de red del fallback de voz por IA).
 * Feature voice_universal, design §5.3 (F1-F4).
 *
 * `transcribeVoice(audio: Blob, deps?)` sube el audio como `multipart/form-data`
 * (campo `audio`) a `POST /voice/transcribe` y resuelve el `text`. Reutiliza la
 * base URL y la forma de error de la capa API (`ApiError` con el status HTTP; 0
 * si la red cae), igual que `apiFetch`.
 *
 * `fetchFn` SIEMPRE mockeado — nunca red real. Deps inyectables (`fetchFn`/`apiUrl`)
 * al estilo de `apiFetch`/`loadBrand`/`fetchPublicKey`.
 *
 * Detalle clave del multipart (F4): NO se fija `Content-Type` a mano; el navegador
 * debe poner `multipart/form-data; boundary=…` él solo al pasar un `FormData`. Si
 * el código fijara el header manualmente, el boundary se perdería.
 *
 * RED esperado: `./transcribeVoice` aún no existe → el import falla y todos los
 * tests quedan en rojo por "módulo ausente".
 */
import { describe, expect, it, vi } from 'vitest';
import { transcribeVoice } from './transcribeVoice';
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

/** Un Blob de audio webm cualquiera (el contenido no importa: fetch está mockeado). */
function audioBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
}

describe('transcribeVoice — camino feliz (F1)', () => {
  it('hace POST a /voice/transcribe con FormData que contiene el campo audio y resuelve el text', async () => {
    const fetchFn = okFetch({ text: 'Ana' });

    const text = await transcribeVoice(audioBlob(), {
      fetchFn,
      apiUrl: 'https://api.example.com',
    });

    expect(text).toBe('Ana');

    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    // URL correcta.
    expect(url).toBe('https://api.example.com/voice/transcribe');
    // Método POST.
    expect(init.method).toBe('POST');
    // El body es un FormData con el campo `audio`.
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.has('audio')).toBe(true);
  });
});

describe('transcribeVoice — errores (F2, F3)', () => {
  it('F2 respuesta !ok (413) → rechaza con ApiError cuyo status es 413', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 413,
        json: () => Promise.resolve({ error: 'audio_too_large' }),
      }),
    ) as unknown as typeof fetch;

    const promise = transcribeVoice(audioBlob(), { fetchFn, apiUrl: 'https://api.example.com' });

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 413 });
  });

  it('F2 respuesta !ok (502) → rechaza con ApiError cuyo status es 502', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ error: 'transcription_failed' }),
      }),
    ) as unknown as typeof fetch;

    const promise = transcribeVoice(audioBlob(), { fetchFn, apiUrl: 'https://api.example.com' });

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 502 });
  });

  it('F3 rechazo de red (fetchFn throw) → ApiError con status 0', async () => {
    const cause = new TypeError('Failed to fetch');
    const fetchFn = vi.fn(() => Promise.reject(cause)) as unknown as typeof fetch;

    const promise = transcribeVoice(audioBlob(), { fetchFn, apiUrl: 'https://api.example.com' });

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 0 });
  });
});

describe('transcribeVoice — no fija Content-Type manualmente (F4)', () => {
  it('deja el boundary del multipart al navegador: no hay Content-Type propio en la petición', async () => {
    const fetchFn = okFetch({ text: 'Ana' });

    await transcribeVoice(audioBlob(), { fetchFn, apiUrl: 'https://api.example.com' });

    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    // Si el código pusiera un Content-Type a mano, el navegador NO añadiría el
    // boundary del multipart y el backend no podría parsearlo. Debe estar ausente.
    expect(headers.has('Content-Type')).toBe(false);
  });
});
