import { useBrand } from '../../../brand/ThemeProvider';
import { NAME_MAX_LENGTH } from '../../../brand/core/constants';
import { useVoiceInput, type VoiceErrorCode } from '../../../voice/useVoiceInput';

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
 * dictado por voz con su UX completa (toggle, feedback de escucha, errores y
 * no-soporte). Cero literales: placeholder, plantilla del contador y todos los
 * textos de voz salen de la config de marca. El límite de 15 se aplica en el
 * DOM (`maxLength`) y en el handler (defensa para el dictado, que no pasa por
 * `maxLength`).
 */
export function NameField({ value, onChange }: NameFieldProps) {
  const { text, voice } = useBrand();

  // El dictado por voz set-ea el mismo estado que la escritura, con el mismo tope.
  const { start, stop, isListening, isSupported, status, errorCode, voiceUnavailable } =
    useVoiceInput({
      onResult: (transcript) => onChange(clampToMax(transcript)),
      lang: voice.lang,
    });

  // El micrófono solo tiene sentido si hay forma de dictar: el navegador soporta
  // la API y el servicio no está bloqueado (latch de 'network'). Si no, se oculta
  // por completo (no se deshabilita) y el input manual queda como camino único.
  const showMic = isSupported && !voiceUnavailable;

  const counter = text.counterTemplate
    .replace('{count}', String(value.length))
    .replace('{max}', String(NAME_MAX_LENGTH));

  // Texto de error mapeado desde el código del hook, leyendo la marca activa.
  // 'aborted' no llega como error (el hook lo normaliza a idle con errorCode=null).
  const errorText: string | null =
    status === 'error' && errorCode !== null ? voiceErrorText(errorCode) : null;

  /**
   * Mapea el código de error del hook al texto de la marca activa. 'aborted' no
   * llega aquí (el hook lo normaliza a idle); cae al genérico por exhaustividad.
   */
  function voiceErrorText(code: VoiceErrorCode): string {
    switch (code) {
      case 'not-allowed':
        return voice.permissionDenied;
      case 'no-speech':
        return voice.noSpeech;
      default:
        return voice.genericError; // audio-capture / network / unknown / aborted
    }
  }

  const buttonLabel = isListening ? voice.listeningLabel : voice.startLabel;

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
        {showMic && (
          <button
            type="button"
            aria-label={buttonLabel}
            aria-pressed={isListening}
            onClick={() => (isListening ? stop() : start())}
            className={`shrink-0 ${
              isListening ? 'text-brand-accent motion-safe:animate-pulse' : 'text-brand-primary'
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
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        {showMic && isListening ? (
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
