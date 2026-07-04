/**
 * Barrel de la lógica de dominio de marca (código puro, sin React): schema y
 * validación Zod, resolución/carga de la marca activa, registry de defaults,
 * aplicación de CSS variables al DOM y constantes de producto.
 */
export { brandConfigSchema, parseBrandConfig, type BrandConfig, type BrandKey } from './schema';
export { resolveBrand, type ResolveBrandInput } from './resolveBrand';
export { loadBrand } from './loadBrand';
export { DEFAULT_BRAND, DEFAULT_BRAND_KEY } from './registry';
export { applyBrandToDom } from './applyBrandToDom';
export { NAME_MAX_LENGTH, S3_BASE_URL, BASE_DOMAIN } from './constants';
