import { describe, expect, it } from 'vitest';
import * as registry from './registry';
import { DEFAULT_BRAND, DEFAULT_BRAND_KEY } from './registry';
import { parseBrandConfig } from './schema';
import shopinbazSeed from './seeds/shopinbaz.json';
import elektraSeed from './seeds/elektra.json';

/**
 * Acceptance #5 reinterpretado (Rev.2): el fallback offline ahora es UN default
 * genérico (`DEFAULT_BRAND`), no un catálogo de 2. Las 2 marcas de ejemplo pasan
 * a ser SEEDS (fixtures de test + lo que el deploy sube a S3), no runtime.
 *
 * RED (Rev.2): el registry aún expone el catálogo viejo (`BUNDLED_BRANDS`,
 * `BRAND_KEYS`) en vez de `DEFAULT_BRAND` / `DEFAULT_BRAND_KEY = 'default'`.
 */
describe('registry — único default genérico de runtime (Rev.2)', () => {
  it('DEFAULT_BRAND_KEY es la marca genérica "default"', () => {
    expect(DEFAULT_BRAND_KEY).toBe('default');
  });

  it('DEFAULT_BRAND es una BrandConfig válida y completa (parseada)', () => {
    expect(DEFAULT_BRAND.key).toBe('default');
    expect(DEFAULT_BRAND.text.title.length).toBeGreaterThan(0);
    expect(DEFAULT_BRAND.assets.illustration.length).toBeGreaterThan(0);
    expect(DEFAULT_BRAND.colors.primary).toMatch(/^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/);
  });

  it('DEFAULT_BRAND es una marca DISTINTA de shopinbaz y elektra (neutra)', () => {
    // No copia la identidad de ningún cliente: su primario no es ni el morado
    // de shopinbaz ni el rojo de elektra.
    expect(DEFAULT_BRAND.colors.primary).not.toBe(parseBrandConfig(shopinbazSeed).colors.primary);
    expect(DEFAULT_BRAND.colors.primary).not.toBe(parseBrandConfig(elektraSeed).colors.primary);
    expect(DEFAULT_BRAND.key).not.toBe('shopinbaz');
    expect(DEFAULT_BRAND.key).not.toBe('elektra');
  });

  it('el catálogo cerrado desapareció: sin BUNDLED_BRANDS ni BRAND_KEYS', () => {
    expect(registry).not.toHaveProperty('BUNDLED_BRANDS');
    expect(registry).not.toHaveProperty('BRAND_KEYS');
  });
});

/**
 * Acceptance #5 (ancla de dato, ahora contra los SEEDS): las 2 marcas de ejemplo
 * siguen existiendo como seeds distinguibles (morada vs roja). Literales
 * INTENCIONALES: deben romperse si se confunde la identidad de una marca.
 */
describe('seeds de marcas de ejemplo (fixtures para S3 + tests)', () => {
  it('ANCLA: shopinbaz es morada (colors.primary === "170 59 255")', () => {
    expect(parseBrandConfig(shopinbazSeed).colors.primary).toBe('170 59 255');
  });

  it('ANCLA: elektra es roja (colors.primary === "242 74 45")', () => {
    expect(parseBrandConfig(elektraSeed).colors.primary).toBe('242 74 45');
  });
});
