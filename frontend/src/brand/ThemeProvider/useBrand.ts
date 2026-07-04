import { useContext } from 'react';
import { BrandContext } from './brandContext';
import type { BrandConfig } from '../core/schema';

/** Devuelve la `BrandConfig` activa. Debe usarse dentro de un `ThemeProvider`. */
export function useBrand(): BrandConfig {
  const config = useContext(BrandContext);
  if (config === null) {
    throw new Error('useBrand debe usarse dentro de un <ThemeProvider>');
  }
  return config;
}
