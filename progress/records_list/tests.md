# Tests RED — records_list

Fase **RED** del TDD para la feature `records_list` (fullstack: endpoint `GET /records`,
pantalla `/records`, router, bloque de textos de marca `text.records`). Todos los tests
FALLAN ahora por **ausencia de código de producción / dependencia**, no por errores del
propio test. El implementer los pone en verde en GREEN sin modificarlos.

Fuente de verdad: `progress/records_list/design.md` (contrato + "Criterios de aceptación
traducibles a tests" 1-13) y ADR 26 (nombre completo sin enmascarar) / ADR 27 (React
Router, `/records` no listada).

## Archivos de test creados / ampliados

| Archivo | Tipo | Cubre |
|---|---|---|
| `backend/src/services/record.service.test.ts` | nuevo | Criterio 5 (service `listRecords`) |
| `backend/src/routes/records.routes.test.ts` | nuevo | Criterios 1-4, 6 (endpoint `GET /records`) |
| `frontend/src/api/fetchRecords.test.ts` | nuevo | Criterio 7 (capa API) |
| `frontend/src/features/records/useRecords.test.ts` | nuevo | Máquina de estados del hook (loading/error/empty/success) |
| `frontend/src/features/records/RecordsList/RecordsList.test.tsx` | nuevo | Criterios 8-12 (render de estados + multi-marca + cero literales) |
| `frontend/src/App.routing.test.tsx` | nuevo | Criterio 13 (ruteo `/` vs `/records`, ruta no listada) |
| `frontend/src/App.test.tsx` | ampliado | Envuelto en `<MemoryRouter>` para sobrevivir al giro a `<Routes>` |
| `frontend/src/brand/core/schema.test.ts` | ampliado | Sub-bloque `text.records` (defaults por campo + parcial + JSON sin `records`) |

## Mapeo test → criterio de aceptación (del design)

### Backend

**`record.service.test.ts`** (modelo `Record` mockeado por default-import ESM; el mock
devuelve un builder encadenable `find().sort().limit().lean()` para espiar cada eslabón):

- **#5** `listRecords()` consulta `Record.find` con proyección **sin `_id`** (y sin
  `__v`/`updatedAt`), `.sort({ sequence: -1 })`, `.limit(100)` (= `MAX_RECORDS`) y `.lean()`.
- **#5** mapea cada doc a `{ sequence, name, createdAt }` con `createdAt` como **string ISO**.
- **#5** respeta el orden que devuelve Mongo (no reordena en el mapeo).
- Camino borde: colección vacía → `[]`.
- Error: fallo de Mongo → **propaga (throw)** para que el controller responda 500.

**`records.routes.test.ts`** (Supertest sobre `createApp()`, service `record.service`
mockeado; mismo patrón que `names.routes.test.ts`/`voice.routes.test.ts`):

- **#1** service devuelve 2 registros → **200** con el array en el orden del service (desc).
- **#2** service devuelve `[]` → **200** con body `[]`.
- **#3** service lanza → **500** `{ error: 'internal_error' }`, sin filtrar detalle interno
  (ni "mongo", ni el puerto 27017, ni stack).
- **#4** la respuesta contiene **solo** `sequence`, `name`, `createdAt` (sin `_id`, `__v`,
  `updatedAt`).
- **#6** `/records` **NO** está rate-limitado: con `RATE_LIMIT_MAX=2`, 5 peticiones seguidas
  dan `[200,200,200,200,200]` (ninguna 429), a diferencia de `/names`.

### Frontend

**`fetchRecords.test.ts`** (`fetchFn` mockeado; patrón de `transcribeVoice.test.ts`):

- **#7** `fetchRecords()` hace `GET` a `/records` vía `apiFetch` bajo la base inyectada y
  resuelve el array tipado; `[]` cuando el backend devuelve vacío.
- **#7** HTTP 500 → `ApiError` con `status 500`; rechazo de red → `ApiError` con `status 0`.

**`useRecords.test.ts`** (`fetchRecords` mockeado; `renderHook` + `waitFor`):

