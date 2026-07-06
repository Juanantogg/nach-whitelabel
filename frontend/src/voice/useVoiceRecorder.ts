import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/apiError';
import { transcribeVoice as defaultTranscribe } from '../api/transcribeVoice';
import { createAudioLevelMeter, type AudioLevelMeter } from './audioLevelMeter';
import { createSilenceDetector, type SilenceDetector } from './silenceDetector';

/** Estados de la máquina del motor de voz (captura de audio + transcripción). */
export type RecorderStatus = 'idle' | 'recording' | 'transcribing' | 'error';

/** Motivo de error del motor, mapeable a los textos de marca existentes. */
export type RecorderErrorCode = 'permission-denied' | 'no-audio' | 'network' | 'unknown';

export interface UseVoiceRecorderOptions {
  /**
   * Se invoca con la transcripción FINAL no vacía, lista para fusionar con el
   * estado del nombre. El dueño del estado aplica el límite de 15. Nunca se
   * invoca con cadena vacía (silencio → 'no-audio').
   */
  onResult: (transcript: string) => void;
  /** Capa de red inyectable (tests). Default: `transcribeVoice` real. */
  transcribe?: (audio: Blob) => Promise<string>;
}

export interface UseVoiceRecorderResult {
  status: RecorderStatus;
  isRecording: boolean;
  isTranscribing: boolean;
  errorCode: RecorderErrorCode | null;
  start: () => void;
  stop: () => void;
}

/** Tope de grabación (~10 s, design §2.2): auto-stop que corta subidas largas. */
const MAX_RECORDING_MS = 10_000;

// ---------------------------------------------------------------------------
// Detección de silencio local (feature voice_auto_send, ADR 24). Estas cuatro
// constantes son COMPORTAMIENTO COMÚN a todas las marcas (como el límite de 15),
// NO van al schema de marca. Son un punto de partida razonable: dependen de la
// ganancia del micro y del ruido ambiente, así que SE CALIBRAN PROBANDO en runtime
// con micrófono real en los 4 navegadores (SPEECH_THRESHOLD suele caer en 0.03–0.10).
// Invariante: SILENCE_HANG_MS < NO_SPEECH_TIMEOUT_MS < MAX_RECORDING_MS.
// ---------------------------------------------------------------------------
/** Nivel RMS normalizado 0..1 por encima del cual una muestra cuenta como "voz". */
const SPEECH_THRESHOLD = 0.06;
/** Silencio sostenido TRAS haber hablado que dispara el auto-envío. */
const SILENCE_HANG_MS = 1_500;
/** Sin voz nunca durante este tiempo → corta y avisa (no sube audio). */
const NO_SPEECH_TIMEOUT_MS = 3_000;
/** Cadencia de muestreo del nivel de audio (~10 Hz), suficiente para voz. */
const SAMPLE_MS = 100;

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
 * Crea el medidor de nivel; devuelve `null` si la Web Audio API no está disponible.
 * Así la grabación degrada con elegancia (auto-stop por tiempo + 2º clic) en vez
 * de romperse en un navegador sin `AudioContext`.
 */
function tryCreateMeter(stream: MediaStream): AudioLevelMeter | null {
  try {
    return createAudioLevelMeter(stream);
  } catch {
    return null;
  }
}

/**
 * Motor de voz ÚNICO (Groq), fuera de cualquier Provider. Captura audio con
 * `getUserMedia`/`MediaRecorder`, al parar sube el `Blob` vía `transcribe` y
 * expone la máquina de estados que el botón de `NameField` mapea al flujo
 * grabar→enviar. No posee el estado del nombre: emite el texto por `onResult`.
 * Libera el micrófono al parar y en unmount.
 *
 * Con voice_auto_send analiza el nivel de audio localmente (Web Audio API) para
 * (a) auto-enviar cuando el usuario habló y luego calló, y (b) cortar sin subir
 * cuando nunca se habló. El auto-stop por tiempo (10 s) queda como red superior.
 */
