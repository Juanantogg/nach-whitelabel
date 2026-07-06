import Groq from 'groq-sdk';
import { env } from '../config/env.js';

/** Modelo de transcripción de Groq (Whisper turbo). Fijo aquí: única capa que conoce al proveedor. */
const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';

interface TranscribeInput {
  /** Bytes del audio subido (webm/ogg/mp4), sin transcodificar. */
  audio: Buffer;
  /** MIME del fichero, para nombrar el `File` que espera el SDK. */
  mimeType: string;
  /** Locale del reconocimiento; el backend lo fija (no el cliente). Default 'es'. */
  language?: string;
}

/**
 * Única capa que conoce a Groq. Construye el `File` desde el buffer (Groq acepta
 * webm/opus directo, sin transcodificar) y llama al SDK con model/language fijos;
 * devuelve el texto. Lee la key vía `env.groqApiKey`. Cambiar de proveedor
 * (p.ej. OpenAI) toca solo este archivo — la firma es agnóstica.
 *
 * Propaga cualquier error del SDK; el controller lo traduce a 502 sin filtrar
 * detalle del proveedor.
 */
export async function transcribeAudio({
  audio,
  mimeType,
  language = 'es',
}: TranscribeInput): Promise<string> {
  const client = new Groq({ apiKey: env.groqApiKey });
  // `File` es global en Node 20+; Groq acepta un `File` directamente y no hace
  // falta el helper `toFile` del SDK (además, así el service no depende de un
  // named export del SDK que el mock del test no expone).
  const file = new File([audio], 'voice.webm', { type: mimeType });

  const result = await client.audio.transcriptions.create({
    file,
    model: TRANSCRIPTION_MODEL,
    language,
  });

  return result.text;
}
