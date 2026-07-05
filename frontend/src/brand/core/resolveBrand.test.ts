import { describe, expect, it } from 'vitest';
import { resolveBrand } from './resolveBrand';
import { DEFAULT_BRAND_KEY } from './registry';

/**
 * Acceptance #4 reinterpretado (Rev.2 — identidad de marca abierta) + ajuste del
 * tratamiento del APEX (decisión del usuario):
 *
 * resolveBrand distingue "subdominio de marca" de "apex/host sin marca" CONTANDO
 * LABELS contra un dominio base INYECTADO. Nueva dependencia en
 * `ResolveBrandInput`: `baseDomain: string` (p.ej. 'garcia3apps.com').
 *
 * PROD (isDev === false):
 * - `hostname === baseDomain` (apex)                → DEFAULT_BRAND_KEY.
 * - `hostname === 'www.' + baseDomain`              → DEFAULT_BRAND_KEY.
 * - un label extra sobre el base ('elektra.<base>') → ese label ('elektra'),
 *   tal cual, sin filtrar contra catálogo (key abierta:
 *   'banco_azteca.<base>' → 'banco_azteca').
 * - hostname que NO termina en baseDomain, sin subdominio propio, o label
 *   vacío                                           → DEFAULT_BRAND_KEY (guard).
 *
 * DEV (isDev === true) NO cambia: `?brand=` > `VITE_DEFAULT_BRAND` >
 * DEFAULT_BRAND_KEY. El subdominio no se lee; `baseDomain` se ignora en dev.
 *
 * resolveBrand es una función PURA: recibe hostname/search/isDev/defaultBrand/
 * baseDomain inyectados, nunca lee window/import.meta. No hace falta mockear.
 *
 * RED (ajuste apex): la firma actual NO tiene `baseDomain` y el apex hoy hace
 * `hostname.split('.')[0]` → devuelve 'garcia3apps' en vez de DEFAULT_BRAND_KEY.
 * Varios casos de abajo fallan hasta que el implementer cuente labels vs base.
 */
const BASE = 'garcia3apps.com';

describe('resolveBrand — producción (subdominio de marca vs apex, contando labels)', () => {
  it('un label extra sobre el base es la marca, tal cual', () => {
    const key = resolveBrand({
      hostname: `elektra.${BASE}`,
      search: '',
      isDev: false,
      baseDomain: BASE,
    });
    expect(key).toBe('elektra');
  });

  it('acepta un subdominio arbitrario tal cual (S3 decide, no un catálogo)', () => {
    const key = resolveBrand({
      hostname: `banco_azteca.${BASE}`,
      search: '',
      isDev: false,
      baseDomain: BASE,
    });
    expect(key).toBe('banco_azteca');
  });

  it('el apex (hostname === baseDomain) cae a DEFAULT_BRAND_KEY, no a "garcia3apps"', () => {
    const key = resolveBrand({
      hostname: BASE,
      search: '',
      isDev: false,
      baseDomain: BASE,
    });
    expect(key).toBe(DEFAULT_BRAND_KEY);
  });

  it('www.<base> cae a DEFAULT_BRAND_KEY (www no es una marca)', () => {
    const key = resolveBrand({
      hostname: `www.${BASE}`,
      search: '',
      isDev: false,
      baseDomain: BASE,
    });
    expect(key).toBe(DEFAULT_BRAND_KEY);
  });

  it('un hostname que NO termina en baseDomain cae a DEFAULT_BRAND_KEY (guard)', () => {
    const key = resolveBrand({
      hostname: 'elektra.otrodominio.com',
      search: '',
      isDev: false,
      baseDomain: BASE,
    });
    expect(key).toBe(DEFAULT_BRAND_KEY);
  });

  it('con hostname vacío cae a DEFAULT_BRAND_KEY (guard)', () => {
    const key = resolveBrand({
      hostname: '',
      search: '',
      isDev: false,
      baseDomain: BASE,
    });
    expect(key).toBe(DEFAULT_BRAND_KEY);
  });

  it('ignora ?brand= en producción (manda el subdominio)', () => {
    const key = resolveBrand({
      hostname: `shopinbaz.${BASE}`,
      search: '?brand=elektra',
      isDev: false,
      baseDomain: BASE,
    });
    expect(key).toBe('shopinbaz');
  });
});

