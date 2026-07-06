# Design — records_list

## Objetivo

Pantalla EXTRA (fuera del enunciado) que **lista los registros generados** (nombre + número
consecutivo) leídos de Mongo, como **evidencia visible de que el contador persiste**: el evaluador
mete "Juan"→42, recarga y comprueba que sigue 42/Juan. No es un sistema de usuarios (no hay login).
Accesible solo por URL directa `/records` (no listada en la UI, ADR 27). Cero literales/hex: todo
texto y color por config de marca. Solo LEE lo que `consecutive_counter` ya persiste — no se toca el
modelo ni la escritura.

Decisiones cerradas con el usuario, ya escritas como **ADR 26** (nombre completo sin enmascarar) y
**ADR 27** (React Router + ruta `/records` no listada) en `docs/decisiones.md`. No se re-litigan aquí.

## Contrato / arquitectura

### Backend — `GET /records`

**Respuesta 200 (JSON):** un array plano de registros, ordenado por `sequence` **descendente**
(el más reciente primero), con límite duro.

```jsonc
[
  { "sequence": 42, "name": "Juan",  "createdAt": "2026-07-05T10:12:00.000Z" },
  { "sequence": 41, "name": "Ana",   "createdAt": "2026-07-05T10:08:00.000Z" }
]
```

- **Campos:** `sequence` (number), `name` (string, completo — ADR 26), `createdAt` (string ISO,
  de los `timestamps` del modelo). Se INCLUYE `createdAt` porque es dato ya persistido, gratis, y
  refuerza la evidencia de persistencia ("cuándo se generó"); el front decide si lo muestra. NO se
  exponen `_id`, `__v` ni `updatedAt` (ruido; `.lean()` + proyección los deja fuera o se descartan
  en el mapeo del service).
- **Orden:** `sort({ sequence: -1 })` — el registro más nuevo arriba, que es lo que el evaluador
  acaba de crear.
- **Límite:** `.limit(N)` con **N = 100** (constante nombrada `MAX_RECORDS` en el service). Cota
  sensata: evita traer una colección entera si crece; 100 sobra para una demo. `.lean()` para
  devolver objetos planos (sin hidratar documentos Mongoose, más rápido y directo de mapear).
- **Errores:** fallo de Mongo → el service hace `throw`; el controller responde
  `500 { error: 'internal_error' }` (mismo contrato `{ error }` que el resto de la API, sin stack,
  sin detalle interno). No hay 400: el endpoint no recibe payload ni params.
- **Rate-limit: NO.** Justificación: `/records` es **lectura barata e idempotente**, sin coste de
  proveedor externo ni escritura. En `app.ts` el limiter se aplica solo a endpoints de
  escritura/coste (`/names` = persiste, `/voice` = paga a Groq); `/health` y `/crypto` (GET público
  de la clave) van sin limiter. `/records` sigue ese patrón: se monta **sin `makeLimiter()`**,
  coherente con la política existente. (Si en deploy se quisiera proteger, iría por CloudFront/WAF,
  no por rate-limit de app.)

**Capas (patrón `routes → controllers → services`, ADR 7):**

- `record.service.ts` — nuevo. Firma:
  ```ts
  export interface RecordListItem { sequence: number; name: string; createdAt: string; }
  export async function listRecords(): Promise<RecordListItem[]>;
  ```
  Implementación: `Record.find({}, { sequence: 1, name: 1, createdAt: 1, _id: 0 })
  .sort({ sequence: -1 }).limit(MAX_RECORDS).lean()`, mapeando `createdAt` a ISO string. Usa el
  modelo `Record` YA existente (`record.model.ts`) por **default import de mongoose** (patrón ESM
  del repo) — no se crea modelo nuevo.
- `records.controller.ts` — nuevo. `getRecords(req, res)`: `try { res.status(200).json(await
  listRecords()) } catch { res.status(500).json({ error: 'internal_error' }) }`. Mismo estilo que
  `health.controller`/`voice.controller`.