- Estado inicial **loading** al montar (dispara la carga una vez, sin params).
- Registros → **success** exponiendo `records`.
- Array vacío → **empty** (estado propio, **no** success con `[]`, decisión #2 del design).
- Fetch rechazado → **error**.

**`RecordsList.test.tsx`** (`useRecords` mockeado para conducir estados; envuelto en
`<ThemeProvider>`, patrón de `WelcomeScreen`/`ResultView`):

- **#8** loading → `text.records.loading` dentro de una región `aria-live`.
- **#9** success → cabeceras de marca `nameHeader`/`numberHeader` + una fila por registro con
  el **nombre completo sin enmascarar** (`Juan`, `Ana`, ADR 26) y su número (`42`, `41`);
  además el título `text.records.title`.
- **#10** empty → `text.records.empty`, sin filas de datos.
- **#11** error → `role="alert"` con `text.records.error`.
- **#12** multi-marca: el MISMO componente bajo shopinbaz y elektra muestra los textos de
  cada marca; y el **fuente del componente no contiene hex** (`/#[0-9a-fA-F]{3,8}/`) **ni los
  copys visibles hardcodeados** (aserción sobre el archivo `.tsx`).
- El test de "datos tabulares" afirma sobre **texto de cabecera + presencia de nombre y
  número**, NO sobre el tag exacto (`<table>` vs lista ARIA — lo decide el implementer,
  decisión #4 del design).

**`App.routing.test.tsx`** (pantallas mockeadas con marcadores; `<MemoryRouter>` conduce la
ruta):

- **#13** `/` → renderiza `WelcomeScreen` (no `RecordsList`); `/records` → renderiza
  `RecordsList` (no `WelcomeScreen`); **ningún** `<a href>` del árbol de `WelcomeScreen`
  apunta a `/records` (ruta no listada). El mock de WelcomeScreen incluye a propósito un
  `<a href="/">` legítimo para que la aserción "no hay link a /records" no sea un falso
  positivo por ausencia total de anclas.

**`schema.test.ts`** (ampliado): sub-bloque `text.records` con `.prefault({})` y `.default()`
por campo (6 campos: `title`, `nameHeader`, `numberHeader`, `loading`, `error`, `empty`):

- `parseBrandConfig({})` produce los 6 campos completos y no vacíos → marca usable sin
  declararlos.
- Conserva un parcial (`text.records.title`) y rellena el resto con los defaults del schema.
- Un JSON que **omite por completo** `records` sigue válido y aplica el default completo
  (principio "marca nueva = un JSON"; ninguna seed existente edita su JSON).

## Evidencia de RED (fallo por ausencia de código, no por typo)

Ejecutado con `pnpm --filter @nach/backend test` y `pnpm --filter @nach/frontend test`.

### Backend

```
Test Files  2 failed | 10 passed (12)
      Tests  10 failed | 53 passed (63)
```

- `record.service.test.ts` → `Cannot find module '.../src/services/record.service.js'`
  (el service de producción aún no existe). **RED legítimo.**
- `records.routes.test.ts` → `expected 404 to be 200` / `expected 404 to be 500` /
  `expected [404,404,404,404,404] to deeply equal [200,...]`: Express devuelve **404** porque
  `app.ts` aún no monta `app.use('/records', ...)`. **RED legítimo.**

### Frontend

```
Test Files  6 failed
```

- `api/fetchRecords.test.ts` → `Failed to resolve import "./fetchRecords"` (módulo ausente).
- `features/records/useRecords.test.ts` → `Failed to resolve import "./useRecords"`.
- `features/records/RecordsList/RecordsList.test.tsx` → `Failed to resolve import "./RecordsList"`.
- `App.routing.test.tsx` y `App.test.tsx` → `Failed to resolve import "react-router-dom"`
  (dependencia aún no instalada — prerequisito de GREEN, ADR 27).
- `brand/core/schema.test.ts` → `expected undefined to be defined` /
  `Cannot read properties of undefined (reading 'title')`: `config.text.records` no existe
  hasta que el implementer añada el sub-bloque al schema.

Todos los fallos son por **código/dependencia ausente**; ningún fallo proviene de un error de
sintaxis o de setup del test. El resto de la suite (welcome, crypto, voice, marca) sigue en
verde: los tests nuevos no rompen nada existente.

## Prerequisitos que el implementer debe cumplir en GREEN

1. **Instalar `react-router-dom`** en `frontend/package.json` (dep nueva, ADR 27). Sin ella,
   `App.test.tsx` y `App.routing.test.tsx` no compilan. Es un fallo esperado de RED, no un
   bug del test.
2. **Backend:** crear `record.service.ts` (`listRecords` + `RecordListItem` + `MAX_RECORDS=100`),
   `records.controller.ts` (`getRecords`), `records.routes.ts` (`recordsRouter`), y **montar**
   `app.use('/records', recordsRouter)` en `app.ts` **sin `makeLimiter()`** (entre los routers
   de lectura, antes de `/names`).
   - **Confirmar carga en runtime** (`pnpm --filter @nach/backend smoke`) antes de dar el GREEN:
     los tests de endpoint mockean el service y no cargan el modelo real, así que un import ESM
     roto pasaría lint+typecheck+vitest y solo reventaría en `pnpm dev` (MEMORY: Mongoose ESM).
3. **Frontend:** crear `api/fetchRecords.ts` (+ re-export en `api/index.ts`), `useRecords.ts`,
   `RecordsList/RecordsList.tsx` (+ barrel `index.ts`), añadir el sub-bloque `text.records` al
   `schema.ts`, y convertir `App.tsx` a `<Routes>` con `/` y `/records`, envolviendo en
   `<BrowserRouter>` (dentro de `ThemeProvider`) en `main.tsx`. **Sin `<Link>` a `/records`.**

## Notas / decisiones tomadas ante ambigüedad

- **Región `aria-live` en loading (criterio 8):** el test afirma que el texto de carga está
  dentro de un elemento con atributo `aria-live` (`loading.closest('[aria-live]')`), sin fijar
  el valor (`polite`/`assertive`) ni el tag — el implementer elige.
- **Estructura tabular (criterio 9):** siguiendo la decisión #4 del design, los tests NO exigen
  `<table>`; afirman sobre el **texto** de cabeceras y la presencia de nombre+número. El
  implementer puede usar `<table>` semántica o lista con roles ARIA.
- **App.test.tsx existente:** se envolvió en `<MemoryRouter initialEntries={['/']}>` para que
  la prueba de integración de welcome siga siendo válida cuando `App` pase a declarar `<Routes>`
  (que requiere un Router ancestro). El fichero de ruteo se dejó **separado**
  (`App.routing.test.tsx`) porque mockea las pantallas a nivel de módulo (`vi.mock` se hoistea y
  chocaría con el render real de welcome del otro fichero).
```

## Nota de implementación (GREEN)

Fase **GREEN** completada: todos los tests del feature en verde, sin tocar ningún test.

### Archivos creados

**Backend:**
- `backend/src/services/record.service.ts` — `listRecords()` + `RecordListItem` + `MAX_RECORDS=100`.
  `Record.find({}, { sequence:1, name:1, createdAt:1, _id:0 }).sort({ sequence:-1 }).limit(100).lean()`,
  mapea `createdAt` a string ISO. Propaga el throw de Mongo (el controller responde 500).
- `backend/src/controllers/records.controller.ts` — `getRecords`: 200 con el array; `catch` → 500
  `{ error: 'internal_error' }` (sin filtrar detalle interno).
- `backend/src/routes/records.routes.ts` — `recordsRouter` con `GET /`.

**Frontend:**
- `frontend/src/api/fetchRecords.ts` — `fetchRecords(deps?)` sobre `apiFetch<RecordItem[]>('/records')`
  + `RecordItem`. Reusa la capa de red existente (base URL, `Accept`, `ApiError`).
- `frontend/src/features/records/useRecords.ts` — hook con máquina de estados
  `loading | error | empty | success` (carga al montar, `empty` como estado propio).
- `frontend/src/features/records/RecordsList/RecordsList.tsx` + `index.ts` (barrel) — render de los 4
  estados. `loading` en `aria-live="polite"`; `error` en `role="alert"`; `success` con `<table>`
  semántica (`<th scope="col">`), nombre completo (ADR 26); cero literales/hex (todo por `useBrand()`).

### Archivos editados

- `backend/src/app.ts` — monta `app.use('/records', recordsRouter)` en el bloque de LECTURA (tras
  `/crypto`, antes del bloque con `makeLimiter()`), **sin rate-limit**.
- `frontend/src/api/index.ts` — re-export de `fetchRecords` + `RecordItem`.
- `frontend/src/brand/core/schema.ts` — sub-bloque `text.records` con `.prefault({})` y `.default()`
  por campo (`title`, `nameHeader`, `numberHeader`, `loading`, `error`, `empty`).
- `frontend/src/App.tsx` — pasa a `<Routes>` con `/` → `WelcomeScreen` y `/records` → `RecordsList`.
  Sin `<Link>` a `/records`.
- `frontend/src/main.tsx` — envuelve `<App />` en `<BrowserRouter>` DENTRO de `<ThemeProvider>` (ambas
  rutas comparten marca).
- `frontend/package.json` — dependencia nueva `react-router-dom` (ADR 27).
- `feature_list.json` — `records_list` a `in_progress`.

### Resultados

| Verificación | Resultado |
|---|---|
| `pnpm --filter @nach/backend test` | **12 archivos / 63 tests OK** |
| `pnpm --filter @nach/frontend test` | **29 archivos / 280 tests OK** |
| `pnpm lint` (ambos) | **OK** |
| `pnpm typecheck` (ambos) | **OK** |
| `pnpm --filter @nach/backend smoke` | **`SMOKE_OK`** (app + modelos cargan en runtime) |

**Sin desviaciones del design.** `<table>` semántica elegida entre las opciones que el design dejaba
al implementer (decisión #4). El resto de la suite (welcome, crypto, voice, marca) sigue en verde: el
único ajuste que el giro a `<Routes>` requería (Router ancestro en `App.test.tsx`) ya lo previó el
tester.
