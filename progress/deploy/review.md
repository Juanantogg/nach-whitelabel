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