- `records.routes.ts` — nuevo. `export const recordsRouter = Router(); recordsRouter.get('/',
  getRecords);` (patrón idéntico a `health.routes.ts`).
- **Montaje en `app.ts`:** añadir `import { recordsRouter } from './routes/records.routes.js';` y
  `app.use('/records', recordsRouter);` junto a los otros routers de LECTURA (tras `/health` y
  `/crypto`, **antes** del bloque con limiter de `/names` y `/voice`). Sin `makeLimiter()`.

> **Nota de runtime (patrón ESM default-import, MEMORY):** el nuevo `record.service.ts` importa el
> modelo real de Mongo, pero los tests de endpoint **mockean el service** y no cargan el modelo. Un
> `import` roto en ESM (named export inexistente, etc.) pasaría lint + typecheck + vitest y solo
> reventaría en `pnpm dev`. El implementer debe **confirmar la carga en runtime** (`pnpm --filter
> @nach/backend smoke`) antes de dar el GREEN, no basta con los tests verdes.

### Frontend — pantalla `/records`

**Capa API (`src/api/`):** nueva función `fetchRecords()` que reusa `apiFetch<T>` (ya centraliza
base URL, `Accept`, y forma de error `ApiError`). Cero fetch a mano.
```ts
// src/api/fetchRecords.ts
export interface RecordItem { sequence: number; name: string; createdAt: string; }
export function fetchRecords(deps?): Promise<RecordItem[]>  // usa apiFetch<RecordItem[]>('/records', ...)
```
Se re-exporta en `src/api/index.ts` (junto a `apiFetch`, `transcribeVoice`).

**Hook de carga (`useRecords`)** con máquina de estados explícita
`idle | loading | error | empty | success`:
```ts
type RecordsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }               // fetch OK, array vacío
  | { status: 'success'; records: RecordItem[] };
```
Carga al montar (`useEffect`), sin params. `empty` es un estado propio (no un `success` con array
vacío) para que el render sea trivial y testeable. Errores de red/500 → `error`.

**Router (ADR 27):** se instala `react-router-dom`. `<BrowserRouter>` envuelve `<App />` en
`main.tsx` (dentro de `ThemeProvider`, para que ambas rutas tengan marca). `App.tsx` pasa de
renderizar directamente `<WelcomeScreen />` a declarar las rutas:
```tsx
// App.tsx
<Routes>
  <Route path="/" element={<WelcomeScreen />} />
  <Route path="/records" element={<RecordsList />} />
</Routes>
```
Sin `<Link>` a `/records` en ninguna parte (no listada). WelcomeScreen queda intacto.

## Tokens y textos de marca (si hay UI)

**No hay maqueta de listado** (`docs/images/` solo trae la bienvenida shopinbaz/elektra). El layout
se diseña **coherente con `WelcomeScreen`**: mismo `<main>` con `bg-brand-bg`, `text-brand-text`,
logo de marca arriba, contenedor centrado `max-w-sm`.

**Layout de `RecordsList`:**
- `<main>` con las mismas clases base que WelcomeScreen (`bg-brand-bg text-brand-text`, ancho
  `max-w-sm`, padding), logo de marca (`assets.logo` con el mismo fallback a `DEFAULT_BRAND`).
- Título de pantalla (`text.records.title`) en `text-brand-primary`.
- **Tabla/lista de registros** con dos columnas visibles: **nombre** y **número**. Cabeceras desde
  marca (`text.records.nameHeader`, `text.records.numberHeader`), en `text-brand-muted`. Cada fila:
  nombre en `text-brand-text`, número en `text-brand-primary font-bold`. Filas separadas con borde
  sutil vía token (`border-brand-surface` o similar; usar un token de marca, nunca hex). Semántica
  accesible: `<table>` con `<th scope="col">` o lista con roles ARIA — decide el implementer, pero
  las cabeceras y celdas deben ser navegables por lector de pantalla.
- **Estado loading:** texto `text.records.loading` (reusa el patrón de `text.loadingLabel` de
  welcome, pero campo propio en el bloque `records`), centrado, `text-brand-muted`, con `aria-live`.
