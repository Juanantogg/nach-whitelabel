import elektraSeed from '../seeds/elektra.json';
import shopinbazSeed from '../seeds/shopinbaz.json';

/**
 * Registro de seeds de ejemplo (key → JSON crudo) SOLO para desarrollo.
 *
 * En dev, `loadBrand` consulta este registro tras un fallo de S3, de modo que un
 * `pnpm dev` sin bucket configurado (o con CORS caído) siga mostrando una marca
 * real en vez del default genérico. En PRODUCCIÓN estas seeds NO participan: los
 * JSON de marca viven en S3. `loadBrand` referencia este módulo únicamente bajo
 * la guarda `import.meta.env.DEV`, que Vite sustituye por `false` en el build de
 * prod → la rama y este import se eliminan por tree-shaking (cero peso en el
 * bundle de producción).
 */
export const DEV_SEEDS: Record<string, unknown> = {
  elektra: elektraSeed,
  shopinbaz: shopinbazSeed,
};
