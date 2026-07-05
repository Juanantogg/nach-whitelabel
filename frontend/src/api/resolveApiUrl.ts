import { brandKeyFromHost } from '../brand/core/brandKeyFromHost';

/**
 * Deriva la URL del backend (ADR 20.a). En producción el front DERIVA el backend
 * del host EN RUNTIME con una plantilla determinista `https://api-<key>.<base>`,
 * donde `<key>` es la MISMA key de marca que `resolveBrand` extrae del subdominio
 * (`brandKeyFromHost`, fuente de verdad única). Así un cliente en `elektra.<base>`
 * no puede pegar físicamente al backend de otra marca, aunque hubiera un bug.
 *
 * Función PURA, análoga a `resolveBrand`: recibe todas sus dependencias
 * inyectadas, nunca lee `window`/`import.meta`, nunca lanza y siempre devuelve
 * un `string`. Sin condicionales por marca concreta: es una plantilla.
 *
 * Tres entornos:
 * - **dev/local** (`appEnv !== 'prod'`): devuelve `viteApiUrl` tal cual, sin mirar
 *   el host. En dev el backend es un único `api-dev.` horneado en `VITE_API_URL`,
 *   así que la plantilla `api-<key>` NO aplica.
 * - **prod, subdominio de marca** (`appEnv === 'prod'` y el host es un único label
 *   extra sobre `baseDomain`): `https://api-<key>.<baseDomain>`, sin filtrar
 *   contra catálogo (`banco_azteca.<base>` → `https://api-banco_azteca.<base>`).
 * - **prod, sin marca** (apex, `www.<base>`, host que no termina en `baseDomain`,
 *   subdominio anidado o host vacío): FALLBACK SEGURO → devuelve `viteApiUrl` tal
 *   cual. NO deriva una `api-<algo>` inventada: si el host no aporta una key de
 *   marca válida no sabemos a qué backend pertenece, y adivinarla arriesga apuntar
 *   a un backend equivocado o inexistente — justo el cruce que el ADR 20.a evita.
 *
 * @param hostname   `window.location.hostname`.
 * @param appEnv     entorno de build (`import.meta.env.VITE_APP_ENV`).
 * @param baseDomain dominio base, p.ej. `'garcia3apps.com'`.
 * @param viteApiUrl fallback horneado (`env.apiUrl`), usado en dev y en el
 *                   fallback seguro de prod.
 */
export function resolveApiUrl(
  hostname: string,
  appEnv: 'dev' | 'prod',
  baseDomain: string,
  viteApiUrl: string,
): string {
  if (appEnv !== 'prod') {
    return viteApiUrl;
  }

  const key = brandKeyFromHost(hostname, baseDomain);
  if (key === null) {
    return viteApiUrl;
  }
  return `https://api-${key}.${baseDomain}`;
}