- **Estado error:** `role="alert"`, texto `text.records.error`, `text-brand-accent`.
- **Estado empty:** texto `text.records.empty` centrado, `text-brand-muted` (aún no hay registros).

**Bloque nuevo en el schema Zod** (`src/brand/core/schema.ts`), dentro de `text`, como sub-objeto
`records` con `.prefault({})` y cada campo con `.default()` — regla white-label: marca nueva = un
JSON, cero literales en componentes. Propuesta de campos y defaults (marca neutra):

```ts
records: z
  .object({
    title:        z.string().default('Registros generados'),
    nameHeader:   z.string().default('Nombre'),
    numberHeader: z.string().default('Número'),
    loading:      z.string().default('Cargando registros…'),
    error:        z.string().default('No pudimos cargar los registros. Inténtalo de nuevo.'),
    empty:        z.string().default('Aún no hay registros generados.'),
  })
  .prefault({}),
```

> Nota: se anida bajo `text.records` (no un bloque top-level nuevo) para que el consumo siga siendo
> `const { text } = useBrand(); text.records.title`, coherente con `text.title`, `text.resultLabel`,
> etc. Ninguna marca existente (shopinbaz/elektra seeds) necesita editar su JSON: los defaults
> aplican por campo.

**Tokens de marca a usar (cero hex):** `bg-brand-bg`, `text-brand-text`, `text-brand-primary`,
`text-brand-muted`, `text-brand-accent`, `border-brand-surface` (o `bg-brand-surface` para separar
filas), `rounded-[var(--brand-radius)]`. Exactamente el set que ya usa WelcomeScreen; ninguno nuevo.

## Alternativas consideradas

Feature de complejidad **media** (pantalla nueva + endpoint nuevo + router nuevo). Las dos
decisiones estructurales (nombre sin enmascarar, router con ruta no listada) están razonadas en los
ADR 26 y 27. Alternativas puntuales de diseño resueltas aquí:

1. **`createdAt` en la respuesta: incluir vs omitir.** → **Incluir.** Es dato ya persistido
   (`timestamps`), gratis de proyectar, refuerza la evidencia de persistencia; el front decide si lo
   pinta. Omitirlo no ahorra nada y quita contexto. Descartado omitir.
2. **`empty` como estado propio vs `success` con `[]`.** → **Estado propio.** Hace el render y los
   tests triviales (cada estado un branch claro), sin condicionales `records.length === 0` dispersos
   en el JSX. Descartado el array vacío como success.
3. **Rate-limit en `/records`: sí vs no.** → **No** (ver contrato). Lectura barata idempotente sin
   coste externo; el patrón del repo reserva el limiter para escritura/coste. Descartado añadirlo.
4. **`<table>` semántica vs lista de `<div>`.** → Recomendado `<table>` con `<thead>`/`<th
   scope>` por accesibilidad (relación cabecera-celda nativa para lectores de pantalla) y porque son
   datos tabulares reales. El implementer puede usar lista con roles ARIA equivalentes; los tests
   deben afirmar sobre texto de cabecera + presencia de nombre y número, no sobre el tag exacto.

## Recomendación

Implementar tal cual el contrato de arriba: `GET /records` sin rate-limit, respuesta
`[{sequence,name,createdAt}]` orden `sequence` desc, `.limit(100).lean()`, 500 en fallo. Front con
`fetchRecords` sobre `apiFetch`, hook `useRecords` de 4 estados, `RecordsList` white-label coherente
con WelcomeScreen, router en `main.tsx`/`App.tsx` con `/records` **no listada**. Bloque de textos
`text.records` en el schema. Cero hex/literales. El implementer confirma la carga runtime del service
por smoke antes del GREEN.

## Criterios de aceptación traducibles a tests

**Backend (Supertest sobre `app.ts`, service mockeado):**
1. `GET /records` con `listRecords` mockeado devolviendo 2 registros → **200** y body = array con
   `sequence`, `name`, `createdAt` de esos registros, **en el orden que devuelve el service** (desc).
