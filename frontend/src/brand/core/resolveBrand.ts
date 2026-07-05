import { brandKeyFromHost } from './brandKeyFromHost';
import { DEFAULT_BRAND_KEY } from './registry';
import type { BrandKey } from './schema';

export interface ResolveBrandInput {
  /** `window.location.hostname` */
  hostname: string;
  /** `window.location.search` (incluye el `?`) */
  search: string;
  /** `import.meta.env.DEV` */
  isDev: boolean;
  /** Dominio base de la app en prod (`BASE_DOMAIN`), p.ej. 'garcia3apps.com'. */
  baseDomain: string;
  /** `import.meta.env.VITE_DEFAULT_BRAND` */
  defaultBrand?: string;
  /**
   * Entorno de build (`import.meta.env.VITE_APP_ENV`). El deploy dev es un build
   * de producción (`isDev === false`) pero debe aceptar `?brand=`, así que se
   * distingue con este flag. Ausente/`undefined` ⇒ se trata como `'prod'`.
   */
  appEnv?: 'dev' | 'prod';
}

/**
 * Decide qué marca cargar según el entorno (Rev.2 — identidad de marca abierta,
 * S3 manda). Función pura: recibe todas sus dependencias inyectadas, nunca lee
 * `window`/`import.meta`, nunca lanza y siempre devuelve un `string` no vacío.
 *
 * Se acepta `?brand=` cuando `isDev === true` O `appEnv === 'dev'`; en prod
 * (no `isDev` y `appEnv !== 'dev'`) manda SOLO el subdominio (ADR 5/18). Los
 * tres entornos:
 * - **local** (`isDev === true`): `?brand=` > `VITE_DEFAULT_BRAND` >
 *   `DEFAULT_BRAND_KEY`. El subdominio no se lee; `baseDomain` se ignora.
 * - **deploy dev** (`isDev === false`, `appEnv === 'dev'`): igual que local
 *   (`?brand=` > `VITE_DEFAULT_BRAND` > default), aunque sea build de prod.
 * - **prod** (`isDev === false`, `appEnv !== 'dev'`): el SUBDOMINIO de marca (un
 *   label extra sobre `baseDomain`) es la key, tal cual, sin filtrar contra
 *   catálogo. El apex, `www.<base>`, un host que no termina en `baseDomain` o un
 *   label vacío caen a `DEFAULT_BRAND_KEY`; `?brand=` se ignora.
 */
export function resolveBrand(input: ResolveBrandInput): BrandKey {
  const { hostname, search, isDev, baseDomain, defaultBrand, appEnv } = input;

  const acceptsQueryBrand = isDev || appEnv === 'dev';
  if (!acceptsQueryBrand) {
    return brandKeyFromHost(hostname, baseDomain) ?? DEFAULT_BRAND_KEY;
  }

  const queryBrand = new URLSearchParams(search).get('brand');
  return queryBrand || defaultBrand || DEFAULT_BRAND_KEY;
}
