import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { transcribeAudio } from '../services/transcription.service.js';

/** Locale fijado por el backend (no lo manda el cliente), coherente con la marca por defecto. */
const TRANSCRIPTION_LANGUAGE = 'es';

/**
 * MIME aceptados para el audio del dictado. `webm/opus` (Chrome/Firefox),
 * `ogg/opus` (Firefox según versión), `mp4` (Safari, aunque usa el camino nativo;
 * se acepta por robustez). Fuera de esta allowlist → 400.
 */
const ALLOWED_AUDIO_MIME = /^audio\/(webm|ogg|mp4)(;.*)?$/;

/**
 * POST /voice/transcribe — descifra NADA: recibe audio efímero (multipart, campo
 * `audio`), valida presencia/MIME/key, delega la transcripción al service y
 * responde `{ text }`. No persiste el audio ni conoce al proveedor. Traduce el
 * fallo del service a 502 sin filtrar detalle del proveedor.
 */
export async function postTranscribe(req: Request, res: Response): Promise<void> {
  const file = req.file;

  // Falta el fichero (o el body no era multipart) → payload inválido.
  if (!file || !Buffer.isBuffer(file.buffer)) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  // MIME fuera de la allowlist → payload inválido (no se toca al proveedor).
  if (!ALLOWED_AUDIO_MIME.test(file.mimetype)) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  // Sin key configurada, falla-cerrado ANTES de llamar al proveedor.
  if (env.groqApiKey === '') {
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  let text: string;
  try {
    text = await transcribeAudio({
      audio: file.buffer,
      mimeType: file.mimetype,
      language: TRANSCRIPTION_LANGUAGE,
    });
  } catch (err) {
    // Fallo del proveedor (Groq inaccesible / error upstream). Se deja rastro
    // para el operador con SOLO datos seguros —mensaje y, si lo trae, status
    // numérico— nunca el objeto de error crudo del SDK (podría acarrear la key
    // o el cuerpo de la petición). Al cliente no se le filtra detalle alguno.
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
        ? err.status
        : undefined;
    (req.log ?? logger).error({ message, status }, 'transcription_failed');

    res.status(502).json({ error: 'transcription_failed' });
    return;
  }

  res.status(200).json({ text });
}