2. `GET /records` con `listRecords` mockeado devolviendo `[]` → **200** y body `[]`.
3. `GET /records` con `listRecords` que hace `throw` → **500** y body `{ error: 'internal_error' }`,
   sin stack ni detalle.
4. La respuesta **no incluye** `_id`, `__v` ni `updatedAt` (solo `sequence`, `name`, `createdAt`).
5. (Service, con `Record` mockeado) `listRecords()` llama a `find` con `sort({ sequence: -1 })`,
   `.limit(100)` y `.lean()`, y mapea a `{ sequence, name, createdAt }`.
6. `/records` responde **sin** cabeceras/comportamiento de rate-limit (no es limitado): N peticiones
   > `rateLimitMax` siguen dando 200 (a diferencia de `/names`).

**Frontend (Testing Library, `fetch`/`apiFetch` mockeado):**
7. `fetchRecords()` pega a `/records` vía `apiFetch` y resuelve el array tipado; error de red →
   `ApiError` (status 0); HTTP 500 → `ApiError` con status 500.
8. `RecordsList` en estado **loading** muestra `text.records.loading` en región `aria-live`.
9. Con registros → renderiza cabeceras `text.records.nameHeader` / `text.records.numberHeader` y una
   fila por registro con su **nombre completo** (sin enmascarar) y su número.
10. Array vacío → estado **empty**: muestra `text.records.empty`, sin filas.
11. Fetch fallido → estado **error**: `role="alert"` con `text.records.error`.
12. **Multi-marca:** el mismo `RecordsList` renderizado bajo shopinbaz y bajo elektra muestra los
    textos de cada marca (cero literales); grep del componente no encuentra hex ni strings visibles
    hardcodeados.
13. **Router:** navegar a `/records` renderiza `RecordsList`; `/` renderiza `WelcomeScreen`; no
    existe ningún `<Link>`/`<a>` hacia `/records` en el árbol de WelcomeScreen (ruta no listada).

## Mapa de archivos (TDD: quién crea qué)

**Tester (RED) — crea los tests que fallan:**
- `backend/src/routes/records.routes.test.ts` — endpoint (criterios 1-4, 6), service mockeado.
- `backend/src/services/record.service.test.ts` — `listRecords` (criterio 5), `Record` mockeado.
- `frontend/src/api/fetchRecords.test.ts` — capa API (criterio 7).
- `frontend/src/features/records/RecordsList/RecordsList.test.tsx` — render y estados (8-12).
- `frontend/src/features/records/useRecords.test.ts` — hook de estados (idle/loading/error/empty/success).
- `frontend/src/App.test.tsx` (o test de routing) — rutas y ausencia de link (criterio 13).
- `frontend/src/brand/core/schema.test.ts` — **ampliar** con defaults de `text.records`.

**Implementer (GREEN) — crea el mínimo código de producción:**
- `backend/src/services/record.service.ts` — `listRecords()` + `RecordListItem` + `MAX_RECORDS`.
- `backend/src/controllers/records.controller.ts` — `getRecords`.
- `backend/src/routes/records.routes.ts` — `recordsRouter`.
- `backend/src/app.ts` — **editar**: montar `app.use('/records', recordsRouter)` (sin limiter).
- `frontend/src/api/fetchRecords.ts` + re-export en `frontend/src/api/index.ts` (**editar**).
- `frontend/src/features/records/RecordsList/RecordsList.tsx` + `index.ts` (barrel).
- `frontend/src/features/records/RecordsList/index.ts` — barrel `export { RecordsList }`.
- `frontend/src/features/records/useRecords.ts` — hook.
- `frontend/src/brand/core/schema.ts` — **editar**: añadir sub-bloque `text.records`.
- `frontend/src/App.tsx` — **editar**: `<Routes>` con `/` y `/records`.
- `frontend/src/main.tsx` — **editar**: envolver en `<BrowserRouter>` (dentro de `ThemeProvider`).
- `frontend/package.json` — **editar**: añadir `react-router-dom` (dep nueva, ADR 27).

Confirmación de runtime del service (smoke) por parte del implementer antes del GREEN de backend.
