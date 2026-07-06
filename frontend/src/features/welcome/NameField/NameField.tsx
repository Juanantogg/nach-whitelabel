import { useBrand } from '../../../brand/ThemeProvider';
import { NAME_MAX_LENGTH } from '../../../brand/core/constants';
import { sanitizeDictatedName } from '../../../voice/sanitizeDictatedName';
import { useVoiceRecorder, type RecorderErrorCode } from '../../../voice/useVoiceRecorder';

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
 * dictado por voz con flujo grabar→enviar en 2 clics (ADR 23, motor único Groq).
 * El botón mapea 1:1 la máquina de `useVoiceRecorder`: en idle ofrece "grabar"
 * (icono micrófono, `start()`); en recording ofrece "enviar" (icono avión de
 * papel, `stop()` → sube el audio a Groq); en transcribing queda ocupado
 * (`aria-busy`); en error vuelve a idle y muestra el texto de la marca. El
 * dictado y el teclado rellenan el MISMO estado con el mismo clamp de 15; el
 * input manual es el camino garantizado. Cero literales: todos los textos y
 * colores salen de la marca.
 */
export function NameField({ value, onChange }: NameFieldProps) {
  const { text, voice } = useBrand();

  // El dictado sanitiza la puntuación de borde de Whisper ANTES del clamp de 15;
  // el teclado (onChange del input) NO sanitiza (el punto que escribe el usuario es suyo).
  const applyName = (transcript: string): void =>
    onChange(clampToMax(sanitizeDictatedName(transcript)));

  const recorder = useVoiceRecorder({ onResult: applyName });

  const isRecording = recorder.isRecording;
  const isTranscribing = recorder.isTranscribing;

  const counter = text.counterTemplate
    .replace('{count}', String(value.length))
    .replace('{max}', String(NAME_MAX_LENGTH));

  // Aviso de longitud unificado (teclado y voz): al llegar al tope de 15, ambos
  // caminos recortan vía clampToMax y se muestra el copy de marca (ADR 25).
  const maxLengthReached = value.length >= NAME_MAX_LENGTH;
  const maxLengthText = text.maxLengthReached.replace('{max}', String(NAME_MAX_LENGTH));

  /** Mapea el código de error del motor al texto de la marca activa. */
  function recorderErrorText(code: RecorderErrorCode): string {
    switch (code) {
      case 'permission-denied':
        return voice.permissionDenied;
      case 'no-audio':
        return voice.noSpeech;
      default:
        return voice.genericError; // network / unknown
    }
  }

  const errorText: string | null =
    recorder.status === 'error' && recorder.errorCode !== null
      ? recorderErrorText(recorder.errorCode)
      : null;

  // El icono anticipa la acción del PRÓXIMO clic: micrófono para grabar (idle/
  // error), avión de papel para enviar (recording/transcribing).
  const showSendIcon = isRecording || isTranscribing;

  // aria-label por estado: transcribing → transcribingLabel; recording →
  // listeningLabel; resto (idle/error) → startLabel (reintento en error).
  const buttonLabel = isTranscribing
    ? voice.transcribingLabel
    : isRecording
      ? voice.listeningLabel
      : voice.startLabel;

  const onClickMic = (): void => {
    if (isTranscribing) return;
    if (isRecording) recorder.stop();
    else recorder.start();
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
          aria-busy={isTranscribing}
          disabled={isTranscribing}
          onClick={onClickMic}
          className={`shrink-0 ${
            showSendIcon ? 'text-brand-accent motion-safe:animate-pulse' : 'text-brand-primary'
          }`}
        >
          {showSendIcon ? (
            // Icono "enviar" (avión de papel): el estado accesible vive en el
            // aria-label del botón (marca); el SVG es decorativo.
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
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22 11 13 2 9 22 2z" />
            </svg>
          ) : (
            // Icono de micrófono; el texto accesible vive en aria-label (marca).
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
          )}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        {isTranscribing ? (
          <span className="text-sm text-brand-accent">{voice.transcribingLabel}</span>
        ) : isRecording ? (
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

      {/* Aviso de longitud al tope (teclado y voz), en su propia región para no
          tapar el error de voz. Solo se rinde al alcanzar el límite. */}
      {maxLengthReached && (
        <div aria-live="polite" className="text-sm text-brand-accent">
          {maxLengthText}
        </div>
      )}
    </div>
  );
}
