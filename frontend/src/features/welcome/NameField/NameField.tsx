import { useBrand } from '../../../brand/ThemeProvider';
import { NAME_MAX_LENGTH } from '../../../brand/core/constants';
import { useVoiceInput, type VoiceErrorCode } from '../../../voice/useVoiceInput';
import { useVoiceFallback, type FallbackErrorCode } from '../../../voice/useVoiceFallback';

interface NameFieldProps {
  /** Valor controlado del nombre; el dueño del estado es el padre. */
  value: string;
  /** Notifica el nuevo valor ya recortado al límite de producto. */
  onChange: (value: string) => void;
}

/** Aplica el tope de caracteres común a todas las marcas (input y voz). */
function clampToMax(value: string): string {
  return value.slice(0, NAME_MAX_LENGTH);
}

/**
 * Campo controlado del nombre: input manual + contador de marca + botón de
 * dictado por voz con su UX completa. El dictado tiene dos fuentes que la UI
 * unifica: el camino NATIVO (Web Speech, Chrome/Safari) y, donde el nativo no
 * sirve (Firefox `!isSupported`, Brave `voiceUnavailable`), un FALLBACK por IA
 * (`useVoiceFallback`: graba y transcribe vía backend). Ambos rellenan el mismo
 * estado con el mismo clamp de 15; el input manual es el camino garantizado.
 * Cero literales: todos los textos y colores salen de la marca.
 */
export function NameField({ value, onChange }: NameFieldProps) {
  const { text, voice } = useBrand();

  // Una sola función de aplicación: el MISMO clamp de 15 para ambas fuentes.
  const applyName = (transcript: string): void => onChange(clampToMax(transcript));

  // Se llaman AMBOS hooks siempre (reglas de hooks); solo se cablea el activo.
  const native = useVoiceInput({ onResult: applyName, lang: voice.lang });
  const fallback = useVoiceFallback({ onResult: applyName });

  // El nativo es preferente donde funciona: navegador con soporte y servicio no
  // bloqueado. Si no, se degrada al fallback por IA (antes se ocultaba el mic).
  const nativeAvailable = native.isSupported && !native.voiceUnavailable;
  const useFallback = !nativeAvailable;

  const counter = text.counterTemplate
    .replace('{count}', String(value.length))
    .replace('{max}', String(NAME_MAX_LENGTH));

  /** Mapea el código de error del hook NATIVO al texto de la marca activa. */
  function nativeErrorText(code: VoiceErrorCode): string {
    switch (code) {
      case 'not-allowed':
        return voice.permissionDenied;
      case 'no-speech':
        return voice.noSpeech;
      default:
        return voice.genericError; // audio-capture / network / unknown / aborted
    }
  }

  /** Mapea el código de error del FALLBACK al texto de la marca activa. */
  function fallbackErrorText(code: FallbackErrorCode): string {
    switch (code) {
      case 'permission-denied':
        return voice.permissionDenied;
      case 'no-audio':
        return voice.noSpeech;
      default:
        return voice.genericError; // network / unknown
    }
  }

  // Vista unificada de la fuente activa: qué hace el botón, si está activo, si
  // está ocupado transcribiendo, y el texto de error a mostrar. Cero literales.
  const micActive = useFallback ? fallback.isRecording : native.isListening;
  const isTranscribing = useFallback && fallback.isTranscribing;

  const errorText: string | null = useFallback
    ? fallback.status === 'error' && fallback.errorCode !== null
      ? fallbackErrorText(fallback.errorCode)
      : null
    : native.status === 'error' && native.errorCode !== null
      ? nativeErrorText(native.errorCode)
      : null;

  const buttonLabel = micActive ? voice.listeningLabel : voice.startLabel;

  const onToggleMic = (): void => {
    if (useFallback) {
      if (fallback.isRecording) fallback.stop();
      else fallback.start();
    } else {
      if (native.isListening) native.stop();
      else native.start();
    }
  };

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex items-center gap-2 border-b border-brand-muted focus-within:border-brand-primary">
        <input
          type="text"
          value={value}
          maxLength={NAME_MAX_LENGTH}
          placeholder={text.inputPlaceholder}
          onChange={(event) => onChange(clampToMax(event.target.value))}
          className="w-full bg-transparent py-2 text-brand-text placeholder:text-brand-muted focus:outline-none"
        />
        <button
          type="button"
          aria-label={buttonLabel}
          aria-pressed={micActive}
          aria-busy={isTranscribing}
          onClick={onToggleMic}
          className={`shrink-0 ${
            micActive || isTranscribing
              ? 'text-brand-accent motion-safe:animate-pulse'
              : 'text-brand-primary'
          }`}
        >
          {/* Icono de micrófono; el texto accesible vive en aria-label (marca). */}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        {isTranscribing ? (
          <span className="text-sm text-brand-accent">{voice.transcribingLabel}</span>
        ) : micActive ? (
          <span className="text-sm text-brand-accent">{voice.listeningLabel}</span>
        ) : (
          <span aria-hidden="true" />
        )}
        <span className="text-sm text-brand-muted">{counter}</span>
      </div>

      {/* Región de error accesible: solo se rinde cuando hay error de sesión. */}
      <div role="status" aria-live="polite" className="text-sm text-brand-accent">
        {errorText}
      </div>
    </div>
  );
}
