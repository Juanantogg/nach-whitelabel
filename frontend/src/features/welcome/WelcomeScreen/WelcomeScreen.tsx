import { useState } from 'react';
import { useBrand } from '../../../brand/ThemeProvider';
import { DEFAULT_BRAND } from '../../../brand';
import { NameField } from '../NameField';
import { ResultView } from '../ResultView';
import { useNameSubmission } from '../useNameSubmission';

/**
 * Pantalla de bienvenida white-label (maquetas `docs/images/`). Es la dueña del
 * estado del nombre y compone `NameField` + `ResultView` según la máquina de
 * estados de `useNameSubmission`. Cero literales y cero hex: todos los textos
 * salen de `useBrand()` y los colores de tokens `bg-brand-*` / `text-brand-*`.
 */
export function WelcomeScreen() {
  const { text, assets } = useBrand();
  const { status, numero, errorKind, submit, retry } = useNameSubmission();

  const [name, setName] = useState('');

  const isLoading = status === 'loading';
  const isError = status === 'error';
  const isSuccess = status === 'success';

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void submit(name);
  };

  // Si un asset de marca (remoto) falla al cargar, cae al asset bundleado de
  // DEFAULT_BRAND. Guarda anti-bucle: si el src que falló YA es el de default no
  // se reasigna (evita re-disparar onError en cascada). En jsdom `src` viene
  // como URL absoluta, por eso se compara con `.endsWith`.
  const fallbackTo = (fallback: string) => (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.src.endsWith(fallback)) return;
    img.src = fallback;
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center bg-brand-bg px-6 py-10 text-brand-text">
      {/* Layout de las maquetas: logo ANCLADO arriba con aire debajo (mb-*), y el
          cuerpo (ilustración + textos + form/ResultView) centrado en el espacio
          vertical restante vía `flex-1 + justify-center`. En pantallas altas el
          cuerpo queda centrado bajo el logo; en pantallas cortas `flex-1` se
          encoge y el contenido fluye con scroll natural (sin overflow-hidden). */}
      <img
        src={assets.logo}
        alt={assets.logoAlt}
        onError={fallbackTo(DEFAULT_BRAND.assets.logo)}
        className="mb-4 h-10 shrink-0"
      />

      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6">
        <img
          src={assets.illustration}
          alt={assets.illustrationAlt}
          onError={fallbackTo(DEFAULT_BRAND.assets.illustration)}
          className="max-w-xs"
        />

        <h1 className="text-center text-3xl font-[var(--brand-title-weight)] text-brand-primary">
          {text.title}
        </h1>
        <p className="text-center text-brand-muted">{text.subtitle}</p>

        {isSuccess && numero !== null ? (
          <ResultView numero={numero} />
        ) : (
          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
            <p className="text-center text-brand-muted">{text.namePrompt}</p>

            <NameField value={name} onChange={setName} />

            {isError && (
              <p role="alert" className="text-center text-brand-accent">
                {errorKind === 'network' ? text.errorNetwork : text.errorGeneric}
              </p>
            )}

            {isError ? (
              <button
                type="button"
                onClick={() => void retry()}
                className="rounded-[var(--brand-radius)] bg-brand-primary px-4 py-2 text-brand-bg"
              >
                {text.retryLabel}
              </button>
            ) : (
              <button
                type="submit"
                disabled={name.length === 0 || isLoading}
                className="rounded-[var(--brand-radius)] bg-brand-primary px-4 py-2 text-brand-bg disabled:opacity-50"
              >
                {isLoading ? text.loadingLabel : text.submitLabel}
              </button>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
