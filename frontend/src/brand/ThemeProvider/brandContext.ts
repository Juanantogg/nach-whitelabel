import { createContext } from 'react';
import type { BrandConfig } from '../core/schema';

/**
 * Context de la `BrandConfig` activa. Vive en su propio módulo (separado del
 * `ThemeProvider` y del hook `useBrand`) para no mezclar exports de componente
 * con exports de valor/hook: eso rompería el Fast Refresh de Vite
 * (`react-refresh/only-export-components`).
 */
export const BrandContext = createContext<BrandConfig | null>(null);
