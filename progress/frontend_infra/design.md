# Design — frontend_infra

## Objetivo

Andamiaje de buenas prácticas de `@nach/frontend` antes de montar el flujo real
(welcome_screen). Tres piezas y su unificación con lo que ya existe:

1. `src/config/env.ts` — fuente ÚNICA, tipada y validada, del acceso a
   `import.meta.env.VITE_*` (hoy disperso y sin validar en `fetchPublicKey.ts` y
   `resolveBrand.ts`).
2. `src/api/*` — capa que centraliza `fetch`, base URL (desde `env`) y forma de
   error del backend, con `fetch` inyectable para tests.
3. `ErrorBoundary` raíz que envuelve `<App />` en `main.tsx` y muestra un
   fallback ante fallos de render/cifrado/red, para que la app nunca quede en
   blanco.

Principio rector heredado de `brand_config`: **el front no rompe en blanco por
una env ausente**. La resiliencia manda; la validación de env NO es fail-fast al
import (a diferencia del backend, que sí aborta el boot).

NO es requisito del enunciado; sostiene el criterio "buenas prácticas". Cero
`any`, cero colores/textos de marca literales.

## Contrato / arquitectura

### 1. `src/config/env.ts`

Espejo conceptual del `backend/src/config/env.ts` (objeto `env` + schema Zod +
función de validación pura), PERO con dos diferencias deliberadas justificadas
por el entorno del front:

- **No hay clave de cifrado** en el front (la pública se pide al backend en
  runtime vía `fetchPublicKey`). Solo hay dos variables: `VITE_API_URL` y
  `VITE_DEFAULT_BRAND`.
- **No fail-fast al import.** El backend puede abortar el boot si falta
  `MONGODB_URI`; el front, no: una env ausente debe degradar con default, no
  dejar la pantalla en blanco. Coherente con la filosofía de `brand_config`
  (`loadBrand` siempre cae a `default.json`, nunca lanza).

Ambas variables son **opcionales-con-default** (no requeridas):

- `VITE_API_URL`: en dev suele ser relativa/vacía (el proxy de Vite o rutas
  relativas contra el mismo origen). Default `''`. Semántica idéntica a la que
  ya usa `fetchPublicKey` (`?? ''`), que se preserva.
- `VITE_DEFAULT_BRAND`: opcional; si ausente, `resolveBrand` ya cae a
  `DEFAULT_BRAND_KEY`. Aquí se normaliza a `undefined` (no `''`) para respetar
  el `queryBrand || defaultBrand || DEFAULT_BRAND_KEY` existente, donde `''` y
  `undefined` son equivalentes (falsy) pero `undefined` es la intención.

**Schema Zod (esquema propuesto, el implementer afina literales):**

```ts
const envSchema = z.object({
  VITE_API_URL: z.string().default(''),
  VITE_DEFAULT_BRAND: z.string().optional(),
});
```

Notas de schema:
- `VITE_API_URL` NO se valida como URL absoluta (`z.string().url()`) porque en
  dev es legítimamente relativa/vacía. Solo se normaliza: si trae `/` final, se
  recorta (evita `//crypto/public-key`). Esa normalización (trim de trailing
  slash) es la única transformación; el implementer la aplica con `.transform`
  o en la construcción del objeto `env`.
- No hay `NODE_ENV` propio: para el flag dev/prod el front ya usa
  `import.meta.env.DEV` (booleano nativo de Vite), consumido por `resolveBrand`.
  `env.ts` puede reexportar `isDev = import.meta.env.DEV` para centralizar,
  pero NO es requisito de la feature; queda como opcional (ver Riesgos).

**Exports:**

```ts
export interface Env {
  apiUrl: string;        // normalizado, sin trailing slash; '' válido
  defaultBrand?: string; // undefined si ausente/vacío
}

// Objeto ya resuelto y validado, listo para consumir en toda la app.
export const env: Env;

// Validación pura y testeable (misma convención "devuelve resultado" del back).
export function validateEnv(
  source?: Record<string, string | undefined>,
): { success: true; data: Env } | { success: false; error: z.ZodError };
```

- `env` se construye llamando a `validateEnv(import.meta.env as ...)` en el
  módulo. Como todos los campos tienen default/optional, `safeParse` **nunca
  falla** con estas dos vars → `env` siempre queda poblado. Si en el futuro se
  añade una var requerida, `env` cae a los defaults del schema y (opcional)
  registra un `console.warn`, sin lanzar. Esto materializa "no romper en
  blanco".
- `validateEnv` recibe `source` inyectable (default `import.meta.env`) para que
  los tests no dependan del entorno global — mismo patrón que el back.

