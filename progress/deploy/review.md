# Review — deploy / ADR 18 (`?brand=` en deploy dev vía `VITE_APP_ENV`)

**Veredicto:** APROBADO

Fase REFACTOR del ADR 18. RED del tester → GREEN del implementer verificado y limpio.
`pnpm --filter @nach/frontend test` → 197/197 (21 files). `typecheck` (`tsc -b --noEmit`)
sin errores. `lint` (`eslint .`) limpio.

## Checklist

- **TDD:** [x] Los 12 casos nuevos de `resolveBrand.test.ts` (bloques "deploy dev",
  "prod appEnv" y "local isDev") ejercen exactamente la regla del ADR 18. El
  implementer NO relajó tests: la firma pública se extendió con `appEnv?` (aditivo,
  los casos previos sin `appEnv` siguen pasando). Implementación mínima: una sola
  condición (`resolveBrand.ts:63`) + campo de interfaz + wiring. Sin código muerto.
- **White-label:** [x] Cero hex/textos hardcodeados introducidos. `resolveBrand`
  sigue **pura**: `appEnv` entra inyectado (`resolveBrand.ts:20,61`), nunca lee
  `window`/`import.meta` dentro. El wiring de `import.meta.env.VITE_APP_ENV` vive en
  `env.ts` (fuente única) y se pasa desde `main.tsx:19`.
- **Backend:** [x] N/A — feature solo frontend.
- **Calidad:** [x] `VITE_APP_ENV: z.enum(['dev','prod']).default('prod')` (`env.ts:38`)
  replica el patrón de `VITE_DEFAULT_BRAND` (opcional-con-default, nunca fail-fast).
  Tipo `'dev' | 'prod'` en `Env` (`env.ts:19`) y en `ResolveBrandInput` (`resolveBrand.ts:20`),
  sin `any`. Sin `console.log`. Sin dependencias nuevas. Reutiliza `URLSearchParams`
  (API nativa) y el objeto `env` existente; sin abstracción prematura.
- **Documentación:** [x] ADR 18 registrado en `docs/decisiones.md:488-522` con
  contexto/decisión/porqué/descartados. Coherente con la implementación.

## Puntos verificados (los 5 encargos)

1. **ADR 18 exacto:** `acceptsQueryBrand = isDev || appEnv === 'dev'` (`resolveBrand.ts:63`).
   `?brand=` aceptado en local (`isDev`) y deploy dev (`appEnv==='dev'`). Prod
   (`appEnv==='prod'` o ausente) → `brandFromSubdomain`, ignora `?brand=`. Ausente/
   `undefined` cae al camino subdominio (comparación estricta `=== 'dev'` ⇒ solo el
   literal exacto abre la query). **Falla cerrado hacia prod.** Cubierto por el test
   "con appEnv ausente (undefined) se comporta como prod" (líneas 253-261).
2. **White-label / pureza:** OK, ver checklist. La función no leyó `import.meta`.
3. **Coherencia env.ts:** patrón idéntico a `VITE_DEFAULT_BRAND`; naming/tipos correctos.
4. **Sin regresión de prod + default seguro:** un `VITE_APP_ENV` inválido hace fallar
   `safeParse`, y el `env` const cae a `{ apiUrl: '', appEnv: 'prod' }` (`env.ts:73`)
   ⇒ subdominio-solo. Un valor inválido NO puede abrir `?brand=` en prod. `main.tsx:13-20`
   cablea `appEnv: env.appEnv` junto al resto de inputs; correcto.
5. **`.env.example` / docs:** ver nit abajo.

## Nits (no bloqueantes)

1. `.env.example:20-22` documenta `VITE_API_URL` y `VITE_DEFAULT_BRAND` pero NO
   `VITE_APP_ENV`. El repo sí documenta las vars `VITE_*`, así que por coherencia
   convendría añadir una línea (p.ej. `# Entorno de build: dev | prod (default prod)` +
   `VITE_APP_ENV=prod`). Menor: el default `prod` del schema hace que su ausencia sea
   segura y el pipeline la inyecta por rama (ADR 18); no afecta a runtime ni a tests.

---

# Review — deploy / ADR 19 (`loadBrand` sin header `Accept`, preflight CORS)

**Veredicto:** APROBADO

Fase REFACTOR del ADR 19. RED del tester (1 test) → GREEN del implementer verificado y limpio.
`pnpm --filter @nach/frontend test` → **198/198** (21 files). `typecheck` (`tsc -b --noEmit`)
sin errores. `lint` (`eslint .`) limpio. Nada bloqueante.

## Checklist

