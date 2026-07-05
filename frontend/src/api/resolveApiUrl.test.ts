import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from './resolveApiUrl';

/**
 * ADR 20.a — El front DERIVA el backend del host en runtime (no build-time),
 * con la plantilla determinista `https://api-<key>.garcia3apps.com`, donde
 * `<key>` es la MISMA key de marca que `resolveBrand` extrae del subdominio
 * (un único label extra sobre `baseDomain`).
 *
 * FIRMA propuesta (posicional, tal como la nombra el ADR:
 * `resolveApiUrl(hostname, appEnv, baseDomain, viteApiUrl)`):
 *
 *   resolveApiUrl(
 *     hostname: string,      // window.location.hostname
 *     appEnv: 'dev' | 'prod',// import.meta.env.VITE_APP_ENV (via env.appEnv)
 *     baseDomain: string,    // BASE_DOMAIN, p.ej. 'garcia3apps.com'
 *     viteApiUrl: string,    // env.apiUrl (fallback horneado de dev/local)
 *   ): string
 *
 * Función PURA, análoga a `resolveBrand`: recibe todas sus dependencias
 * inyectadas, NUNCA lee window/import.meta, NUNCA lanza y SIEMPRE devuelve un
 * `string`. Sin condicionales por marca concreta: es una plantilla.
 *
 * ─── Reglas ────────────────────────────────────────────────────────────────
 * PROD (appEnv === 'prod'):
 *   - `<key>.baseDomain` (un label extra, no vacío, no 'www') →
 *     `https://api-<key>.baseDomain`, tal cual, sin filtrar contra catálogo
 *     (key abierta: 'banco_azteca.<base>' → 'https://api-banco_azteca.<base>').
 *   - APEX (`hostname === baseDomain`), `www.<base>`, host que NO termina en
 *     baseDomain, o label vacío → FALLBACK SEGURO: devuelve `viteApiUrl` tal
 *     cual (NO deriva `api-default.<base>`).
 *
 * DEV/LOCAL (appEnv !== 'prod'):
 *   - Devuelve `viteApiUrl` tal cual, sin mirar el host (como hoy: en dev el
 *     backend es un único `api-dev.` y se hornea en `VITE_API_URL`).
 *
 * ─── Decisión sobre el fallback (apex / www / host ajeno en prod) ───────────
 * Se elige la OPCIÓN SEGURA: NO derivar una URL de marca inventada
 * (`api-default.garcia3apps.com`), sino caer a `viteApiUrl` (el valor horneado
 * del bundle). Razón (alineada con el "por qué" del ADR 20.a):
 *   1. Cuando el host no aporta una key de marca válida NO sabemos a qué marca
 *      pertenece la página; inventar `api-<algo>` corre el riesgo de apuntar a
 *      un backend equivocado o inexistente — justo el cruce que el ADR evita.
 *   2. La derivación por plantilla debe activarse SOLO cuando el host es
 *      físicamente un subdominio de marca real; en cualquier otro caso el
 *      comportamiento debe ser el fallback conocido y horneado, no una URL
 *      adivinada.
 *   3. Reusa exactamente la misma frontera que `resolveBrand` marca entre
 *      "subdominio de marca" y "apex/host sin marca".
 *
 * RED: `resolveApiUrl` NO existe todavía (el import de arriba es el fallo
 * esperado). NADA de implementación en esta fase.
 */
const BASE = 'garcia3apps.com';
// Fallback horneado de un build de prod: en apex/host-ajeno se devuelve tal cual.
const VITE_FALLBACK = 'https://api.garcia3apps.com';

describe('resolveApiUrl — prod (deriva api-<key> del subdominio de marca)', () => {
  it('elektra.<base> → https://api-elektra.garcia3apps.com', () => {
    const url = resolveApiUrl(`elektra.${BASE}`, 'prod', BASE, VITE_FALLBACK);
    expect(url).toBe('https://api-elektra.garcia3apps.com');
  });

  it('shopinbaz.<base> → https://api-shopinbaz.garcia3apps.com', () => {
    const url = resolveApiUrl(`shopinbaz.${BASE}`, 'prod', BASE, VITE_FALLBACK);
    expect(url).toBe('https://api-shopinbaz.garcia3apps.com');
  });

  it('deriva una key ARBITRARIA sin lógica por marca (plantilla, no if key===...)', () => {
    const url = resolveApiUrl(`nuevamarca.${BASE}`, 'prod', BASE, VITE_FALLBACK);
    expect(url).toBe('https://api-nuevamarca.garcia3apps.com');
  });

  it('acepta una key con guion bajo tal cual (key abierta, S3 manda)', () => {
    const url = resolveApiUrl(`banco_azteca.${BASE}`, 'prod', BASE, VITE_FALLBACK);
    expect(url).toBe('https://api-banco_azteca.garcia3apps.com');
  });
});

