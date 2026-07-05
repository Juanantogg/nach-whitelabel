/**
 * Extrae la key de marca de un `hostname` en producción, contando labels contra
 * un `baseDomain` inyectado. La frontera es "exactamente UN label extra sobre el
 * base": `elektra.<base>` → `'elektra'`; el apex, `www.<base>`, un host que no
 * termina en `<base>` o un subdominio anidado (`a.b.<base>`) NO son marca.
 *
 * Fuente de verdad ÚNICA de "qué marca es este host", compartida por:
 * - `resolveBrand` (mapea `null` → `DEFAULT_BRAND_KEY`).
 * - `resolveApiUrl` (ADR 20.a: `null` → fallback seguro `viteApiUrl`, no deriva
 *   una URL de marca inventada).
 *
 * No filtra contra catálogo (key abierta, S3 manda: `banco_azteca.<base>` →
 * `'banco_azteca'`). Función pura, nunca lanza.
 *
 * @returns la key de marca, o `null` si el host no es un subdominio de marca.
 */
export function brandKeyFromHost(hostname: string, baseDomain: string): string | null {
  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) {
    return null;
  }

  const prefix = hostname.slice(0, -suffix.length);
  // Exactamente un label extra, no vacío y distinto de 'www'.
  if (prefix === '' || prefix.includes('.') || prefix === 'www') {
    return null;
  }
  return prefix;
}
