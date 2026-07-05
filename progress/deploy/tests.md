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

---

# Tests (RED) — ADR 20.a: el front deriva el backend del host en runtime (`api-<key>`)

Fase RED del TDD para el ADR 20.a (`docs/decisiones.md` §20.a). Fuente de verdad:
en **producción** el front deja de hornear una URL de API fija por bundle y
**deriva** el backend del host con la plantilla determinista
`https://api-<key>.garcia3apps.com`, donde `<key>` es la MISMA key de marca que
`resolveBrand` extrae del subdominio. En **dev/local** se mantiene `VITE_API_URL`
(build-time), como hoy.

## Función bajo prueba (nueva, aún NO implementada)

Firma propuesta — **posicional**, tal como la nombra el ADR
(`resolveApiUrl(hostname, appEnv, baseDomain, viteApiUrl)`):

```ts
resolveApiUrl(
  hostname: string,        // window.location.hostname
  appEnv: 'dev' | 'prod',  // env.appEnv (VITE_APP_ENV)
  baseDomain: string,      // BASE_DOMAIN, p.ej. 'garcia3apps.com'
  viteApiUrl: string,      // env.apiUrl (fallback horneado de dev/local)
): string
```

Análoga a `resolveBrand`: PURA, dependencias inyectadas, nunca lee
`window`/`import.meta`, nunca lanza, siempre devuelve `string`. Sin condicionales
por marca concreta: es una plantilla. El contrato de `fetchPublicKey`/`apiFetch`
NO cambia — se les seguirá inyectando `apiUrl` (ahora resuelto por esta función).

## Archivo

`frontend/src/api/resolveApiUrl.test.ts` (nuevo). No se creó ni tocó
`resolveApiUrl.ts` ni ningún otro código de producción.

## Decisión sobre el FALLBACK (apex / www / host ajeno en prod)

**Opción elegida (segura): devolver `viteApiUrl` tal cual, NO derivar
`api-default.garcia3apps.com`.**

Cuando el host en prod NO es un subdominio de marca válido (apex, `www.<base>`,
host que no termina en `baseDomain`, subdominio anidado, o vacío) no sabemos a
qué marca pertenece la página. Inventar `api-<algo>` correría el riesgo de
apuntar a un backend equivocado o inexistente — justo el cruce de datos entre
empresas que el ADR 20.a busca evitar. Por eso el fallback es el valor horneado
conocido (`viteApiUrl`), y la derivación por plantilla se activa SOLO cuando el
host es físicamente un subdominio de marca real. Esto reusa exactamente la
frontera que `resolveBrand` marca entre "subdominio de marca" y "apex/sin marca".

## Casos cubiertos (criterio → test)

Camino feliz (prod deriva):
- `elektra.<base>` → `https://api-elektra.garcia3apps.com`.
- `shopinbaz.<base>` → `https://api-shopinbaz.garcia3apps.com`.
- key **arbitraria** `nuevamarca.<base>` → `https://api-nuevamarca.garcia3apps.com`
  (prueba de que NO hay lógica hardcodeada por marca: es una plantilla).
- key con guion bajo `banco_azteca.<base>` → `https://api-banco_azteca...`
  (key abierta, S3 manda).

Fallback seguro en prod (borde):
- APEX (`hostname === baseDomain`) → `viteApiUrl` (y NO contiene `api-default`
  ni `api-garcia3apps`).
- `www.<base>` → `viteApiUrl` (no `api-www`).
- host que no termina en `baseDomain` (`elektra.otrodominio.com`) → `viteApiUrl`
  (guard anti-cruce: no deriva `api-elektra` de un dominio ajeno).
- subdominio anidado (`a.b.<base>`, dos labels extra) → `viteApiUrl`.
- hostname vacío → `viteApiUrl`.

Dev/local (nunca deriva por host):
- dev + subdominio de marca (`elektra.<base>`) → `viteApiUrl` (backend único
  `api-dev`; NO deriva `api-elektra`).
- dev + apex → `viteApiUrl`.
- local (`localhost`) con `viteApiUrl` vacío → `''` (relativo/vacío legítimo).
- local con backend en otro puerto (`http://localhost:3000`) → sin tocarlo.

Invariante:
- nunca lanza y siempre devuelve `string` sobre una batería de entradas mixtas.

