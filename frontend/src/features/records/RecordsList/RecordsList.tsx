import { useBrand } from '../../../brand/ThemeProvider';
import { DEFAULT_BRAND } from '../../../brand';
import { useRecords } from '../useRecords';

/**
 * Pantalla EXTRA `/records` (ADR 26/27): lista los registros persistidos (nombre
 * COMPLETO + consecutivo) como evidencia visible de que el contador persiste.
 * White-label total: todos los textos salen de `useBrand()` (`text.records`) y
 * los colores de tokens `bg-brand-*`/`text-brand-*`. Cero literales, cero hex.
 * Ruta no listada (accesible solo por URL directa).
 */
export function RecordsList() {
  const { text, assets } = useBrand();
  const state = useRecords();
  const t = text.records;

  // Fallback de asset remoto al bundleado de DEFAULT_BRAND, mismo patrón que
  // WelcomeScreen (guarda anti-bucle: no reasigna si el src que falló ya es el default).
  const fallbackTo = (fallback: string) => (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.src.endsWith(fallback)) return;
    img.src = fallback;
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center bg-brand-bg px-6 py-10 text-brand-text">
      <img
        src={assets.logo}
        alt={assets.logoAlt}
        onError={fallbackTo(DEFAULT_BRAND.assets.logo)}
        className="mb-4 h-10 shrink-0"
      />

      <div className="flex w-full flex-1 flex-col items-center gap-6">
        <h1 className="text-center text-3xl font-[var(--brand-title-weight)] text-brand-primary">
          {t.title}
        </h1>

        {state.status === 'loading' && (
          <p aria-live="polite" className="text-center text-brand-muted">
            {t.loading}
          </p>
        )}

        {state.status === 'error' && (
          <p role="alert" className="text-center text-brand-accent">
            {t.error}
          </p>
        )}

        {state.status === 'empty' && <p className="text-center text-brand-muted">{t.empty}</p>}

        {state.status === 'success' && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-brand-surface">
                <th scope="col" className="py-2 text-left text-brand-muted">
                  {t.nameHeader}
                </th>
                <th scope="col" className="py-2 text-right text-brand-muted">
                  {t.numberHeader}
                </th>
              </tr>
            </thead>
            <tbody>
              {state.records.map((record) => (
                <tr key={record.sequence} className="border-b border-brand-surface">
                  <td className="py-2 text-left text-brand-text">{record.name}</td>
                  <td className="py-2 text-right font-bold text-brand-primary">
                    {record.sequence}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
