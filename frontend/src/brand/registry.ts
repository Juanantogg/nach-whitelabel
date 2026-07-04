import { parseBrandConfig, type BrandConfig, type BrandKey } from './schema';
import defaultRaw from './data/default.json';

/**
 * Key de la marca genérica de fallback. En prod, si el subdominio no resuelve a
 * un JSON en S3; en dev sin `?brand=` ni `VITE_DEFAULT_BRAND`, se usa esta.
 */
export const DEFAULT_BRAND_KEY: BrandKey = 'default';

/**
 * ÚNICA marca bundleada en runtime (Rev.2 — identidad de marca abierta):
 * fallback offline neutro. Añadir una marca NO se hace aquí, sino subiendo un
 * `<key>.json` a S3 (cero código). Los seeds de ejemplo (`seeds/*.json`) NO se
 * importan en runtime; son fixtures de test y lo que el deploy sube a S3.
 */
export const DEFAULT_BRAND: BrandConfig = parseBrandConfig(defaultRaw);
