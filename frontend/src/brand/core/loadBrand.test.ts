import { describe, expect, it, vi } from 'vitest';
import { loadBrand } from './loadBrand';
import { DEFAULT_BRAND } from './registry';
import { parseBrandConfig } from './schema';
import elektraSeed from '../seeds/elektra.json';

/**
 * Acceptance #2: "El front carga la marca: en prod fetch desde S3 por
 * subdominio, con fallback al default si falla; en tests, mockeado".
 * Acceptance #3: "fetch fallido → marca por defecto (app no se rompe)".
 *
 * Rev.2 (identidad de marca abierta): `loadBrand(key: string)`. El fallback ante
 * CUALQUIER fallo (404/red/JSON malformado) es SIEMPRE `DEFAULT_BRAND` (ya no
 * `BUNDLED_BRANDS[key]`: no hay catálogo del que sacar la marca concreta
 * offline). En modo test/dev (sin s3BaseUrl) devuelve el default sin red.
 *
 * loadBrand recibe sus deps inyectadas (fetchFn, s3BaseUrl, isDev) → cero red.
 *
 * RED (Rev.2): loadBrand aún cae a `BUNDLED_BRANDS[key]` en vez de a
 * `DEFAULT_BRAND`, e importa el catálogo viejo.
 */
describe('loadBrand — modo test/dev (sin S3)', () => {
  it('resuelve al DEFAULT_BRAND sin llamar a fetch', async () => {
    const fetchFn = vi.fn();
    const config = await loadBrand('elektra', { isDev: true, fetchFn });

    expect(config).toEqual(DEFAULT_BRAND);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('loadBrand — producción (fetch S3 con fallback al default)', () => {
  it('parsea el JSON válido devuelto por el fetch (p.ej. el seed de elektra)', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(elektraSeed),
      }),
    ) as unknown as typeof fetch;

    const config = await loadBrand('elektra', {
      isDev: false,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    // La config devuelta es exactamente el seed parseado por Zod.
    expect(config).toEqual(parseBrandConfig(elektraSeed));
    expect(config.colors.primary).toBe('242 74 45');
  });

  it('cae al DEFAULT_BRAND cuando el fetch es rechazado (CORS/red)', async () => {
    const fetchFn = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch;

    const config = await loadBrand('shopinbaz', {
      isDev: false,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
    });

    expect(config).toEqual(DEFAULT_BRAND);
  });

  it('cae al DEFAULT_BRAND cuando la respuesta es 404 (res.ok === false)', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      }),
    ) as unknown as typeof fetch;

    const config = await loadBrand('shopinbaz', {
      isDev: false,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
    });

    expect(config).toEqual(DEFAULT_BRAND);
  });

  it('cae al DEFAULT_BRAND cuando el JSON está malformado (Zod rechaza)', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        // color inválido → parseBrandConfig lanza → catch → DEFAULT_BRAND.
        json: () => Promise.resolve({ colors: { primary: 'morado' } }),
      }),
    ) as unknown as typeof fetch;

    const config = await loadBrand('shopinbaz', {
      isDev: false,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
    });

    expect(config).toEqual(DEFAULT_BRAND);
  });

  it('cae al DEFAULT_BRAND para una key inexistente (subdominio arbitrario → 404)', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      }),
    ) as unknown as typeof fetch;

    const config = await loadBrand('banco_azteca', {
      isDev: false,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
    });

    expect(config).toEqual(DEFAULT_BRAND);
  });
});