describe('resolveBrand — desarrollo/tests (?brand= > env > default; baseDomain ignorado)', () => {
  it('respeta ?brand= (solo en dev), incluso una key no bundleada', () => {
    const key = resolveBrand({
      hostname: 'localhost',
      search: '?brand=elektra',
      isDev: true,
      baseDomain: BASE,
    });
    expect(key).toBe('elektra');
  });

  it('devuelve ?brand= tal cual aunque no exista catálogo (loadBrand decide)', () => {
    const key = resolveBrand({
      hostname: 'localhost',
      search: '?brand=marca-que-no-existe',
      isDev: true,
      defaultBrand: 'elektra',
      baseDomain: BASE,
    });
    // Rev.2: en dev NO se filtra contra catálogo → se devuelve tal cual.
    expect(key).toBe('marca-que-no-existe');
  });

  it('usa VITE_DEFAULT_BRAND cuando no hay ?brand=', () => {
    const key = resolveBrand({
      hostname: 'localhost',
      search: '',
      isDev: true,
      defaultBrand: 'elektra',
      baseDomain: BASE,
    });
    expect(key).toBe('elektra');
  });

  it('cae a DEFAULT_BRAND_KEY cuando no hay ?brand= ni VITE_DEFAULT_BRAND', () => {
    const key = resolveBrand({
      hostname: 'localhost',
      search: '',
      isDev: true,
      baseDomain: BASE,
    });
    expect(key).toBe(DEFAULT_BRAND_KEY);
  });

  it('en dev el subdominio NO se lee y baseDomain se ignora (un subdominio de marca no la fuerza)', () => {
    const key = resolveBrand({
      hostname: `elektra.${BASE}`,
      search: '',
      isDev: true,
      baseDomain: BASE,
    });
    // En dev el subdominio se ignora → sin ?brand= ni env → default.
    expect(key).toBe(DEFAULT_BRAND_KEY);
  });
});

/**
 * ADR 18 — `?brand=` en el deploy dev vía `VITE_APP_ENV` (staging ≠ prod).
 *
 * El deploy `dev` (dev.garcia3apps.com) es un BUILD DE PRODUCCIÓN (`isDev === false`),
 * así que hoy resolveBrand resuelve solo por subdominio: `dev.garcia3apps.com` → 'dev'
 * → inexistente → default, y `?brand=` se ignora. Queremos que ese entorno acepte
 * `?brand=` como en local, PERO que prod siga solo-subdominio (garantía del ADR 5).
 *
 * DECISIÓN: nuevo campo inyectado en `ResolveBrandInput`: `appEnv?: 'dev' | 'prod'`
 * (ausente/undefined ⇒ tratar como 'prod'). Nueva regla: se acepta `?brand=` cuando
 * `isDev === true` OR `appEnv === 'dev'`. En prod (no isDev y appEnv !== 'dev')
 * sigue SOLO-subdominio, ignorando `?brand=`.
 *
 * RED: la firma actual NO tiene `appEnv` y la lógica solo mira `isDev`, así que en
 * el bloque "deploy dev" (isDev=false, appEnv='dev') resolveBrand cae al camino
 * subdominio e ignora `?brand=` → estos casos fallan hasta que el implementer añada
 * `appEnv` a la interfaz y a la condición.
 */
