/**
 * Fachada pública del módulo de marca. Los consumidores (p.ej. `main.tsx`,
 * componentes de UI) importan de `@/brand` sin conocer la estructura interna
 * (`core/` = lógica de dominio pura; `ThemeProvider/` = capa React).
 */
export * from './core';
export { ThemeProvider, useBrand, BrandContext } from './ThemeProvider';
