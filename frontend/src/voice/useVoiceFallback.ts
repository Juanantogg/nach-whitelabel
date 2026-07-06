import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/apiError';
import { transcribeVoice as defaultTranscribe } from '../api/transcribeVoice';

/** Estados de la máquina del fallback por IA (análoga a la del hook nativo). */
export type FallbackStatus = 'idle' | 'recording' | 'transcribing' | 'error';

/** Motivo de error del fallback, mapeable a los textos de marca existentes. */
export type FallbackErrorCode = 'permission-denied' | 'no-audio' | 'network' | 'unknown';

export interface UseVoiceFallbackOptions {
  /**
   * Se invoca con la transcripción FINAL no vacía, lista para fusionar con el
   * estado del nombre. El dueño del estado aplica el límite de 15 (mismo clamp
   * que el nativo). Nunca se invoca con cadena vacía (silencio → 'no-audio').
   */
  onResult: (transcript: string) => void;
  /** Capa de red inyectable (tests). Default: `transcribeVoice` real. */
  transcribe?: (audio: Blob) => Promise<string>;
}

export interface UseVoiceFallbackResult {
  status: FallbackStatus;
  isRecording: boolean;
  isTranscribing: boolean;
  errorCode: FallbackErrorCode | null;
  start: () => void;
  stop: () => void;
}

/** Tope de grabación (~10 s, design §2.2): auto-stop que corta subidas largas. */
const MAX_RECORDING_MS = 10_000;

/** MIME preferido y fallbacks para `MediaRecorder` (Firefox puede emitir ogg). */
const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

/** Elige el primer MIME soportado por el navegador; `undefined` deja el default. */
function pickMimeType(): string | undefined {
  const canQuery = typeof MediaRecorder.isTypeSupported === 'function';
  if (!canQuery) return undefined;
  return CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Hook hermano de `useVoiceInput`, fuera de cualquier Provider. Captura audio con
 * `getUserMedia`/`MediaRecorder`, al parar sube el `Blob` vía `transcribe` y
 * expone una máquina de estados análoga a la del nativo para que la UI no
 * distinga la fuente. No posee el estado del nombre: emite el texto por
 * `onResult`. Libera el micrófono al parar y en unmount.
 */
export function useVoiceFallback(options: UseVoiceFallbackOptions): UseVoiceFallbackResult {
  const { onResult, transcribe = defaultTranscribe } = options;

  const [status, setStatus] = useState<FallbackStatus>('idle');
  const [errorCode, setErrorCode] = useState<FallbackErrorCode | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tipo emitido por MediaRecorder, para reconstruir el Blob con el MIME correcto.
  const mimeTypeRef = useRef<string>('audio/webm');

  // Refs para leer callbacks frescos desde los handlers sin recrear la sesión.
  const onResultRef = useRef(onResult);
  const transcribeRef = useRef(transcribe);
  useEffect(() => {
    onResultRef.current = onResult;
    transcribeRef.current = transcribe;
  });

  /** Detiene el temporizador de auto-stop si está activo. */
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Libera el micrófono (para todas las pistas del stream) y olvida el recorder. */
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Cleanup en unmount: aborta grabación, libera micrófono y timer.
  useEffect(() => {
    return () => {
      clearTimer();
      releaseStream();
    };
  }, [clearTimer, releaseStream]);

  const start = useCallback(() => {
    if (recorderRef.current) return; // idempotente: ya hay grabación viva

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // getUserMedia denegado (o sin micrófono) → permiso.
        setErrorCode('permission-denied');
        setStatus('error');
        return;
      }

      const mimeType = pickMimeType();
      mimeTypeRef.current = mimeType ?? 'audio/webm';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        clearTimer();
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        releaseStream();
        setStatus('transcribing');

        transcribeRef.current(blob).then(
          (text) => {
            if (text === '') {
              // Silencio: no se ensucia el nombre con vacío; se avisa por el
              // mismo canal que los demás errores (voice.noSpeech).
              setErrorCode('no-audio');
              setStatus('error');
              return;
            }
            onResultRef.current(text);
            setErrorCode(null);
            setStatus('idle');
          },
          (error: unknown) => {
            setErrorCode(error instanceof ApiError && error.status === 0 ? 'network' : 'unknown');
            setStatus('error');
          },
        );
      };

      streamRef.current = stream;
      recorderRef.current = recorder;
      setErrorCode(null);
      setStatus('recording');
      recorder.start();

      // Auto-stop: corta la grabación pasado el tope y dispara la transcripción.
      timerRef.current = setTimeout(() => {
        if (recorderRef.current) recorderRef.current.stop();
      }, MAX_RECORDING_MS);
    })();
  }, [clearTimer, releaseStream]);

  const stop = useCallback(() => {
    clearTimer();
    recorderRef.current?.stop();
  }, [clearTimer]);

  return {
    status,
    isRecording: status === 'recording',
    isTranscribing: status === 'transcribing',
    errorCode,
    start,
    stop,
  };
}