- **TDD:** [x] El test nuevo (`loadBrand.test.ts:230-267`, bloque "fetch de S3 es una
  petición CORS simple (ADR 19)") aserta lo que exige el ADR: init sin `headers`
  (`expect.not.objectContaining({ headers })`, línea 256) y sin propiedad `Accept`
  (línea 266). El implementer NO relajó tests: los casos previos que asertaban el
  2.º arg con `expect.anything()` (líneas 102, etc.) siguen pasando porque `{}` no es
  `undefined`. Implementación mínima: una sola línea cambiada (`loadBrand.ts:40`,
  `fetchFn(url, {})`). Sin código muerto.
- **White-label:** [x] N/A al cambio; no introduce hex/textos hardcodeados. `loadBrand`
  intacto en su contrato white-label (URL por key sigue siendo contrato).
- **Backend:** [x] N/A — cambio solo frontend.
- **Calidad:** [x] Sin `any` nuevo, sin `console.log`, sin dependencias nuevas. Usa la
  API nativa `fetch`; el init `{}` es lo mínimo (no reintroduce headers). JSDoc veraz.

## Puntos verificados (los 4 encargos)

1. **Cumple el ADR 19:** `fetchFromS3` pasa de
   `fetchFn(url, { headers: { Accept: 'application/json' } })` a `fetchFn(url, {})`
   (`loadBrand.ts:40`). Sin headers no-estándar la petición es CORS-simple (GET puro) →
   no dispara preflight `OPTIONS` → no hay 403 del origen S3/OAC. El init `{}` no
   reintroduce headers. Coincide con la decisión del ADR (`docs/decisiones.md:538-542`).
2. **Sin regresión:** la cadena de fallback sigue intacta y verificada por los tests
   verdes — S3 OK (caso 1), rechazo de red/CORS → seed (dev) / default (prod), `!res.ok`
   /404, JSON malformado y error de Zod. `fetchFromS3` sigue sin lanzar (`try/catch` →
   `null`, `loadBrand.ts:39-47`). Los 197 casos previos + el nuevo = 198 pasan.
3. **Coherencia:** JSDoc de `fetchFromS3` (`loadBrand.ts:24-33`) describe con exactitud
   el porqué (GET simple, sin `Accept`, evita preflight OPTIONS contra S3/OAC, remite al
   ADR 19). Veraz y consistente con `docs/decisiones.md §19`. Sin literales/textos
   hardcodeados nuevos, sin `any`.
4. **Suite local:** test 198/198, `typecheck` y `lint` limpios (corridos por el reviewer).

---

# Review — ADR 20.a (resolveApiUrl deriva backend del host en runtime)

**Veredicto:** APROBADO

## Checklist
- **TDD:** [x] RED real previa (11 tests del tester, el import de `resolveApiUrl`
  fallaba porque el módulo no existía). Ahora GREEN sin relajar tests: la suite
  completa pasa 212/212. El test de `resolveBrand` NO se tocó (solo `resolveBrand.ts`
  aparece modificado en `git status`, el `.test.tsx` intacto), y sus casos siguen
  verdes → la factorización no cambió su semántica.
- **White-label:** [x] La plantilla `https://api-${key}.${baseDomain}`
  (`resolveApiUrl.ts:47`) NO hardcodea `garcia3apps.com`: el dominio se inyecta por
  parámetro. Marca nueva = misma plantilla, cero código. Sin literales de marca ni
  condicionales por marca concreta.
- **Backend:** [x] N/A — cambio solo frontend.
- **Calidad:** [x] Sin `any`, sin `console.log`, sin dependencias nuevas. Ambas
  funciones puras (no leen `window`/`import.meta`), no lanzan, siempre devuelven
  `string`. `typecheck` y `lint` limpios (corridos por el reviewer). JSDoc veraz y
  alineado con el ADR. `brandKeyFromHost` es fuente única, no abstracción prematura:
  reemplaza una divergencia potencial entre dos consumidores.

## Puntos verificados (los 5 encargos)

1. **Cumple EXACTAMENTE el ADR 20.a** (`resolveApiUrl.ts:33-48`):
   - prod + subdominio de marca → `https://api-<key>.<baseDomain>`
     (`elektra.<base>` → `api-elektra.<base>`; key abierta con guion bajo respetada:
     `banco_azteca.<base>` → `api-banco_azteca.<base>`, sin filtrar catálogo).
   - prod + no-marca (apex `hostname===baseDomain`, `www.<base>`, subdominio anidado
     `a.b.<base>`, host ajeno que no termina en `baseDomain`, host vacío) → devuelve
     `viteApiUrl` tal cual. NO inventa `api-default`/`api-www`/`api-garcia3apps`
     (tests `resolveApiUrl.test.ts:81-110` lo aseveran explícitamente).
   - dev/local (`appEnv !== 'prod'`) → `viteApiUrl` tal cual, sin mirar el host
     (`resolveApiUrl.ts:39-41`). Plantilla determinista, cero `if key === 'x'`.
2. **Factorización `brandKeyFromHost` sin cambio de comportamiento:** el diff muestra
   que `brandFromSubdomain` (que devolvía `DEFAULT_BRAND_KEY`) se movió literalmente a
   `brandKeyFromHost` (que devuelve `null`), con las MISMAS guardas
   (`endsWith(suffix)`; `prefix === '' || prefix.includes('.') || prefix === 'www'`).
   `resolveBrand` ahora hace `brandKeyFromHost(...) ?? DEFAULT_BRAND_KEY`
   (`resolveBrand.ts:46`): equivalencia exacta caso a caso (apex/www/anidado/ajeno →
   default). La distinción null-vs-key la usan bien ambos consumidores: `resolveBrand`
   mapea `null`→default; `resolveApiUrl` mapea `null`→fallback seguro. Mejora real
   (fuente de verdad única de "qué marca es este host"), sin acoplamiento raro:
   `brandKeyFromHost` no importa nada de React ni de env.
3. **Pureza:** ninguna de las dos lee `window`/`import.meta`; reciben todo inyectado;
   no lanzan (solo `endsWith`/`slice`/`includes` sobre strings); siempre devuelven
   `string` (`resolveApiUrl`) o `string | null` (`brandKeyFromHost`). Sin `any`. La
   plantilla no hardcodea `garcia3apps.com` (viene por parámetro).
4. **Seguridad del fallback (clave del ADR 20.a):** en prod, el ÚNICO camino que
   produce `https://api-<algo>...` es cuando `brandKeyFromHost` devuelve una key NO
   null, y eso exige que el host sea físicamente `<label>.<baseDomain>` con exactamente
   un label extra distinto de `www`. Cualquier host que no sea subdominio de marca
   legítimo (apex, www, anidado, dominio ajeno, vacío) cae a `viteApiUrl` sin derivar.
   No existe rama que adivine una `api-<algo>` para un host no-marca → no hay cruce
   entre empresas. La `key` derivada es siempre un label del host real del navegador,
   no un valor configurable ni de query.
5. **Suite local:** 212/212 tests, `typecheck` y `lint` limpios (corridos por el
   reviewer).

## Nota (no bloqueante)
El brief mencionaba "11 tests" del tester y "26 tests" de `resolveBrand`; el conteo
real es 14 `it()` en `resolveApiUrl.test.ts` y 23 en `resolveBrand.test.tsx`. Simple
discrepancia de recuento; todos verdes y sin modificar los tests existentes. No afecta
el veredicto. El cableado (main.tsx/env/client) queda fuera de este ciclo, como se
indicó — no se exige aquí.

---

# Review — integración ADR 20.a (cableado de `resolveApiUrl` en `config/env`)

**Veredicto:** APROBADO

Fase REFACTOR del cableado que el ciclo anterior de ADR 20.a dejó explícitamente
fuera ("El cableado (main.tsx/env/client) queda fuera de este ciclo"). RED del
tester (los 4 casos prod-de-marca fallaban porque `validateEnv` ignoraba el
hostname) → GREEN del implementer verificado y limpio. `pnpm --filter @nach/frontend test`
→ **222/222** (22 files). `typecheck` (`tsc -b --noEmit`) sin errores. `lint`
(`eslint .`) limpio. Nada bloqueante.

## Checklist
- **TDD:** [x] RED real: el bloque nuevo `env.test.ts:130-250` (10 `it()`) ejerce el
  cableado; sin el 2.º parámetro `hostname`, los casos prod-de-marca (líneas 133-167,
  227-235) fallaban. Implementer NO relajó tests: los casos previos de `validateEnv`
  (líneas 15-102) que no pasan hostname siguen verdes porque el 2.º parámetro tiene
  default. Implementación mínima: 2 imports + 2.º parámetro con default + `appEnv`
  resuelto antes de `apiUrl` (`env.ts:66-69`). Sin código muerto, sin sobre-ingeniería.
- **White-label:** [x] N/A al cambio; cero hex/textos hardcodeados. La derivación
  reusa la plantilla ya probada de `resolveApiUrl`; sin literales de marca en `env.ts`.
- **Backend:** [x] N/A — cambio solo frontend (`config/env.ts`).
- **Calidad:** [x] Sin `any`, sin `console.log`, sin dependencias nuevas. `hostname`
  se lee de `window` SOLO en el default del parámetro (`env.ts:60`), el borde; la
  lógica es pura y testeable por inyección. Orden `appEnv → apiUrl` correcto
  (`env.ts:66,69`). JSDoc actualizado y veraz (`env.ts:51-56`). Sin abstracción
  prematura: no añade wrapper, reusa `resolveApiUrl`/`BASE_DOMAIN` existentes.
- **Documentación:** [x] ADR 20.a ya registrado (`docs/decisiones.md:603-637`) con
  contexto/decisión/porqué/descartados; describe exactamente `config/env` cableando
  `resolveApiUrl(hostname, appEnv, baseDomain, viteApiUrl)`. Coherente con lo hecho.

## Puntos verificados (los 6 encargos)

1. **Cumple el ADR 20.a en el cableado:** en prod, `env.apiUrl` deriva
   `https://api-<key>.<baseDomain>` por host (tests `env.test.ts:133-167,227-235`
   verdes: elektra/shopinbaz/nuevamarca + appEnv ausente que defaultea a prod). En
   dev/local devuelve `VITE_API_URL` (`env.test.ts:204-225`). Apex/www/host-ajeno →
   fallback seguro (`env.test.ts:169-202`), sin inventar `api-default`.
   **REGRESIÓN DE DEV — NO OCURRE (verificado):** con host `dev.garcia3apps.com`,
   `appEnv='dev'`, `VITE_API_URL='https://api-dev.garcia3apps.com'`, `resolveApiUrl`
   corta en su primera línea (`appEnv !== 'prod' → return viteApiUrl`, `resolveApiUrl.ts:39-41`)
   y NUNCA mira el host. `env.apiUrl` sigue siendo `https://api-dev.garcia3apps.com`.
   El test `env.test.ts:204-216` (dev + host de marca) lo aserta explícitamente
   (`not.toContain('api-elektra')`). El deploy dev que ya funciona en prod no se rompe.
2. **`window` en el borde:** `validateEnv` recibe `hostname` inyectado (default
   `window.location.hostname`, `env.ts:60`), espejo exacto de cómo `source` defaultea
   a `import.meta.env`. El objeto `env` (`env.ts:85-88`) llama a `validateEnv()` sin
   argumentos → toma los defaults, leyendo `window` solo en ese borde. Coherente con
   `main.tsx:14` inyectando `window.location.hostname` a `resolveBrand`. La lógica pura
   (`resolveApiUrl`, `brandKeyFromHost`) no toca `window`.
3. **`client.ts`/`fetchPublicKey.ts` NO necesitan cambios:** ambos consumen
   `apiUrl = env.apiUrl` como default inyectable (`client.ts:26`,
   `crypto/fetchPublicKey.ts:22`), tratándolo como base URL opaca — no asumen que sea
   `VITE_API_URL`. Que `env.apiUrl` pase a ser derivado es transparente para ellos.
   Barrido de consumidores: los ÚNICOS lectores de `env.apiUrl` en producción son esos
   dos; ninguno asume que valga siempre `VITE_API_URL`. Contrato intacto (lo previó el ADR).
4. **Camino de fallo (`safeParse` falla → `apiUrl:''`):** coherente y seguro. Ambas
   vars son opcional-con-default (`env.ts:31-41`), así que `safeParse` NUNCA falla con
   las vars actuales (documentado en `env.ts:26-29,49` y aseverado por el test
   "success siempre true", `env.test.ts:70-75`). El const `env` cae a
   `{ apiUrl:'', appEnv:'prod' }` (`env.ts:87`): fallar-cerrado hacia prod con apiUrl
   vacío (peticiones relativas, no cruce). Rama defensiva inalcanzable con las vars
   actuales, correctamente documentada como red de seguridad futura.
5. **Sin `any`, sin literales/textos nuevos, sin acoplamiento raro; orden correcto:**
   `appEnv` se resuelve antes de `apiUrl` (`env.ts:66` luego `69`), imprescindible
   porque `resolveApiUrl` lo recibe. `BASE_DOMAIN` reusado de `brand/core/constants`
   (fuente única del dominio), no re-hardcodeado. Tipos `'dev'|'prod'` sin `any`.
6. **Suite local (corrida por el reviewer):** 222/222 tests, `typecheck` (`tsc -b`)
   y `lint` (`eslint .`) limpios.

## Nota (no bloqueante)
El `git status` muestra `resolveBrand.ts` modificado: es la factorización de
`brandFromSubdomain → brandKeyFromHost` del ciclo ANTERIOR (ya revisada y aprobada
arriba, "Review — ADR 20.a"), no un cambio de ESTE ciclo. El único archivo tocado
por la integración es `config/env.ts`, como se indicó. El recuento del brief
("4 tests") corresponde a los 4 casos prod-de-marca; el bloque nuevo añade 10 `it()`
en total (incluye fallbacks apex/www/ajeno y la regresión dev). Todos verdes, sin
modificar tests existentes. No afecta el veredicto.