describe('resolveBrand — deploy dev (ADR 18: isDev=false + appEnv="dev" acepta ?brand=)', () => {
  it('acepta ?brand= en el deploy dev aunque sea build de producción (isDev=false)', () => {
    const key = resolveBrand({
      hostname: `dev.${BASE}`,
      search: '?brand=elektra',
      isDev: false,
      appEnv: 'dev',
      baseDomain: BASE,
    });
    expect(key).toBe('elektra');
  });

  it('en deploy dev sin ?brand= usa VITE_DEFAULT_BRAND (no el subdominio)', () => {
    const key = resolveBrand({
      hostname: `dev.${BASE}`,
      search: '',
      isDev: false,
      appEnv: 'dev',
      defaultBrand: 'shopinbaz',
      baseDomain: BASE,
    });
    expect(key).toBe('shopinbaz');
  });

  it('en deploy dev sin ?brand= ni VITE_DEFAULT_BRAND cae a DEFAULT_BRAND_KEY', () => {
    const key = resolveBrand({
      hostname: `dev.${BASE}`,
      search: '',
      isDev: false,
      appEnv: 'dev',
      baseDomain: BASE,
    });
    expect(key).toBe(DEFAULT_BRAND_KEY);
  });

  it('el subdominio "dev" NO fuerza la marca "dev" cuando appEnv="dev" (respeta ?brand=)', () => {
    const key = resolveBrand({
      hostname: `dev.${BASE}`,
      search: '?brand=banco_azteca',
      isDev: false,
      appEnv: 'dev',
      baseDomain: BASE,
    });
    // Con appEnv='dev' manda la query, NO el label 'dev' del subdominio.
    expect(key).not.toBe('dev');
    expect(key).toBe('banco_azteca');
  });

  it('el subdominio "dev" sin ?brand= cae a default, nunca a la marca "dev"', () => {
    const key = resolveBrand({
      hostname: `dev.${BASE}`,
      search: '',
      isDev: false,
      appEnv: 'dev',
      baseDomain: BASE,
    });
    expect(key).not.toBe('dev');
    expect(key).toBe(DEFAULT_BRAND_KEY);
  });
});

describe('resolveBrand — prod (ADR 18: appEnv="prod" o ausente ⇒ solo subdominio, ?brand= ignorado)', () => {
  it('con appEnv="prod" el subdominio manda y ?brand= se ignora', () => {
    const key = resolveBrand({
      hostname: `elektra.${BASE}`,
      search: '?brand=shopinbaz',
      isDev: false,
      appEnv: 'prod',
      baseDomain: BASE,
    });
    expect(key).toBe('elektra');
  });

  it('con appEnv ausente (undefined) se comporta como prod: subdominio manda, ?brand= ignorado', () => {
    const key = resolveBrand({
      hostname: `elektra.${BASE}`,
      search: '?brand=shopinbaz',
      isDev: false,
      baseDomain: BASE,
    });
    expect(key).toBe('elektra');
  });

  it('con appEnv="prod" el apex cae a DEFAULT_BRAND_KEY (igual que hoy)', () => {
    const key = resolveBrand({
      hostname: BASE,
      search: '?brand=elektra',
      isDev: false,
      appEnv: 'prod',
      baseDomain: BASE,
    });
    expect(key).toBe(DEFAULT_BRAND_KEY);
  });

  it('con appEnv="prod" www.<base> cae a DEFAULT_BRAND_KEY (igual que hoy)', () => {
    const key = resolveBrand({
      hostname: `www.${BASE}`,
      search: '?brand=elektra',
      isDev: false,
      appEnv: 'prod',
      baseDomain: BASE,
    });
    expect(key).toBe(DEFAULT_BRAND_KEY);
  });
});

describe('resolveBrand — local (ADR 18: isDev=true sigue aceptando ?brand=, con o sin appEnv)', () => {
  it('en local ?brand= gana aunque appEnv="prod" (isDev tiene prioridad)', () => {
    const key = resolveBrand({
      hostname: 'localhost',
      search: '?brand=elektra',
      isDev: true,
      appEnv: 'prod',
      baseDomain: BASE,
    });
    expect(key).toBe('elektra');
  });
});

describe('resolveBrand — invariante general', () => {
  it('nunca lanza y siempre devuelve un string no vacío', () => {
    const inputs = [
      { hostname: '', search: '', isDev: false, baseDomain: BASE },
      { hostname: 'localhost', search: '', isDev: true, baseDomain: BASE },
      { hostname: `x.${BASE}`, search: '', isDev: false, baseDomain: BASE },
      { hostname: BASE, search: '', isDev: false, baseDomain: BASE },
    ];
    for (const input of inputs) {
      const key = resolveBrand(input);
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }
  });
});
