import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { applyBrandToDom } from './applyBrandToDom';
import type { BrandConfig } from './schema';

const BrandContext = createContext<BrandConfig | null>(null);

interface ThemeProviderProps {
  /**
   * Config de marca YA resuelta (por `resolveBrand` + `loadBrand` fuera del
   * árbol, en `main.tsx`). El Provider es síncrono: no resuelve ni carga nada.
   */
  config: BrandConfig;
  children: ReactNode;
}

/**
 * Provee la `BrandConfig` activa por Context (textos y rutas de asset para los
 * componentes) e inyecta sus CSS variables `--brand-*` en `:root`. Cambiar la
 * prop `config` re-aplica las variables sin recargar.
 */
export function ThemeProvider({ config, children }: ThemeProviderProps) {
  useEffect(() => {
    applyBrandToDom(config);
  }, [config]);

  return <BrandContext.Provider value={config}>{children}</BrandContext.Provider>;
}

/** Devuelve la `BrandConfig` activa. Debe usarse dentro de un `ThemeProvider`. */
export function useBrand(): BrandConfig {
  const config = useContext(BrandContext);
  if (config === null) {
    throw new Error('useBrand debe usarse dentro de un <ThemeProvider>');
  }
  return config;
}
