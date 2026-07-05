import { describe, expect, it, vi } from 'vitest';
import { loadBrand } from './loadBrand';
import { DEFAULT_BRAND } from './registry';
import { parseBrandConfig } from './schema';
import elektraSeed from '../seeds/elektra.json';
import shopinbazSeed from '../seeds/shopinbaz.json';

/**
 * Acceptance #2: "El front carga la marca: en prod fetch desde S3 por
 * subdominio, con fallback al default si falla; en tests, mockeado".
 * Acceptance #3: "fetch fallido → marca por defecto (app no se rompe)".
 *
 * Rev.3 (cadena de fallback por entorno — decisión aprobada en CLAUDE.md):
 *
 *   - Dev  (isDev:true):  S3 por key → si falla → SEED bundleada de esa key →
 *                         si no hay seed → DEFAULT_BRAND.
 *   - Prod (isDev:false): S3 por key → si falla → DEFAULT_BRAND
 *                         (las seeds NO participan en prod, aunque exista una).
 *
 * loadBrand recibe sus deps inyectadas → cero red, seeds controladas por el test.
 *
 * CONTRATO QUE ESTE TEST IMPONE AL IMPLEMENTER (firma a implementar tal cual):
 *
 *   interface LoadBrandDeps {
 *     fetchFn?: typeof fetch;
 *     s3BaseUrl?: string;
 *     isDev?: boolean;
 *     // Registro de seeds bundleadas key -> JSON crudo (sin parsear). Inyectable
 *     // para el test; en runtime el valor por defecto es el registro real de
 *     // seeds/*.json. Solo se consulta en dev tras un fallo de S3.
 *     seeds?: Record<string, unknown>;
 *   }
 *
 * Marcadores distinguibles por fixture (colors.primary):
 *   - elektra   → '242 74 45'
 *   - shopinbaz → '170 59 255'
 *   - default   → '124 92 252'
 *
 * RED (Rev.3): hoy `loadBrand` hace `if (isDev || !s3BaseUrl) return DEFAULT_BRAND;`
 * → en dev NUNCA llama a fetch ni consulta seeds. Los casos 1, 2 y 3 fallan.
 */

// Marca de sanidad de los fixtures: si estas assertions cambian, los tests de
// abajo dejarían de distinguir S3 vs seed vs default.
const ELEKTRA_PRIMARY = '242 74 45';
const SHOPINBAZ_PRIMARY = '170 59 255';
const DEFAULT_PRIMARY = '124 92 252';

// Registro de seeds que el test controla (lo que el implementer inyecta por
// defecto en runtime desde seeds/*.json).
const seeds: Record<string, unknown> = {
  elektra: elektraSeed,
  shopinbaz: shopinbazSeed,
};

/** Helper: un `fetchFn` que responde 200 con el JSON dado. */
function fetchOk(payload: unknown) {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    }),
  ) as unknown as typeof fetch;
}

/** Helper: un `fetchFn` que rechaza (red/CORS caída). */
function fetchReject() {
  return vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
}

/** Helper: un `fetchFn` que responde 404 (res.ok === false). */
function fetch404() {
  return vi.fn(() =>
    Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    }),
  ) as unknown as typeof fetch;
}