export function useVoiceRecorder(options: UseVoiceRecorderOptions): UseVoiceRecorderResult {
  const { onResult, transcribe = defaultTranscribe } = options;

  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [errorCode, setErrorCode] = useState<RecorderErrorCode | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tipo emitido por MediaRecorder, para reconstruir el Blob con el MIME correcto.
  const mimeTypeRef = useRef<string>('audio/webm');

  // Detección de silencio: medidor de nivel (borde Web Audio) + detector puro +
  // bucle de muestreo, con su reloj relativo a la sesión (determinista bajo timers).
  const meterRef = useRef<AudioLevelMeter | null>(null);
  const detectorRef = useRef<SilenceDetector | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedMsRef = useRef(0);

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

  /** Cancela el bucle de muestreo y cierra el AudioContext del medidor de nivel. */
  const teardownMeter = useCallback(() => {
    if (sampleTimerRef.current !== null) {
      clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }
    void meterRef.current?.close();
    meterRef.current = null;
    detectorRef.current = null;
    elapsedMsRef.current = 0;
  }, []);

  /** Libera el micrófono (para todas las pistas del stream) y olvida el recorder. */
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Cleanup en unmount: aborta grabación, libera micrófono, timer y medidor.
  useEffect(() => {
    return () => {
      clearTimer();
      teardownMeter();
      releaseStream();
    };
  }, [clearTimer, teardownMeter, releaseStream]);

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
        teardownMeter();
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

      // Detección de silencio local sobre el MISMO stream (sin abrir otro micrófono).
      // Si el navegador no expone la Web Audio API, la grabación sigue funcionando
      // solo con el auto-stop por tiempo y el 2º clic (degradación elegante).
      const meter = tryCreateMeter(stream);
      if (meter) {
        meterRef.current = meter;
        detectorRef.current = createSilenceDetector({
          speechThreshold: SPEECH_THRESHOLD,
          silenceHangMs: SILENCE_HANG_MS,
          noSpeechTimeoutMs: NO_SPEECH_TIMEOUT_MS,
        });
        elapsedMsRef.current = 0;
        sampleTimerRef.current = setInterval(() => {
          try {
            const activeMeter = meterRef.current;
            const detector = detectorRef.current;
            if (!activeMeter || !detector) return;
            elapsedMsRef.current += SAMPLE_MS;
            const event = detector.push(activeMeter.sample(), elapsedMsRef.current);
            if (event === 'send') {
              // Ruta (a): equivale al 2º clic → onstop ensambla el Blob y sube a Groq.
              if (recorderRef.current) recorderRef.current.stop();
            } else if (event === 'no-speech') {
              // Ruta (b): nunca hubo voz → corta SIN subir. Descarta chunks y no
              // dispara onstop (para no llamar a transcribe con audio vacío).
              const activeRecorder = recorderRef.current;
              if (activeRecorder) activeRecorder.onstop = null;
              clearTimer();
              teardownMeter();
              chunksRef.current = [];
              if (activeRecorder && activeRecorder.state !== 'inactive') activeRecorder.stop();
              releaseStream();
              setErrorCode('no-audio');
              setStatus('error');
            }
          } catch {
            // Defensa: si el muestreo/detector fallara en un tick, degradamos por
            // la vía segura del stop manual → onstop ensambla lo grabado y sube.
            // Así no dejamos mic/AudioContext/intervalo colgados esperando el
            // auto-stop de 10s. El path feliz no pasa por aquí.
            if (recorderRef.current) recorderRef.current.stop();
          }
        }, SAMPLE_MS);
      }

      // Auto-stop: corta la grabación pasado el tope y dispara la transcripción.
      timerRef.current = setTimeout(() => {
        if (recorderRef.current) recorderRef.current.stop();
      }, MAX_RECORDING_MS);
    })();
  }, [clearTimer, teardownMeter, releaseStream]);

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
