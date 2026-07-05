# Tests (RED) — ADR 18: `?brand=` en el deploy dev vía `VITE_APP_ENV`

Fase RED del TDD para el ADR 18 (`docs/decisiones.md` §18). Fuente de verdad: el
deploy `dev` (dev.garcia3apps.com) es un build de producción (`isDev === false`),
así que hoy `resolveBrand` resuelve solo por subdominio e ignora `?brand=`. La
decisión añade un campo inyectado `appEnv?: 'dev' | 'prod'` a `ResolveBrandInput`
(ausente/undefined ⇒ tratar como `'prod'`) y cambia la regla a: se acepta
`?brand=` cuando **`isDev === true` OR `appEnv === 'dev'`**; en prod sigue
solo-subdominio.

## Archivo

`frontend/src/brand/core/resolveBrand.test.ts` (extendido; no se tocó
`resolveBrand.ts` ni ningún código de producción).

## Casos añadidos y criterio de aceptación que mapean

### Bloque "deploy dev" (isDev=false + appEnv='dev' acepta `?brand=`)

| Test | Qué verifica | Criterio ADR 18 |
|---|---|---|
| acepta `?brand=` aunque sea build de producción (isDev=false) | `dev.<base>` + `?brand=elektra` → `elektra` | deploy dev: `?brand=` gana |
| sin `?brand=` usa `VITE_DEFAULT_BRAND` (no el subdominio) | `dev.<base>` + `defaultBrand='shopinbaz'` → `shopinbaz` | deploy dev: `?brand=` > env > default |
| sin `?brand=` ni env cae a `DEFAULT_BRAND_KEY` | `dev.<base>` → `default` | deploy dev: cae a default, no a la marca `dev` |
| el subdominio `dev` NO fuerza la marca `dev` (respeta `?brand=`) | `dev.<base>` + `?brand=banco_azteca` → `banco_azteca` (y `!== 'dev'`) | núcleo del bug: `dev` no debe resolver a la marca `dev` |
| el subdominio `dev` sin `?brand=` cae a default, nunca a `dev` | `dev.<base>` → `default` (y `!== 'dev'`) | idem, camino sin query |

### Bloque "prod" (appEnv='prod' o ausente ⇒ solo subdominio, `?brand=` ignorado)

| Test | Qué verifica | Criterio ADR 18 |
|---|---|---|
| appEnv='prod' → subdominio manda, `?brand=` ignorado | `elektra.<base>` + `?brand=shopinbaz` → `elektra` | prod conserva la garantía del ADR 5 |
| appEnv **ausente** (undefined) se comporta como prod | `elektra.<base>` + `?brand=shopinbaz` → `elektra` | default `prod` si el flag falta |
| appEnv='prod' → apex cae a `DEFAULT_BRAND_KEY` | `<base>` + `?brand=elektra` → `default` | igual que hoy |
| appEnv='prod' → `www.<base>` cae a `DEFAULT_BRAND_KEY` | `www.<base>` + `?brand=elektra` → `default` | igual que hoy |

### Bloque "local" (isDev=true sigue aceptando `?brand=`)

| Test | Qué verifica | Criterio ADR 18 |
|---|---|---|
| en local `?brand=` gana aunque appEnv='prod' | `localhost` + `?brand=elektra`, isDev=true → `elektra` | `isDev` tiene prioridad sobre appEnv |

## Evidencia RED

Los tests del bloque **deploy dev** son el rojo real: hoy `resolveBrand` no conoce
`appEnv` y con `isDev=false` cae al camino subdominio, resolviendo `dev.<base>` →
`dev` en vez de respetar `?brand=` / caer a default. Los tests de **prod** y
**local** pasan ya (el campo extra se ignora hoy y el comportamiento coincide con
el esperado): fijan como regresión que el implementer NO debe romper ese contrato
al añadir `appEnv`.

### 1. Runtime (`pnpm --filter @nach/frontend test resolveBrand`)

```
FAIL  resolveBrand — deploy dev … > acepta ?brand= aunque sea build de producción (isDev=false)
  AssertionError: expected 'default' to be 'elektra'
FAIL  … > en deploy dev sin ?brand= usa VITE_DEFAULT_BRAND (no el subdominio)
  AssertionError: expected 'dev' to be 'shopinbaz'
FAIL  … > en deploy dev sin ?brand= ni VITE_DEFAULT_BRAND cae a DEFAULT_BRAND_KEY
  AssertionError: expected 'dev' to be 'default'
FAIL  … > el subdominio "dev" NO fuerza la marca "dev" cuando appEnv="dev" (respeta ?brand=)
  AssertionError: expected 'dev' not to be 'dev'
FAIL  … > el subdominio "dev" sin ?brand= cae a default, nunca a la marca "dev"
  AssertionError: expected 'dev' not to be 'dev'

 Test Files  1 failed (1)
      Tests  5 failed | 18 passed (23)
```

