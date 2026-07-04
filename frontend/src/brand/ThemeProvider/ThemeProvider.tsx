import { useEffect, type ReactNode } from 'react';
import { applyBrandToDom } from '../core/applyBrandToDom';
import { BrandContext } from './brandContext';
import type { BrandConfig } from '../core/schema';

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
 *
 * El hook `useBrand` vive en `./useBrand` (módulo aparte) para no mezclar el
 * export del componente con el del hook y romper el Fast Refresh de Vite.
 */
export function ThemeProvider({ config, children }: ThemeProviderProps) {
  useEffect(() => {
    applyBrandToDom(config);
  }, [config]);

  return <BrandContext.Provider value={config}>{children}</BrandContext.Provider>;
}
