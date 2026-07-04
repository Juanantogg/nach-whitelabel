import { useCallback, useEffect, useRef, useState } from 'react';

/** Estados de la máquina del hook. */
export type VoiceStatus = 'unsupported' | 'idle' | 'listening' | 'error';

/** Motivo de error, normalizado desde SpeechRecognitionErrorEvent.error. */
export type VoiceErrorCode =
  'not-allowed' | 'no-speech' | 'audio-capture' | 'network' | 'aborted' | 'unknown';

export interface UseVoiceInputOptions {
  /**
   * Se invoca con la transcripción FINAL, lista para fusionar con el estado del
   * nombre. El dueño del estado decide cómo aplicarla y aplica el límite de 15.
   */
  onResult: (transcript: string) => void;
  /** Locale BCP-47 para el reconocimiento. Default 'es-ES'. */
  lang?: string;
  /** Notificación opcional de error ya normalizado (telemetría/UI extra). */
  onError?: (code: VoiceErrorCode) => void;
}

export interface UseVoiceInputResult {
  status: VoiceStatus;
  isSupported: boolean;
  isListening: boolean;
  errorCode: VoiceErrorCode | null;
  transcript: string;
  start: () => void;
  stop: () => void;
}

/** Códigos crudos de la API que mapeamos 1:1; el resto cae a 'unknown'. */
const KNOWN_ERROR_CODES: readonly VoiceErrorCode[] = [
  'not-allowed',
  'no-speech',
  'audio-capture',
  'network',
  'aborted',
];

function normalizeErrorCode(raw: string): VoiceErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(raw)
    ? (raw as VoiceErrorCode)
    : 'unknown';
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

/**
 * Encapsula la Web SpeechRecognition API. No posee el estado del nombre: emite
 * transcripciones vía `onResult` y expone una máquina de estados
 * (unsupported/idle/listening/error) para que la UI reaccione. Degrada con
 * elegancia si el navegador no soporta la API.
 */
export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputResult {
  const { onResult, lang = 'es-ES', onError } = options;

  // Feature detection en el primer render (lazy initializer): determinista y sin
  // efecto, así la UI conoce el soporte desde el montaje sin un render extra.
  const [isSupported] = useState(() => typeof getSpeechRecognitionCtor() === 'function');
  const [status, setStatus] = useState<VoiceStatus>(() =>
    typeof getSpeechRecognitionCtor() === 'function' ? 'idle' : 'unsupported',
  );
  const [errorCode, setErrorCode] = useState<VoiceErrorCode | null>(null);
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Refs para leer los valores frescos desde los handlers de la API sin
  // recrear la instancia (los handlers se asignan una vez por sesión). Se
  // sincronizan tras el render (no durante) para respetar las reglas de hooks.
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const langRef = useRef(lang);
  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
    langRef.current = lang;
  });

  // Cleanup en unmount: aborta la sesión viva para no dejar el micrófono abierto.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (typeof Ctor !== 'function') return; // no soporte → no-op
    if (recognitionRef.current) return; // idempotente: ya hay sesión viva

    const recognition = new Ctor();
    recognition.lang = langRef.current;
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.resultIndex];
      const text = result?.[0]?.transcript ?? '';
      setTranscript(text);
      onResultRef.current(text);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setStatus((prev) => (prev === 'error' ? prev : 'idle'));
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      recognitionRef.current = null;
      const code = normalizeErrorCode(event.error);
      // 'aborted' es una cancelación ordenada: no es un error visible.
      if (code === 'aborted') {
        setStatus('idle');
        setErrorCode(null);
        return;
      }
      setStatus('error');
      setErrorCode(code);
      onErrorRef.current?.(code);
    };

    recognitionRef.current = recognition;
    setErrorCode(null);
    setStatus('listening');
    recognition.start();
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return {
    status,
    isSupported,
    isListening: status === 'listening',
    errorCode,
    transcript,
    start,
    stop,
  };
}