Los 5 fallos son por la razón correcta (la lógica ignora `appEnv` y resuelve por
subdominio), no por import/setup roto.

### 2. Tipos (`pnpm --filter @nach/frontend typecheck`)

```
resolveBrand.test.ts: error TS2353: Object literal may only specify known
properties, and 'appEnv' does not exist in type 'ResolveBrandInput'.
```

Confirma que el campo `appEnv` aún no está en la interfaz — el implementer debe
añadirlo a `ResolveBrandInput` y a la condición de aceptación de `?brand=`.

## Veredicto

**RED** — 5 tests fallando en
`frontend/src/brand/core/resolveBrand.test.ts` (bloque "deploy dev"), más error de
tipos por `appEnv` ausente en `ResolveBrandInput`. Listo para el implementer.

---

# Tests (RED) — ADR 19: `loadBrand` sin header `Accept` (fetch CORS-simple contra S3/CloudFront)

Fase RED del TDD para el ADR 19 (`docs/decisiones.md` §19). Bug verificado en
runtime (Playwright + curl): `fetchFromS3` en `loadBrand.ts` manda
`headers: { Accept: 'application/json' }`. Ese `Accept` no-estándar convierte el
fetch cross-origin en una petición **no-simple** → dispara un preflight `OPTIONS`
→ el origen S3 privado (OAC) responde 403 → el navegador aborta con error CORS. La
decisión es **eliminar el header** para que la petición sea CORS-simple (solo GET,
sin preflight).

## Archivo

`frontend/src/brand/core/loadBrand.test.ts` (extendido; NO se tocó `loadBrand.ts`
ni ningún código de producción).

## Cambios en el test

1. **Aflojada la aserción del caso 1** (dev + S3 OK): antes exigía
   `expect.objectContaining({ headers: { Accept: 'application/json' } })` como
   segundo argumento del fetch — eso codificaba el comportamiento viejo que el ADR
   19 elimina. Se relaja a `expect.anything()` (la URL sigue siendo contrato; el
   header lo cubre el test dedicado de abajo). Sin este ajuste, el caso 1 pasaría
   a fallar cuando el implementer quite el header, por la razón equivocada.

2. **Caso nuevo (RED):** `no manda un header \`Accept\` (evita el preflight
   OPTIONS contra S3/CloudFront)`.

## Caso añadido y criterio que mapea

| Test | Qué verifica | Criterio ADR 19 |
|---|---|---|
| no manda un header `Accept` (evita el preflight OPTIONS contra S3/CloudFront) | El fetch del `<key>.json` se llama con la URL correcta y un init SIN `headers` (y en todo caso sin `Accept`) | eliminar el `Accept` → petición CORS-simple, sin `OPTIONS` |

### Aserciones exactas

```ts
expect(fetchFn).toHaveBeenCalledWith(
  'https://s3.example.com/brands/elektra.json',
  expect.not.objectContaining({ headers: expect.anything() }),
);

const [, init] = fetchFn.mock.calls[0];
const headers = (init?.headers ?? {}) as Record<string, string>;
expect(headers).not.toHaveProperty('Accept');
```

La primera aserción impone la forma natural del arreglo (init sin `headers`); la
segunda es un cinturón de seguridad explícito: aunque el implementer dejara algún
init, no debe llevar `Accept`.

## Evidencia RED

`pnpm --filter @nach/frontend test loadBrand`

```
 ❯ src/brand/core/loadBrand.test.ts (11 tests | 1 failed) 6ms
     × no manda un header `Accept` (evita el preflight OPTIONS contra S3/CloudFront)

 FAIL  … > no manda un header `Accept` (evita el preflight OPTIONS contra S3/CloudFront)
AssertionError: expected "vi.fn()" to be called with arguments: [ …(2) ]
Received:
  1st vi.fn() call:
  [
    "https://s3.example.com/brands/elektra.json",
-   ObjectNotContaining { "headers": Anything },
+   { "headers": { "Accept": "application/json" } },
  ]

 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

El fallo es por la razón correcta: hoy `fetchFromS3` sí manda
`headers: { Accept: 'application/json' }`. Los otros 10 tests de loadBrand
(incluido el caso 1 aflojado) siguen pasando → no hay regresión colateral.

## Veredicto

**RED** — 1 test fallando en `frontend/src/brand/core/loadBrand.test.ts`
(bloque "fetch de S3 es una petición CORS «simple» (ADR 19)"). Listo para el
implementer: la fix es eliminar el `headers: { Accept: 'application/json' }` del
fetch de `fetchFromS3`.
