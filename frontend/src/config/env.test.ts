/**
 * Tests RED — config/env (fuente única y validada del acceso a VITE_*).
 *
 * Mapea acceptance del design:
 *  #1 `validateEnv(source)` es pura, source inyectable, NUNCA lanza; success siempre true.
 *  #2 `env.apiUrl` es string sin trailing slash; '' es válido.
 *  #3 `env.defaultBrand` es undefined cuando la var está ausente o vacía.
 *
 * RED esperado: `../config/env` aún no existe → import falla, tests en rojo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, validateEnv } from './env';
import { BASE_DOMAIN } from '../brand/core/constants';

describe('validateEnv — función pura sobre source inyectable', () => {
  it('con apiUrl ausente devuelve apiUrl = "" (dev legítimo)', () => {
    const result = validateEnv({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('');
    }
  });

  it('recorta el trailing slash de apiUrl (evita doble barra futura)', () => {
    const result = validateEnv({ VITE_API_URL: 'https://api.example.com/' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://api.example.com');
    }
  });

  it('preserva apiUrl sin trailing slash tal cual', () => {
    const result = validateEnv({ VITE_API_URL: 'https://api.example.com' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://api.example.com');
    }
  });

  it('defaultBrand es undefined cuando la var está ausente', () => {
    const result = validateEnv({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultBrand).toBeUndefined();
    }
  });

  it('defaultBrand es undefined cuando la var está vacía', () => {
    const result = validateEnv({ VITE_DEFAULT_BRAND: '' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultBrand).toBeUndefined();
    }
  });

  it('defaultBrand refleja el valor cuando la var está presente', () => {
    const result = validateEnv({ VITE_DEFAULT_BRAND: 'elektra' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultBrand).toBe('elektra');
    }
  });

  it('success es siempre true con las vars actuales (nunca falla)', () => {
    // Ninguna de las dos vars es requerida → safeParse jamás falla.
    expect(validateEnv({}).success).toBe(true);
    expect(validateEnv({ VITE_API_URL: 'x', VITE_DEFAULT_BRAND: 'y' }).success).toBe(true);
    expect(validateEnv({ VITE_API_URL: '' }).success).toBe(true);
  });
});

describe('env — objeto ya resuelto del entorno', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('existe y expone apiUrl (string) sin lanzar aunque el entorno esté vacío', () => {
    // El objeto `env` se hidrata al importarse; con las vars actuales nunca lanza.
    expect(env).toBeDefined();
    expect(typeof env.apiUrl).toBe('string');
  });

  it('se hidrata del entorno vía import.meta.env (validado por validateEnv)', () => {
    // Verifica el mecanismo de hidratación de forma pura (sin re-import del módulo):
    // lo que `env` refleja del entorno es exactamente lo que valida `validateEnv`.
    vi.stubEnv('VITE_API_URL', 'https://stubbed.example.com/');

    const result = validateEnv(import.meta.env);

    expect(result.success).toBe(true);
    if (result.success) {
      // En dev (import.meta.env.VITE_APP_ENV no es 'prod' en tests) el apiUrl es
      // el VITE_API_URL horneado tal cual, sin derivar por host.
      expect(result.data.apiUrl).toBe('https://stubbed.example.com');
    }
  });
});

/**
 * INTEGRACIÓN ADR 20.a — `env.apiUrl` DERIVADO POR HOST (cableado de `resolveApiUrl`).
 *
 * La función pura `resolveApiUrl(hostname, appEnv, baseDomain, viteApiUrl)` ya
 * existe y está probada en `../api/resolveApiUrl.test.ts`. Estos tests capturan su
 * CABLEADO en `config/env`: `env.apiUrl` debe pasar a ser el resultado de
 *
 *   resolveApiUrl(window.location.hostname, appEnv, BASE_DOMAIN, VITE_API_URL)
 *
 * de modo que en prod un host de marca (`elektra.<base>`) derive
 * `https://api-elektra.<base>`, y que apex/www/host-ajeno/dev caigan al
 * VITE_API_URL horneado (fallback).
 *
 * DISEÑO DE TEST (propuesto al implementer, mínimo y coherente con lo existente):
 * `validateEnv` gana un SEGUNDO parámetro INYECTABLE `hostname` (default
 * `window.location.hostname`), espejo de cómo `source` (default `import.meta.env`)
 * ya se inyecta hoy. Así el cableado se prueba de forma PURA, sin re-importar el
 * módulo ni stubear el `window` global: se pasa el hostname como argumento. El
 * objeto `env` lee `window.location.hostname` en el BORDE y se lo pasa a
 * `validateEnv` (igual que `main.tsx` inyecta `window.location.hostname` a
 * `resolveBrand`). `resolveApiUrl` sigue siendo la única fuente de la plantilla.
 *
 * RED esperado HOY: `validateEnv` ignora el segundo argumento y `apiUrl` es
 * siempre `VITE_API_URL` (no deriva por host) → los casos prod-de-marca fallan.
 */