## Veredicto

**RED** — la suite falla al **resolver el import** `./resolveApiUrl` (el módulo
no existe todavía), la razón correcta de fallo en fase RED:

```
FAIL  src/api/resolveApiUrl.test.ts [ src/api/resolveApiUrl.test.ts ]
Error: Failed to resolve import "./resolveApiUrl" from
  "src/api/resolveApiUrl.test.ts". Does the file exist?
  2  |  import { resolveApiUrl } from "./resolveApiUrl";
     |                                 ^
Test Files  1 failed (1)
     Tests  no tests
```

Comando: `pnpm --filter @nach/frontend test resolveApiUrl`.

Listo para el implementer: crear `frontend/src/api/resolveApiUrl.ts` con la
función pura descrita (plantilla `https://api-<key>.<baseDomain>` en prod cuando
el host es un subdominio de marca de un único label; `viteApiUrl` en cualquier
otro caso y en dev/local) y cablearla en `config/env` para alimentar `apiUrl` a
`fetchPublicKey`/`apiFetch` sin cambiar sus contratos.

---

# Tests (RED) — ADR 20.a INTEGRACIÓN: `env.apiUrl` derivado por host (cableado)

Fase RED del TDD para el **cableado** del ADR 20.a. La función pura
`resolveApiUrl(hostname, appEnv, baseDomain, viteApiUrl)` ya existe y pasa
(`frontend/src/api/resolveApiUrl.ts` + su test, GREEN). Esta iteración cubre su
**integración en `config/env`**: `env.apiUrl` deja de ser `VITE_API_URL` a secas y
pasa a ser el resultado de

```
resolveApiUrl(window.location.hostname, appEnv, BASE_DOMAIN, VITE_API_URL)
```

Decisión de integración confirmada con el usuario:
- **prod + host de marca** (`elektra.<base>`) → `env.apiUrl = https://api-elektra.<base>`.
- **prod + host sin marca** (apex / `www` / host ajeno) → `env.apiUrl = VITE_API_URL` (fallback).
- **dev/local** → `env.apiUrl = VITE_API_URL` (como hoy, sin derivar por host).
- `client.ts` y `fetchPublicKey.ts` **NO cambian** (siguen leyendo `env.apiUrl`).

## Archivo

`frontend/src/config/env.test.ts` (extendido con un `describe` nuevo de
integración; NO se tocó `env.ts` ni ningún código de producción).

## Diseño de test / mock del hostname (propuesta al implementer)

Se elige el enfoque **puro-inyectable**, espejo exacto del que ya usa `validateEnv`
para el `source` (`import.meta.env` inyectable). En vez de stubear el `window`
global y re-importar el módulo `env` (frágil: `env` se congela al importarse), se
propone que **`validateEnv` gane un segundo parámetro inyectable `hostname`**:

```ts
validateEnv(
  source: Record<string, string | undefined> = import.meta.env,
  hostname: string = window.location.hostname,
): EnvResult
```

y que, tras parsear el schema, calcule:

```ts
apiUrl: resolveApiUrl(hostname, parsed.VITE_APP_ENV, BASE_DOMAIN, parsed.VITE_API_URL)
```

El objeto `env` lee `window.location.hostname` **en el borde** y se lo pasa a
`validateEnv` (mismo patrón con que `main.tsx` inyecta `window.location.hostname`
a `resolveBrand`). Ventajas: el cableado se prueba pasando el hostname como
argumento — sin `vi.stubGlobal('window', …)`, sin re-import del módulo, sin
depender del `location` de jsdom. `resolveApiUrl` sigue siendo la única fuente de
la plantilla; `env` solo la cablea con `BASE_DOMAIN` y el host real.

## Casos cubiertos (criterio → test)

Camino feliz (prod deriva) — **RED real**:

| Test | hostname | apiUrl esperado |
|---|---|---|
| prod + host de marca (elektra) | `elektra.<base>` | `https://api-elektra.garcia3apps.com` |
| prod + host de marca (shopinbaz) | `shopinbaz.<base>` | `https://api-shopinbaz.garcia3apps.com` |
| prod + marca arbitraria (plantilla, no if por marca) | `nuevamarca.<base>` | `https://api-nuevamarca.garcia3apps.com` |
| appEnv **ausente** ⇒ default `prod` ⇒ deriva | `elektra.<base>`, sin `VITE_APP_ENV` | `https://api-elektra.garcia3apps.com` |