describe('resolveApiUrl — prod, fallback seguro (apex / www / host ajeno → viteApiUrl)', () => {
  it('APEX (hostname === baseDomain) NO deriva api-default: devuelve viteApiUrl', () => {
    const url = resolveApiUrl(BASE, 'prod', BASE, VITE_FALLBACK);
    // Fallback seguro: NO inventa api-default ni api-garcia3apps.
    expect(url).toBe(VITE_FALLBACK);
    expect(url).not.toContain('api-default');
    expect(url).not.toContain('api-garcia3apps');
  });

  it('www.<base> NO es marca: devuelve viteApiUrl (no api-www)', () => {
    const url = resolveApiUrl(`www.${BASE}`, 'prod', BASE, VITE_FALLBACK);
    expect(url).toBe(VITE_FALLBACK);
    expect(url).not.toContain('api-www');
  });

  it('host que NO termina en baseDomain devuelve viteApiUrl (guard anti-cruce)', () => {
    const url = resolveApiUrl('elektra.otrodominio.com', 'prod', BASE, VITE_FALLBACK);
    // No deriva api-elektra desde un dominio ajeno: la plantilla es del base.
    expect(url).toBe(VITE_FALLBACK);
    expect(url).not.toBe('https://api-elektra.garcia3apps.com');
  });

  it('subdominio anidado (dos labels extra) NO es marca: devuelve viteApiUrl', () => {
    const url = resolveApiUrl(`a.b.${BASE}`, 'prod', BASE, VITE_FALLBACK);
    expect(url).toBe(VITE_FALLBACK);
  });

  it('hostname vacío devuelve viteApiUrl (guard)', () => {
    const url = resolveApiUrl('', 'prod', BASE, VITE_FALLBACK);
    expect(url).toBe(VITE_FALLBACK);
  });
});

describe('resolveApiUrl — dev/local (NO deriva por host: siempre viteApiUrl)', () => {
  it('dev + subdominio de marca NO deriva: devuelve viteApiUrl (backend único api-dev)', () => {
    const devFallback = 'https://api-dev.garcia3apps.com';
    const url = resolveApiUrl(`elektra.${BASE}`, 'dev', BASE, devFallback);
    expect(url).toBe(devFallback);
    expect(url).not.toContain('api-elektra');
  });

  it('dev + apex devuelve viteApiUrl', () => {
    const devFallback = 'https://api-dev.garcia3apps.com';
    const url = resolveApiUrl(`dev.${BASE}`, 'dev', BASE, devFallback);
    expect(url).toBe(devFallback);
  });

  it('local (localhost) devuelve viteApiUrl tal cual (vacío/relativo legítimo)', () => {
    const url = resolveApiUrl('localhost', 'dev', BASE, '');
    expect(url).toBe('');
  });

  it('local con backend en otro puerto devuelve viteApiUrl sin tocarlo', () => {
    const url = resolveApiUrl('localhost', 'dev', BASE, 'http://localhost:3000');
    expect(url).toBe('http://localhost:3000');
  });
});

describe('resolveApiUrl — invariante general', () => {
  it('nunca lanza y siempre devuelve un string', () => {
    const cases: Array<[string, 'dev' | 'prod', string, string]> = [
      [`elektra.${BASE}`, 'prod', BASE, VITE_FALLBACK],
      [BASE, 'prod', BASE, VITE_FALLBACK],
      ['', 'prod', BASE, VITE_FALLBACK],
      ['localhost', 'dev', BASE, ''],
      [`x.${BASE}`, 'dev', BASE, VITE_FALLBACK],
    ];
    for (const [hostname, appEnv, baseDomain, viteApiUrl] of cases) {
      const url = resolveApiUrl(hostname, appEnv, baseDomain, viteApiUrl);
      expect(typeof url).toBe('string');
    }
  });
});