describe('validateEnv — apiUrl derivado por host (cableado de resolveApiUrl, ADR 20.a)', () => {
  const VITE_FALLBACK = 'https://api.garcia3apps.com';

  it('prod + host de marca (elektra.<base>) → apiUrl = https://api-elektra.<base>', () => {
    const result = validateEnv(
      { VITE_API_URL: VITE_FALLBACK, VITE_APP_ENV: 'prod' },
      `elektra.${BASE_DOMAIN}`,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://api-elektra.garcia3apps.com');
    }
  });

  it('prod + host de marca (shopinbaz.<base>) → apiUrl = https://api-shopinbaz.<base>', () => {
    const result = validateEnv(
      { VITE_API_URL: VITE_FALLBACK, VITE_APP_ENV: 'prod' },
      `shopinbaz.${BASE_DOMAIN}`,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://api-shopinbaz.garcia3apps.com');
    }
  });

  it('prod + host de marca arbitraria (no hay lógica por marca: es plantilla)', () => {
    const result = validateEnv(
      { VITE_API_URL: VITE_FALLBACK, VITE_APP_ENV: 'prod' },
      `nuevamarca.${BASE_DOMAIN}`,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://api-nuevamarca.garcia3apps.com');
    }
  });

  it('prod + APEX (host === baseDomain) → fallback VITE_API_URL (no inventa api-default)', () => {
    const result = validateEnv({ VITE_API_URL: VITE_FALLBACK, VITE_APP_ENV: 'prod' }, BASE_DOMAIN);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe(VITE_FALLBACK);
      expect(result.data.apiUrl).not.toContain('api-default');
    }
  });

  it('prod + www.<base> (no es marca) → fallback VITE_API_URL', () => {
    const result = validateEnv(
      { VITE_API_URL: VITE_FALLBACK, VITE_APP_ENV: 'prod' },
      `www.${BASE_DOMAIN}`,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe(VITE_FALLBACK);
    }
  });

  it('prod + host ajeno (no termina en baseDomain) → fallback VITE_API_URL (guard anti-cruce)', () => {
    const result = validateEnv(
      { VITE_API_URL: VITE_FALLBACK, VITE_APP_ENV: 'prod' },
      'elektra.otrodominio.com',
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe(VITE_FALLBACK);
      expect(result.data.apiUrl).not.toBe('https://api-elektra.garcia3apps.com');
    }
  });

  it('dev + host de marca (elektra.<base>) NO deriva: apiUrl = VITE_API_URL (backend único api-dev)', () => {
    const devFallback = 'https://api-dev.garcia3apps.com';
    const result = validateEnv(
      { VITE_API_URL: devFallback, VITE_APP_ENV: 'dev' },
      `elektra.${BASE_DOMAIN}`,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe(devFallback);
      expect(result.data.apiUrl).not.toContain('api-elektra');
    }
  });

  it('dev + localhost → apiUrl = VITE_API_URL tal cual (relativo/vacío legítimo)', () => {
    const result = validateEnv({ VITE_API_URL: '', VITE_APP_ENV: 'dev' }, 'localhost');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('');
    }
  });

  it('appEnv ausente se comporta como prod (default del schema) y deriva por host', () => {
    // Sin VITE_APP_ENV el schema default es 'prod' → debe derivar por host.
    const result = validateEnv({ VITE_API_URL: VITE_FALLBACK }, `elektra.${BASE_DOMAIN}`);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://api-elektra.garcia3apps.com');
    }
  });

  it('deriva contra el VITE_API_URL ya normalizado (sin trailing slash) como fallback', () => {
    // El fallback horneado con trailing slash se normaliza antes de usarse como
    // viteApiUrl del resolver (apex → fallback ya recortado).
    const result = validateEnv(
      { VITE_API_URL: 'https://api.garcia3apps.com/', VITE_APP_ENV: 'prod' },
      BASE_DOMAIN,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://api.garcia3apps.com');
    }
  });
});