**Cómo se testea `import.meta.env` bajo Vitest:**

- Preferir `vi.stubEnv('VITE_API_URL', ...)` + `vi.unstubAllEnvs()` en
  `afterEach` para el objeto `env` derivado del entorno real. Vitest soporta
  `stubEnv` sobre `import.meta.env` además de `process.env`.
- Para los casos de tabla (present/ausente/con slash/valor raro), testear
  `validateEnv(fakeSource)` pasándole el `source` a mano — es puro y no toca
  `import.meta.env`. Esta es la vía principal (cubre la lógica sin acoplarse a
  Vite). `stubEnv` cubre solo el smoke de que `env` se hidrata del entorno.

### 2. `src/api/*`

Módulo nuevo que centraliza el acceso al backend. Sigue el patrón de inyección
de deps YA establecido (`fetchFn`/`apiUrl` opcionales, como `loadBrand` y
`fetchPublicKey`).

**Archivos:**
- `src/api/apiError.ts` — clase `ApiError` (forma de error consistente).
- `src/api/client.ts` — función `apiFetch` (fetch centralizado).
- `src/api/index.ts` — reexporta lo público.

**`ApiError`** (error tipado, no un `Error` genérico, para que la UI/ErrorBoundary
pueda distinguir fallos de red/HTTP de otros):

```ts
export class ApiError extends Error {
  readonly status: number; // 0 = red caída / sin respuesta HTTP
  constructor(message: string, status: number, options?: ErrorOptions);
}
```

- `status: 0` convención para "no hubo respuesta" (fetch rechazado por red).
- `status: >=400` para respuestas HTTP no-ok. Mensaje en español, neutro
  (no de marca): p.ej. `El servidor respondió con un error (HTTP 500)` y
  `No se pudo conectar con el servidor`. Estos textos son de infraestructura,
  no de marca (un error de red no depende de shopinbaz vs elektra); se admiten
  como literales neutros mínimos. La UI final que muestre estos errores al
  usuario usará textos de marca por encima si la feature lo requiere.

**`apiFetch`** — envoltura sobre `fetch` que resuelve base URL y normaliza
errores:

```ts
interface ApiFetchDeps {
  fetchFn?: typeof fetch; // default: fetch global — inyectable en tests
  apiUrl?: string;        // default: env.apiUrl
}

// Devuelve el JSON parseado y tipado por el llamador (T).
export async function apiFetch<T>(
  path: string,               // relativo, empieza por '/', p.ej. '/crypto/public-key'
  init?: RequestInit,
  deps?: ApiFetchDeps,
): Promise<T>;
```

Comportamiento:
1. `url = \`${apiUrl}${path}\`` (con `apiUrl` sin trailing slash desde `env`,
   `path` con leading slash → una sola barra).
2. `try { res = await fetchFn(url, init) } catch (cause) { throw new ApiError('No se pudo conectar con el servidor', 0, { cause }) }`
   — captura el rechazo de red y lo convierte en `ApiError(status 0)`.
3. `if (!res.ok) throw new ApiError(\`El servidor respondió con un error (HTTP ${res.status})\`, res.status)`.
4. `return (await res.json()) as T`.
5. `init` mezcla headers por defecto `{ Accept: 'application/json' }` con los que
   pase el llamador (el llamador puede sobreescribir para POST con
   `Content-Type`). El merge lo hace `apiFetch` para no repetirlo en cada call.

**Encaje con `fetchPublicKey` existente (recomendación):**

- NO reescribir `fetchPublicKey` en esta feature. Su firma pública
  (`fetchPublicKey(deps?: { fetchFn?, apiUrl? }): Promise<string>`) tiene tests
  y no debe romperse.
- La forma más limpia SIN romper su test: refactor interno para que
  `fetchPublicKey` delegue en `apiFetch<PublicKeyResponse>('/crypto/public-key',
  ..., { fetchFn, apiUrl })` y devuelva `body.publicKey`. Sus deps
  (`fetchFn`/`apiUrl`) se pasan tal cual a `apiFetch`; el default de `apiUrl`
  pasa a venir de `env.apiUrl` (hoy `DEFAULT_API_URL` local, misma semántica
  `?? ''`). Los tests de `fetchPublicKey` (que inyectan `fetchFn` mockeado)
  siguen pasando porque la firma y el contrato de retorno no cambian.