Fallback/borde y dev — **fijan la regresión** (hoy ya coinciden porque `apiUrl`
es `VITE_API_URL`; deben SEGUIR coincidiendo tras el cableado):

| Test | hostname / env | apiUrl esperado |
|---|---|---|
| prod + APEX (no inventa `api-default`) | `<base>`, prod | `VITE_API_URL` |
| prod + `www.<base>` | `www.<base>`, prod | `VITE_API_URL` |
| prod + host ajeno (guard anti-cruce) | `elektra.otrodominio.com`, prod | `VITE_API_URL` (y `!= api-elektra.<base>`) |
| dev + host de marca (backend único `api-dev`) | `elektra.<base>`, dev | `VITE_API_URL` (y sin `api-elektra`) |
| dev + localhost (relativo/vacío legítimo) | `localhost`, dev, `VITE_API_URL=''` | `''` |
| prod + fallback con trailing slash normalizado | `<base>`, `VITE_API_URL='…/'` | `https://api.garcia3apps.com` |

También se anotó el test viejo `se hidrata del entorno vía import.meta.env` con un
comentario aclarando que en tests `VITE_APP_ENV` no es `'prod'`, por lo que su
aserción (`apiUrl === VITE_API_URL sin slash`) sigue siendo el comportamiento dev
correcto — **no se debilitó** ninguna cobertura previa.

## Evidencia RED

### 1. Runtime (`pnpm --filter @nach/frontend test env`)

```
 ❯ src/config/env.test.ts (19 tests | 4 failed)
   × prod + host de marca (elektra.<base>) → apiUrl = https://api-elektra.<base>
   × prod + host de marca (shopinbaz.<base>) → apiUrl = https://api-shopinbaz.<base>
   × prod + host de marca arbitraria (no hay lógica por marca: es plantilla)
   × appEnv ausente se comporta como prod (default del schema) y deriva por host

AssertionError: expected 'https://api.garcia3apps.com'
  to be 'https://api-elektra.garcia3apps.com'

 Test Files  1 failed (1)
      Tests  4 failed | 15 passed (19)
```

Los 4 fallos son por la razón correcta: hoy `apiUrl` es siempre `VITE_API_URL` y
**no deriva por host**. Los 9 tests originales de `env` siguen verdes (dentro de
los 15 que pasan): sin regresión colateral. Los casos de fallback/dev pasan ya
porque su comportamiento esperado coincide con el actual — quedan como red de
regresión de que el implementer no rompa el fallback al cablear.

### 2. Tipos (`pnpm --filter @nach/frontend typecheck`)

```
src/config/env.test.ts: error TS2554: Expected 0-1 arguments, but got 2.  (×10)
```

Confirma que `validateEnv` aún **no acepta el segundo argumento `hostname`** — guía
directa para el implementer: añadir `hostname: string = window.location.hostname`
a la firma y cablear `resolveApiUrl` dentro de `validateEnv` con `BASE_DOMAIN`.

## Veredicto

**RED** — 4 tests fallando en
`frontend/src/config/env.test.ts` (bloque "apiUrl derivado por host, ADR 20.a")
más error de tipos `TS2554` por el `hostname` inyectable ausente en la firma de
`validateEnv`. Listo para el implementer.

Guía de implementación (mínimo para GREEN, sin tocar `client.ts`/`fetchPublicKey.ts`):
1. En `config/env.ts` importar `resolveApiUrl` (de `../api/resolveApiUrl`) y
   `BASE_DOMAIN` (de `../brand/core/constants`).
2. `validateEnv(source, hostname = window.location.hostname)`: tras `safeParse`,
   `apiUrl: resolveApiUrl(hostname, parsed.data.VITE_APP_ENV, BASE_DOMAIN, parsed.data.VITE_API_URL)`.
3. El objeto `env` invoca `validateEnv()` (que lee `window.location.hostname` en el
   borde). Verificar que no hay import circular `api ↔ config` (resolveApiUrl solo
   depende de `brandKeyFromHost`, no de `config/env`, así que no lo hay).
