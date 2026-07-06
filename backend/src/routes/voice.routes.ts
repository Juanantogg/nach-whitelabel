import { Router, type NextFunction, type Request, type Response } from 'express';
import multer, { MulterError } from 'multer';
import { postTranscribe } from '../controllers/voice.controller.js';

/**
 * Tope de bytes del audio (design §2.2). Un nombre de ≤15 chars dura ~3-5 s;
 * webm/opus a esa duración pesa decenas de KB. 2 MB da margen holgado y corta
 * subidas abusivas muy por debajo del límite de 25 MB de Groq. Multer rechaza en
 * memoria ANTES de reenviar al proveedor → 413.
 */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

/**
 * Multer en memoria (`memoryStorage`): el audio es efímero, no toca disco ni
 * Mongo. `limits.fileSize` corta las subidas grandes sin leer el fichero entero.
 * `single('audio')` acepta un único fichero en el campo `audio`.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES },
});

/**
 * Traduce los errores de multer a códigos de negocio ANTES del errorHandler
 * central: fichero demasiado grande → 413 `audio_too_large`. Cualquier otro fallo
 * de multer (campo inesperado, multipart corrupto) → 400 `invalid_payload`. El
 * service nunca se invoca en estos caminos.
 */
function handleUploadErrors(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'audio_too_large' });
      return;
    }
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }
  next(err);
}

/** Recibe el audio (multipart, campo `audio`) y devuelve `{ text }`. Se monta en `/voice`. */
export const voiceRouter = Router();

voiceRouter.post('/transcribe', upload.single('audio'), handleUploadErrors, postTranscribe);