- **Decisión de alcance:** ese refactor de `fetchPublicKey` es DESEABLE (elimina
  el acceso disperso a `import.meta.env` y el `DEFAULT_API_URL` local), pero es
  un cambio sobre código con tests. Recomiendo incluirlo en esta feature porque
  es justo su objetivo ("centralizar el acceso al backend"), verificando que la
  suite de `fetchPublicKey` sigue verde. Si el error de mensaje HTTP de
  `apiFetch` difiere del que hoy lanza `fetchPublicKey`
  (`No se pudo obtener la clave pública (HTTP N)`), y algún test lo aserta
  textualmente, el implementer conserva ese mensaje específico envolviendo el
  `ApiError` o pasando un mensaje custom — no cambia el texto que ya se testea.

**`resolveBrand.ts` y `import.meta.env`:**

- `resolveBrand` es función PURA: recibe `defaultBrand`/`isDev` inyectados, NO
  lee `import.meta.env`. Quien los lee es su llamador (main.tsx). Por tanto el
  cambio es: el llamador pasa `env.defaultBrand` y `import.meta.env.DEV` en
  lugar de leer `import.meta.env.VITE_DEFAULT_BRAND` inline. `resolveBrand` NO
  se toca (su firma y test quedan intactos). El `import.meta.env.VITE_DEFAULT_BRAND`
  mencionado en su JSDoc es documentación del origen del dato; sigue siendo
  correcto porque `env.defaultBrand` deriva de esa var.

### 3. `ErrorBoundary`

Componente **class** de React (los boundaries requieren clase; React 19 no tiene
equivalente en hooks). En `src/components/ErrorBoundary.tsx` (o
`src/ui/ErrorBoundary.tsx` — el implementer elige según convención existente; no
hay carpeta `components/` aún, `src/ui/` tampoco → propongo
`src/components/ErrorBoundary.tsx`).

```ts
interface ErrorBoundaryProps {
  children: React.ReactNode;
  // Fallback opcional: nodo o render-prop. Si se omite, usa el fallback neutro.
  fallback?: React.ReactNode | ((error: Error) => React.ReactNode);
}
interface ErrorBoundaryState {
  error: Error | null;
}
```

- Implementa `static getDerivedStateFromError(error): ErrorBoundaryState` y
  `componentDidCatch(error, info)` (este último para loguear, `console.error`,
  sin filtrar a UI).
- Captura errores de **render** de sus hijos: fallos de render de componentes,
  y por extensión los que burbujeen durante el render (p.ej. un throw síncrono).
  NO captura errores async fuera del ciclo de render (fetch rechazado en un
  handler/efecto) — esos los maneja la capa `api` (`ApiError`) y el estado del
  componente. Esto se documenta para no vender más de lo que un boundary hace.
- **Fallback por defecto:** texto NEUTRO mínimo, NO de marca. Justificación: el
  boundary raíz puede dispararse ANTES de que la `BrandConfig` esté resuelta o
  JUSTO porque el theming falló; no puede depender de tokens/textos de marca sin
  arriesgar un segundo fallo. Usa un texto genérico en español y estilos
  mínimos con tokens de tema si están disponibles (`bg-brand-bg text-brand-text`)
  o estilos inline neutros de fallback. Propuesta de copy neutro:
  título "Algo salió mal", cuerpo "Vuelve a intentarlo recargando la página",
  y un botón "Recargar" (`window.location.reload()`). Estos NO son textos de
  marca (son de última línea de defensa); se admiten como literales neutros.
  El fallback de marca, si se quisiera, se pasa por la prop `fallback` desde un
  nivel donde la marca YA esté resuelta — pero eso es de welcome_screen, no de
  esta feature.

