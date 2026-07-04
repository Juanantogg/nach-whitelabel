import { useBrand } from '../../../brand/ThemeProvider';
import { NAME_MAX_LENGTH } from '../../../brand/core/constants';
import { useVoiceInput } from '../../../voice/useVoiceInput';

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
 * dictado por voz. Cero literales: placeholder, plantilla del contador y
 * etiqueta accesible del botón salen de la config de marca. El límite de 15 se
 * aplica en el DOM (`maxLength`) y en el handler (defensa para el dictado, que
 * no pasa por `maxLength`).
 */
export function NameField({ value, onChange }: NameFieldProps) {
  const { text, voice } = useBrand();

  // El dictado por voz set-ea el mismo estado que la escritura, con el mismo tope.
  const { start } = useVoiceInput({
    onResult: (transcript) => onChange(clampToMax(transcript)),
    lang: voice.lang,
  });

  const counter = text.counterTemplate
    .replace('{count}', String(value.length))
    .replace('{max}', String(NAME_MAX_LENGTH));

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
          aria-label={voice.startLabel}
          onClick={() => start()}
          className="shrink-0 text-brand-primary"
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
      <span className="self-end text-sm text-brand-muted">{counter}</span>
    </div>
  );
}
