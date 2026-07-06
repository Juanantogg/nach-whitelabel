import { env } from '../config/env';
import { ApiError } from './apiError';

interface TranscribeVoiceDeps {
  /** `fetch` a usar; inyectable en tests. Default: `fetch` global. */
  fetchFn?: typeof fetch;
  /** Base URL del backend (sin trailing slash). Default: `env.apiUrl`. */
  apiUrl?: string;
}

/**
 * Capa de red del fallback de voz por IA: sube el audio como `multipart/form-data`
 * (campo `audio`) a `POST /voice/transcribe` y resuelve el `text`.
 *
 * No usa `apiFetch` porque este fija `Accept: application/json` y, sobre todo,
 * porque el multipart necesita que el NAVEGADOR ponga el `Content-Type` con el
 * boundary — si lo fijáramos a mano se perdería y el backend no podría parsear.
 * Por eso construye el `FormData` y NO toca los headers. Reutiliza el mismo
 * contrato de error (`ApiError` con el status HTTP; 0 si la red cae) que `apiFetch`.
 */
export async function transcribeVoice(
  audio: Blob,
  { fetchFn = fetch, apiUrl = env.apiUrl }: TranscribeVoiceDeps = {},
): Promise<string> {
  const form = new FormData();
  form.append('audio', audio, 'voice.webm');

  const base = apiUrl.replace(/\/+$/, '');

  let res: Response;
  try {
    // Sin `headers`: el navegador añade `Content-Type: multipart/form-data;
    // boundary=…` al pasar un FormData como body.
    res = await fetchFn(`${base}/voice/transcribe`, { method: 'POST', body: form });
  } catch (cause) {
    throw new ApiError('No se pudo conectar con el servidor', 0, { cause });
  }

  if (!res.ok) {
    throw new ApiError(`El servidor respondió con un error (HTTP ${res.status})`, res.status);
  }

  const body = (await res.json()) as { text?: string };
  return body.text ?? '';
}
