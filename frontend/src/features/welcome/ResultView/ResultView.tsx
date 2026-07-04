import { useBrand } from '../../../brand/ThemeProvider';

interface ResultViewProps {
  /** Número consecutivo ya descifrado, como string. */
  numero: string;
}

/**
 * Estado success: muestra el consecutivo descifrado acompañado del texto de
 * marca `text.resultLabel`. Cero literales: la etiqueta viene de la config.
 */
export function ResultView({ numero }: ResultViewProps) {
  const { text } = useBrand();

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-brand-muted">{text.resultLabel}</p>
      <p className="text-4xl font-bold text-brand-primary">{numero}</p>
    </div>
  );
}