describe('loadBrand — dev (S3 primero, luego seed, luego default)', () => {
  it('caso 1 — dev + S3 OK: usa el JSON de S3 (no la seed ni el default)', async () => {
    // S3 devuelve shopinbaz para la key elektra: así, si el resultado fuese la
    // seed de elektra o el default, el color no coincidiría y el test lo cazaría.
    const fetchFn = fetchOk(shopinbazSeed);

    const config = await loadBrand('elektra', {
      isDev: true,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
      seeds,
    });

    // En dev AHORA sí se intenta S3 (hoy no se llama → RED).
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://s3.example.com/brands/elektra.json',
      // ADR 19: el fetch debe seguir apuntando a la URL correcta pero SIN el
      // header `Accept` (ver el test dedicado más abajo). La URL sí es contrato.
      expect.anything(),
    );
    // Se usa lo que devolvió S3, no la seed de elektra ni el default.
    expect(config.colors.primary).toBe(SHOPINBAZ_PRIMARY);
    expect(config).toEqual(parseBrandConfig(shopinbazSeed));
  });

  it('caso 2a — dev + S3 rechazado + seed existe: cae a la seed de esa key (no al default)', async () => {
    const fetchFn = fetchReject();

    const config = await loadBrand('elektra', {
      isDev: true,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
      seeds,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(config.colors.primary).toBe(ELEKTRA_PRIMARY);
    expect(config).toEqual(parseBrandConfig(elektraSeed));
  });

  it('caso 2b — dev + S3 404 + seed existe: cae a la seed de esa key', async () => {
    const fetchFn = fetch404();

    const config = await loadBrand('shopinbaz', {
      isDev: true,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
      seeds,
    });

    expect(config.colors.primary).toBe(SHOPINBAZ_PRIMARY);
    expect(config).toEqual(parseBrandConfig(shopinbazSeed));
  });

  it('caso 2c — dev + S3 con JSON malformado (Zod rechaza) + seed existe: cae a la seed', async () => {
    // S3 responde 200 pero con un color inválido → parseBrandConfig lanza →
    // se trata como fallo de S3 → seed de elektra.
    const fetchFn = fetchOk({ colors: { primary: 'morado' } });

    const config = await loadBrand('elektra', {
      isDev: true,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
      seeds,
    });

    expect(config.colors.primary).toBe(ELEKTRA_PRIMARY);
    expect(config).toEqual(parseBrandConfig(elektraSeed));
  });

  it('caso 3 — dev + S3 falla + sin seed para la key: cae al DEFAULT_BRAND', async () => {
    const fetchFn = fetch404();

    // `banco_azteca` no está en el registro de seeds.
    const config = await loadBrand('banco_azteca', {
      isDev: true,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
      seeds,
    });

    expect(config.colors.primary).toBe(DEFAULT_PRIMARY);
    expect(config).toEqual(DEFAULT_BRAND);
  });
});

describe('loadBrand — producción (S3 con fallback directo al default; seeds NO participan)', () => {
  it('caso 4 — prod + S3 OK: usa el JSON de S3', async () => {
    const fetchFn = fetchOk(elektraSeed);

    const config = await loadBrand('elektra', {
      isDev: false,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
      seeds,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(config.colors.primary).toBe(ELEKTRA_PRIMARY);
    expect(config).toEqual(parseBrandConfig(elektraSeed));
  });

  it('caso 5a — prod + S3 rechazado + existe seed para la key: cae al DEFAULT (NO a la seed)', async () => {
    // Clave del caso: `elektra` TIENE seed, pero en prod las seeds no participan.
    const fetchFn = fetchReject();

    const config = await loadBrand('elektra', {
      isDev: false,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
      seeds,
    });

    // Si cayera a la seed, el color sería ELEKTRA_PRIMARY. Debe ser el default.
    expect(config.colors.primary).toBe(DEFAULT_PRIMARY);
    expect(config).toEqual(DEFAULT_BRAND);
  });

  it('caso 5b — prod + S3 404 + existe seed para la key: cae al DEFAULT', async () => {
    const fetchFn = fetch404();

    const config = await loadBrand('shopinbaz', {
      isDev: false,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
      seeds,
    });

    expect(config.colors.primary).toBe(DEFAULT_PRIMARY);
    expect(config).toEqual(DEFAULT_BRAND);
  });

  it('caso 5c — prod + JSON malformado (Zod rechaza): cae al DEFAULT', async () => {
    const fetchFn = fetchOk({ colors: { primary: 'morado' } });

    const config = await loadBrand('shopinbaz', {
      isDev: false,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
      seeds,
    });

    expect(config).toEqual(DEFAULT_BRAND);
  });
});

describe('loadBrand — fetch de S3 es una petición CORS "simple" (ADR 19)', () => {
  /**
   * ADR 19 (docs/decisiones.md §19): `fetchFromS3` no debe mandar un header
   * `Accept` (ni ningún header no-estándar) en el fetch cross-origin del
   * `<key>.json`. Un `Accept: application/json` convierte la petición en
   * no-simple → dispara un preflight `OPTIONS` que el origen S3 privado (OAC)
   * rechaza con 403 → el navegador aborta con error CORS. La petición debe ser
   * CORS-simple: solo GET, sin headers que fuercen preflight.
   *
   * RED: hoy `fetchFromS3` llama `fetchFn(url, { headers: { Accept: 'application/json' } })`,
   * así que las aserciones "sin Accept" / "sin headers" fallan.
   */

  it('no manda un header `Accept` (evita el preflight OPTIONS contra S3/CloudFront)', async () => {
    const fetchFn = fetchOk(elektraSeed);

    await loadBrand('elektra', {
      isDev: false,
      s3BaseUrl: 'https://s3.example.com/brands',
      fetchFn,
      seeds,
    });

    // La URL sigue siendo contrato; el init NO debe contener headers.Accept.
    expect(fetchFn).toHaveBeenCalledWith(
      'https://s3.example.com/brands/elektra.json',
      expect.not.objectContaining({ headers: expect.anything() }),
    );

    // Aserción explícita adicional sobre el argumento capturado: si viniera un
    // init, no debe traer un header `Accept`.
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers).not.toHaveProperty('Accept');
  });
});

describe('loadBrand — sin s3BaseUrl (no hay bucket configurado)', () => {
  it('cae al default sin intentar fetch cuando s3BaseUrl es vacío (prod)', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;

    const config = await loadBrand('elektra', {
      isDev: false,
      s3BaseUrl: '',
      fetchFn,
      seeds,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(config).toEqual(DEFAULT_BRAND);
  });
});
