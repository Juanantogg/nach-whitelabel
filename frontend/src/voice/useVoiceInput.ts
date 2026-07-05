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
  /**
   * Latch de sesión: pasa a `true` (y ya no vuelve a `false`) al primer error
   * 'network' — servicio de reconocimiento bloqueado (p.ej. Brave). La UI oculta
   * el micrófono cuando es `true`. No se persiste entre recargas.
   */
  voiceUnavailable: boolean;
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
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // Marca de sesión: ¿esta sesión emitió alguna transcripción útil? Distingue el
  // cierre normal (idle) de una sesión que arrancó y cerró sin captar nada
  // (no-speech sintético). Se resetea al arrancar cada sesión.
  const hadResultRef = useRef(false);

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
    // interimResults:true → transcripción parcial en vivo (feedback mientras se
    // habla, menos "varios intentos"). continuous:false: una frase, la API cierra
    // sola al detectar el fin del habla.
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Itera desde resultIndex hasta el final concatenando los segmentos nuevos;
      // Chrome antepone espacios en los parciales, de ahí el trim.
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        text += event.results[i]?.[0]?.transcript ?? '';
      }
      text = text.trim();
      if (text === '') return; // nada útil que emitir todavía
      hadResultRef.current = true;
      setTranscript(text);
      onResultRef.current(text);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setStatus((prev) => {
        if (prev === 'error') return prev; // error real ya fijado por onerror
        if (!hadResultRef.current) {
          // Cerró sin captar nada: no-speech SINTÉTICO, mismo estado observable
          // que el no-speech real, para reusar el aviso de marca en la UI.
          setErrorCode('no-speech');
          return 'error';
        }
        return 'idle';
      });
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      recognitionRef.current = null;
      const code = normalizeErrorCode(event.error);
      // 'network' = servicio de reconocimiento bloqueado: latch de sesión que
      // oculta el mic (no se reintenta en un navegador que bloquea el servicio).
      if (code === 'network') setVoiceUnavailable(true);
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
    hadResultRef.current = false;
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
    voiceUnavailable,
    start,
    stop,
  };
}