**Integración en `main.tsx`:**

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
```

`main.tsx` está excluido de coverage (`vite.config.ts`), así que la integración
no se testea por cobertura; el `ErrorBoundary` se testea aislado (ver abajo).

## Tokens y textos de marca (si hay UI)

- El único componente con UI es `ErrorBoundary`, y **por diseño su fallback es
  neutro** (última línea de defensa, puede dispararse sin marca resuelta). No
  introduce textos ni colores de marca. Si en su fallback usa clases Tailwind,
  serán tokens de tema (`bg-brand-bg`, `text-brand-text`, `text-brand-muted`) —
  NUNCA hex literales — con la salvedad de que, si el propio theming es la causa
  del fallo, las CSS variables podrían no estar inyectadas; por eso el fallback
  debe ser legible incluso sin marca (contraste garantizado por estilos inline
  neutros de respaldo). El implementer decide el mínimo; el criterio es: nunca
  hex literal en className, y legibilidad sin depender de que la marca cargó.

## Alternativas consideradas

### A. Validación de env: fail-fast al import (como el back) vs. lazy-resiliente
- **Fail-fast**: `env.ts` lanza al importarse si falta una var. Coherente
  con el back, detecta config rota en build/dev. Contra: rompe la app en blanco
  ante una env ausente, contradice la filosofía de `brand_config` y el
  acceptance ("no dejar la app en blanco"). En el front, `VITE_API_URL` vacía es
  legítima (dev).
- **Lazy-resiliente (RECOMENDADA)**: `safeParse` con defaults, `env` siempre
  poblado, nunca lanza; `validateEnv` puro y testeable exista para cubrir el
  acceptance "acceso validado" y para el futuro (vars requeridas → warn, no
  throw). Alinea con la resiliencia del proyecto.

### B. Capa API: clase `ApiClient` con estado vs. funciones puras con deps
- **Clase `ApiClient(apiUrl, fetchFn)`**: encapsula base URL, útil si hubiera
  auth/headers compartidos con estado. Contra: introduce un patrón nuevo
  (instancia) que el repo no usa; el resto son funciones con deps inyectables.
- **Funciones + deps (RECOMENDADA)**: `apiFetch<T>(path, init, { fetchFn, apiUrl })`
  con defaults desde `env`. Igual de testeable (fetch mockeado), coherente con
  `fetchPublicKey`/`loadBrand`, sin estado. Menos superficie.

### C. `fetchPublicKey`: reescribir sobre `apiFetch` vs. dejarlo intacto
- **Dejarlo intacto**: cero riesgo sobre su test. Contra: persiste el acceso
  disperso a `import.meta.env` y el `DEFAULT_API_URL` local que la feature
  quiere eliminar.
- **Reescribir delegando en `apiFetch` (RECOMENDADA)**: cumple el objetivo de
  centralizar, manteniendo firma y contrato de retorno → su test sigue verde.
  Riesgo acotado: solo el texto del error HTTP; se conserva el mensaje que su
  test asere.

## Recomendación

1. `src/config/env.ts`: schema Zod con `VITE_API_URL` (default `''`, sin
   trailing slash) y `VITE_DEFAULT_BRAND` (optional). `validateEnv(source?)`
   puro que NUNCA lanza; `env` derivado del entorno vía `safeParse`. Lazy-
   resiliente, no fail-fast.
2. `src/api/{apiError,client,index}.ts`: `ApiError` (con `status`, `0`=red) y
   `apiFetch<T>(path, init?, { fetchFn?, apiUrl? })` con base URL desde
   `env.apiUrl`. `fetchPublicKey` se refactoriza para delegar en `apiFetch`
   conservando su firma, retorno y el texto de error que su test asere.
3. `src/components/ErrorBoundary.tsx`: class component, prop `fallback` opcional,
   fallback por defecto NEUTRO (no de marca), montado en `main.tsx` envolviendo
   `<App />`.

## Archivos nuevos / modificados

**Nuevos:**
- `src/config/env.ts`
- `src/api/apiError.ts`
- `src/api/client.ts`
- `src/api/index.ts`
- `src/components/ErrorBoundary.tsx`
- Tests (los escribe el tester): `src/config/env.test.ts`,
  `src/api/client.test.ts` (+ opcional `src/api/apiError.test.ts`),
  `src/components/ErrorBoundary.test.tsx`.

**Modificados:**
- `src/main.tsx` — envolver `<App />` con `<ErrorBoundary>`.
- `src/crypto/fetchPublicKey.ts` — delegar en `apiFetch`, quitar
  `DEFAULT_API_URL` local (usa `env.apiUrl`). Firma/retorno/texto de error
  intactos → su test se mantiene verde.
- `src/main.tsx` (llamador de `resolveBrand`) — pasar `env.defaultBrand` en vez
  de `import.meta.env.VITE_DEFAULT_BRAND` inline (si ese cableado ya vive en
  main.tsx). `resolveBrand.ts` NO se toca.

## Orden RED -> GREEN sugerido

**Tester (RED) — tests que fallan por ausencia de módulo/comportamiento:**
1. `src/config/env.test.ts`: tabla sobre `validateEnv(source)` — apiUrl ausente
   → `''`; apiUrl con trailing slash → recortado; defaultBrand ausente →
   `undefined`; success siempre `true` (nunca falla con estas vars). Un caso con
   `vi.stubEnv` que verifica que `env` se hidrata del entorno y que `env` existe
   sin lanzar aunque el entorno esté vacío.
2. `src/api/client.test.ts`: con `fetchFn` mockeado —
   (a) respuesta ok → devuelve JSON tipado; (b) `!res.ok` → lanza `ApiError` con
   `status` correcto; (c) `fetchFn` rechaza (red) → lanza `ApiError` con
   `status === 0`; (d) construye la URL como `apiUrl + path` sin doble barra;
   (e) mezcla el header `Accept` por defecto.
3. `src/api/apiError.test.ts` (opcional): `ApiError` es `instanceof Error`,
   expone `status`, preserva `cause`.
4. `src/components/ErrorBoundary.test.tsx`: un hijo que lanza en render →
   se muestra el fallback neutro (por texto/rol), NO el crash; un hijo sano →
   se renderiza normal; con prop `fallback` → se usa ese fallback.

**Implementer (GREEN) — mínimo para pasar, en orden de dependencias:**
1. `src/config/env.ts` (sin deps).
2. `src/api/apiError.ts` → `src/api/client.ts` → `src/api/index.ts` (usa `env`).
3. Refactor `src/crypto/fetchPublicKey.ts` sobre `apiFetch` — correr su suite
   existente, debe seguir verde.
4. `src/components/ErrorBoundary.tsx`.
5. `src/main.tsx`: montar `ErrorBoundary` + pasar `env.defaultBrand` a
   `resolveBrand`.

Tras GREEN: `pnpm --filter @nach/frontend lint typecheck test` en verde y
verificar que `pnpm --filter @nach/frontend dev`/`build` no rompe por el
refactor de `fetchPublicKey` (el import de `env` carga en runtime).

## Criterios de aceptación traducibles a tests

1. `validateEnv(source)` es pura, recibe `source` inyectable y NUNCA lanza con
   las vars actuales; devuelve `{ success: true, data }` siempre.
2. `env.apiUrl` es string sin trailing slash; `''` es un valor válido (dev).
3. `env.defaultBrand` es `undefined` cuando la var está ausente o vacía.
4. `apiFetch<T>` con respuesta ok devuelve el JSON parseado tipado como `T`.
5. `apiFetch` ante `!res.ok` lanza `ApiError` cuyo `status` es el HTTP status.
6. `apiFetch` ante rechazo de red (fetchFn throw) lanza `ApiError` con
   `status === 0`, preservando `cause`.
7. `apiFetch` construye la URL como `apiUrl + path` con una sola barra y añade
   `Accept: application/json` por defecto sin pisar headers del llamador.
8. `fetchPublicKey` sigue devolviendo `body.publicKey` y su suite existente pasa
   sin cambios (firma, retorno y texto de error preservados).
9. `ErrorBoundary` con un hijo que lanza en render muestra el fallback (neutro
   por defecto; el pasado por prop si se provee) y no propaga el crash.
10. `ErrorBoundary` con hijos sanos los renderiza sin interferir.
11. El fallback por defecto no contiene hex literales ni textos de marca; su
    copy es neutro y en español.

## Riesgos / decisiones abiertas (para OK humano)

1. **Alcance del refactor de `fetchPublicKey`.** Recomiendo incluirlo (es el
   objetivo de la feature: centralizar el acceso al backend), conservando su
   test verde. Si el leader prefiere alcance mínimo (no tocar código con tests
   en esta feature), `fetchPublicKey` puede quedarse leyendo `import.meta.env` y
   solo se crea `env`/`api` para consumo nuevo — pero entonces persiste el
   acceso disperso que la feature dice unificar. **Decisión sugerida: incluir el
   refactor.**
2. **Ubicación de `ErrorBoundary`.** No existe `src/components/` ni `src/ui/`.
   Propongo `src/components/ErrorBoundary.tsx`. Si hay convención distinta
   preferida, indicarlo.
3. **`isDev` en `env.ts`.** Reexportar `isDev = import.meta.env.DEV` desde
   `env.ts` centralizaría también el flag dev/prod (hoy leído inline por el
   llamador de `resolveBrand`). Es coherente pero NO está en el acceptance;
   lo dejo como opcional. Sugerencia: incluirlo por consistencia (misma "fuente
   única"), sin coste de test relevante.
4. **Texto neutro del fallback del `ErrorBoundary`.** Al ser última línea de
   defensa, uso literales neutros en español ("Algo salió mal", "Recargar").
   Esto es una excepción consciente a "cero textos hardcoded", justificada
   porque el boundary puede dispararse sin marca resuelta. Si se quiere que
   también salga de config, hay que resolver marca ANTES del boundary raíz, lo
   que reintroduce el riesgo de pantalla en blanco. **Decisión sugerida:
   fallback neutro hardcodeado, aceptado como infraestructura.**
