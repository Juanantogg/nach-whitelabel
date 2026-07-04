# Tests (RED) — brand_config

## Rev.2 (identidad de marca abierta, S3 manda) — fase RED de migración

> Re-diseño APROBADO por el humano (ver `design.md` Rev.2 y `CLAUDE.md`,
> "Decisión: identidad de marca abierta"). Los tests se **adaptaron** a la nueva
> arquitectura; fallan porque el código de producción sigue en Rev.1 (migración
> pendiente) — RED real, no error de config.

**Evidencia:** `pnpm exec vitest run src/brand` → **18 failed | 22 passed (40)**,
4 archivos en rojo (`registry`, `resolveBrand`, `loadBrand`, `ThemeProvider`), 2
en verde (`schema`, `applyBrandToDom`). Los 18 fallos son por el contrato viejo:
`BUNDLED_BRANDS`/`BRAND_KEYS` aún existen, `resolveBrand` filtra contra catálogo,
`loadBrand` cae a `BUNDLED_BRANDS[key]` y `ThemeProvider` recibe `brand=` en vez
de `config=`. Al migrar el implementer, pasarán a verde.

**Fixtures creados (datos de test, no producción):**
`frontend/src/brand/seeds/shopinbaz.json` y `.../seeds/elektra.json` — copia
literal de los `data/*.json` de Rev.1 (el `mv` real de `data/` + `default.json`
son del implementer). Los tests los importan como fixtures.

**Cambios por archivo (Rev.2):**

- **`schema.test.ts`** — se eliminó toda dependencia del enum cerrado. Nuevo
  bloque "BrandKey — identidad abierta": `expectTypeOf<BrandKey>().toEqualTypeOf
  <string>()` y una key arbitraria (`'banco_azteca'`, `'marca-cualquiera'`)
  compila/parsea. El resto del schema (defaults, prefault, rgbChannels) intacto.
  *Nota:* `expectTypeOf` es no-op en `vitest run`; el enum viejo lo caza
  `typecheck` (hoy `BrandKey` sigue siendo la unión → `--typecheck` rojo hasta
  que el implementer ponga `BrandKey = string`). 7 casos runtime en verde
  (mecanismo intacto); el delta de tipos es el RED del typecheck.

- **`registry.test.ts`** — reescrito: ya no `BUNDLED_BRANDS`/`BRAND_KEYS`. Ahora
  afirma `DEFAULT_BRAND_KEY === 'default'`, `DEFAULT_BRAND` es una BrandConfig
  neutra válida y **distinta** de shopinbaz/elektra, y que el catálogo cerrado
  desapareció (`registry` sin `BUNDLED_BRANDS`/`BRAND_KEYS`). Anclas de dato #5
  (shopinbaz morado / elektra rojo) migradas contra los **seeds** parseados.

- **`resolveBrand.test.ts`** — reescrito al contrato abierto: prod devuelve el
  subdominio TAL CUAL (`elektra`, `banco_azteca`, apex→`garcia3apps`), sin
  filtrar; hostname vacío → guard `DEFAULT_BRAND_KEY`; `?brand=` ignorado en
  prod; dev `?brand=` > `VITE_DEFAULT_BRAND` > `DEFAULT_BRAND_KEY`, sin descartar
  keys inexistentes (`?brand=marca-que-no-existe` → tal cual). Invariante:
  nunca lanza, siempre string no vacío.

- **`loadBrand.test.ts`** — `loadBrand(key: string)`; fallback SIEMPRE
  `DEFAULT_BRAND` (rechazo/404/JSON malformado/key inexistente); modo test/dev →
  `DEFAULT_BRAND` sin fetch; fetch OK con el seed de elektra → `parseBrandConfig
  (elektraSeed)`. Ya no importa `BUNDLED_BRANDS`.

- **`ThemeProvider.test.tsx`** — firma migrada a `<ThemeProvider config={...}>`.
  Multi-marca (#9) importa `seeds/{shopinbaz,elektra}.json`, los pasa por
  `parseBrandConfig` y los inyecta por prop; mantiene mecanismo (`it.each` contra
  la config) + 2 anclas de dato (`170 59 255` / `242 74 45`) + test "#8 cambiar
  config re-inyecta sin recargar" vía `rerender`. Ya no usa `brand=` ni
  `BUNDLED_BRANDS`.

- **`applyBrandToDom.test.ts`** — comportamiento sin cambios; solo el fixture
  pasa de `BUNDLED_BRANDS` a los seeds parseados (el catálogo se eliminó).

Criterio invariante-vs-ancla de Rev.1 conservado: mecanismo con invariantes
(config parseada, `DEFAULT_BRAND_KEY`), anclas de dato explícitas contra los
seeds. Tests junto a su módulo; `src/test/setup.ts` intacto; sin marca ficticia
nueva.

### Ajuste acotado del APEX en resolveBrand (decisión del usuario)

Problema: hoy prod hace `hostname.split('.')[0]`, así el apex `garcia3apps.com`
→ `'garcia3apps'` (string no vacío) → 404 en S3. Semánticamente el apex no es
una marca. Decisión: contar labels contra un dominio base **inyectado**.

**Firma final propuesta de `ResolveBrandInput`** (design.md aún no la recoge; se
deja constancia aquí para el implementer/designer):

```ts
interface ResolveBrandInput {
  hostname: string;
  search: string;
  isDev: boolean;
  defaultBrand?: string;   // VITE_DEFAULT_BRAND (dev)
  baseDomain: string;      // NUEVO — p.ej. 'garcia3apps.com' (inyectado)
}
```

Comportamiento cubierto en `resolveBrand.test.ts` (prod, `baseDomain =
'garcia3apps.com'`):

- `elektra.<base>` → `'elektra'`; `banco_azteca.<base>` → `'banco_azteca'`
  (un label extra sobre el base = marca, tal cual, sin filtrar). *[verdes]*
- `hostname === baseDomain` (apex) → `DEFAULT_BRAND_KEY`. *[RED nuevo]*
- `www.<base>` → `DEFAULT_BRAND_KEY`. *[RED nuevo]*
- hostname que NO termina en `baseDomain` (`elektra.otrodominio.com`) →
  `DEFAULT_BRAND_KEY` (guard). *[RED nuevo]*
- hostname vacío → `DEFAULT_BRAND_KEY`; `?brand=` ignorado en prod. *[verdes]*

DEV NO cambia: `?brand=` > `VITE_DEFAULT_BRAND` > `DEFAULT_BRAND_KEY`; el
subdominio no se lee y `baseDomain` se ignora. *[verdes]*

**Evidencia RED (ajuste apex):** `pnpm exec vitest run src/brand/resolveBrand
.test.ts` → **3 failed | 10 passed (13)**. Fallos: `expected 'garcia3apps' to be
'default'`, `expected 'www' to be 'default'`, `expected 'elektra' to be
'default'` — el código aún parte por `.split('.')[0]` sin contar labels. Además
`typecheck` marca `baseDomain does not exist in type 'ResolveBrandInput'` (RED de
la firma nueva): el implementer debe añadir `baseDomain: string` al interface y
contar labels vs base. Solo se tocó `resolveBrand.test.ts`; el resto de módulos y
sus tests, sin cambios.

---

## Histórico Rev.1 (catálogo cerrado — superado por Rev.2)

Fase RED del ciclo TDD. Se escribieron tests Vitest en 6 archivos bajo
`frontend/src/brand/`, derivados de los 9 `acceptance` de la feature y del bloque
"Criterios de aceptación traducibles a tests" del `design.md` (fuente de verdad
para nombres de archivo, exports, firmas y valores). Tras el GREEN se aplicó un
refactor de calidad (ver "Refactor de calidad" más abajo): 34 casos verdes.

**Precondición aplicada:** el diseño y el `research.md` exigen Zod (v4). No estaba
instalado; se añadió `zod@^4.4.3` al frontend (`pnpm --filter @nach/frontend add
zod`) para que `schema.test.ts` falle por el módulo `./schema` ausente y no por un
import de Zod roto (RED limpio, no falso error de setup).

Los módulos de producción bajo `frontend/src/brand/` **no se crearon** (es trabajo
del implementer): los tests fallan al resolver sus imports, que es el RED correcto.

## Archivos de test y mapeo a acceptance

### `frontend/src/brand/schema.test.ts` (5 tests) → acceptance #1, #3
Importa `brandConfigSchema`, `parseBrandConfig` de `./schema`.
- rellena todos los campos con defaults ante `{}` (text/colors/style/assets definidos).
- `parseBrandConfig(undefined)` no lanza y devuelve defaults (primary `170 59 255`,
  title de shopinbaz).
- JSON parcial `{ text: { title: 'X' } }` → `title === 'X'` y resto con defaults
  (marca usable).
- color inválido (`colors.primary: 'morado'`) hace fallar `brandConfigSchema.parse`.
- color válido `'1 2 3'` se conserva (camino feliz del regex).

### `frontend/src/brand/registry.test.ts` (5 tests) → acceptance #5
Importa `BRAND_KEYS`, `BUNDLED_BRANDS`, `DEFAULT_BRAND_KEY` de `./registry`.
- `BRAND_KEYS` incluye `shopinbaz` y `elektra`.
- `DEFAULT_BRAND_KEY === BRAND_KEYS[0] === 'shopinbaz'` (primera = prioridad).
- `BUNDLED_BRANDS.shopinbaz.colors.primary === '170 59 255'` (morado).
- `BUNDLED_BRANDS.elektra.colors.primary === '242 74 45'` (rojo).
- cada marca bundleada es una `BrandConfig` completa (title, illustration, color
  con formato "R G B").

### `frontend/src/brand/resolveBrand.test.ts` (9 tests) → acceptance #4
Importa `resolveBrand` de `./resolveBrand` (función pura, deps inyectadas; NO toca
`window`/`import.meta`).
- Prod: `elektra.garcia3apps.com` → `elektra`.
- Prod: apex `garcia3apps.com` → `shopinbaz` (default).
- Prod: subdominio desconocido → default.
- Prod: `?brand=elektra` con host shopinbaz → `shopinbaz` (`?brand=` ignorado en prod).
- Dev: `?brand=elektra` → `elektra`.
- Dev: sin `?brand=`, `defaultBrand: 'elektra'` → `elektra`.
- Dev: sin `?brand=` ni `VITE_DEFAULT_BRAND` → `shopinbaz` (primera).
- Dev: `?brand=noexiste` → cae a `VITE_DEFAULT_BRAND` sin lanzar.
- Dev: subdominio `elektra.` NO se lee → `shopinbaz`.

### `frontend/src/brand/loadBrand.test.ts` (5 tests) → acceptance #2, #3
Importa `loadBrand` de `./loadBrand` y `BUNDLED_BRANDS` de `./registry`. `fetchFn`
mockeado con `vi.fn` (cero red).
- modo test/dev (`isDev: true`) → bundleada, sin llamar a `fetch`.
- prod + `fetchFn` con JSON válido → config parseada (Zod rellena lo que falta).
- prod + `fetchFn` rechazado (CORS/red) → fallback bundleado.
- prod + `res.ok === false` (404) → fallback bundleado.
- prod + JSON malformado (color inválido, Zod rechaza) → fallback bundleado.

### `frontend/src/brand/applyBrandToDom.test.ts` (4 tests) → acceptance #6
Importa `applyBrandToDom` de `./applyBrandToDom`. Lee `document.documentElement.style`.
- escribe `--brand-primary = 242 74 45` (elektra) en `:root`.
- escribe el resto de vars de color (bg/surface/accent/text/muted) de shopinbaz.
- escribe las vars de estilo no-color (`--brand-radius`, `--brand-title-weight`,
  `--brand-font`).
- cambiar shopinbaz → elektra re-setea `--brand-primary` (170 59 255 → 242 74 45)
  sin recargar.

### `frontend/src/brand/ThemeProvider.test.tsx` (3 tests) → acceptance #7, #8, #9
Importa `ThemeProvider`, `useBrand` de `./ThemeProvider`. Define un `BrandShowcase`
que SOLO lee de `useBrand()` (cero literales) y se renderiza bajo dos marcas.
`ThemeProvider` recibe la prop `brand: BrandKey` para fijar la marca de forma
determinista (según §4 y acceptance #9 del diseño).
- shopinbaz → título shopinbaz, illustration `/brands/shopinbaz/illustration.svg`,
  `--brand-primary = 170 59 255`.
- elektra → título "Préstamo Elektra", illustration `/brands/elektra/illustration.svg`,
  `--brand-primary = 242 74 45`.
- `submitLabel` "Comenzar" viene de config (mismo componente, cero literal).

## Evidencia de RED

Comando: `pnpm exec vitest run src/brand` (equivalente al slice de brand del
`pnpm --filter @nach/frontend test`).

Resultado resumido:

```
 FAIL  src/brand/ThemeProvider.test.tsx  Failed to resolve import "./ThemeProvider"
 FAIL  src/brand/applyBrandToDom.test.ts Failed to resolve import "./applyBrandToDom"
 FAIL  src/brand/loadBrand.test.ts       Failed to resolve import "./loadBrand"
 FAIL  src/brand/registry.test.ts        Failed to resolve import "./registry"
 FAIL  src/brand/resolveBrand.test.ts    Failed to resolve import "./resolveBrand"
 FAIL  src/brand/schema.test.ts          Failed to resolve import "./schema"

 Test Files  6 failed (6)
```

Los 6 archivos fallan por **imports no resueltos** de módulos que aún no existen
(`./schema`, `./registry`, `./resolveBrand`, `./loadBrand`, `./applyBrandToDom`,
`./ThemeProvider`) — RED real por código de producción ausente, no por error de
config, de Zod ni de setup de Vitest. Cuando el implementer cree esos módulos con
las firmas del diseño, cada `it` pasará a evaluar su aserción.

## Refactor de calidad — criterio invariante vs. ancla (post-GREEN)

Tras el GREEN, se aplicó un refactor con lente "arquitectura escalable"
(exigida por el enunciado). Los 34 tests siguen verdes; **no se relajó ninguna
aserción**: se sustituyeron literales por invariantes donde el test prueba el
MECANISMO, y se conservaron (e hicieron explícitos) los literales donde el test
verifica deliberadamente el DATO de una marca. Criterio aplicado:

- **Test de MECANISMO (regla general)** → afirma la INVARIANTE, no el dato.
  Cambiar un color/texto de marca o la marca por defecto NO debe romperlo.
- **Test-ANCLA (identidad de un dato)** → el literal es intencional y se queda:
  es la prueba de que shopinbaz ES `170 59 255` y elektra ES `242 74 45`.

Cambios por archivo:

- **`resolveBrand.test.ts`** — los `toBe('shopinbaz')` que representaban "la
  marca por defecto/primera" ahora son `toBe(DEFAULT_BRAND_KEY)` (importado de
  `./registry`). La resolución a una marca concreta usa
  `OTHER_BRAND_KEY = BRAND_KEYS.find(k => k !== DEFAULT_BRAND_KEY)` — modela
  "resuelve a una marca del registry distinta de la default" sin hardcodear
  `elektra`. Resultado: cambiar cuál es la marca por defecto no rompe el
  mecanismo de selección por entorno. (9 tests, cobertura idéntica.)

- **`schema.test.ts`** — el copy/color exactos son DEFAULTS DEL SCHEMA, no de la
  marca shopinbaz. La fuente de verdad pasa a ser `parseBrandConfig({})`:
  `undefined` se compara con `parseBrandConfig({})` (mecanismo: ambos → config
  por defecto completa) y "parcial rellena el resto" compara los campos no
  provistos contra `defaults.text.*` / `defaults.colors` en vez de literales.
  Se mantiene 1 ancla de "el default existe y no es vacío" (regex de color,
  longitud > 0). Cambiar el copy del default ya no rompe el test del mecanismo.
  (5 tests, cobertura idéntica.)

- **`ThemeProvider.test.tsx`** — se separó explícitamente mecanismo de ancla:
  - MECANISMO (`it.each(['shopinbaz','elektra'])`): el mismo componente refleja
    EXACTAMENTE los textos/illustration/color de `BUNDLED_BRANDS[key]`, sea cual
    sea el copy (invariante del render multi-marca, sin literales).
  - ANCLA (2 tests marcados `ANCLA:`): literales `170 59 255` / `242 74 45` y los
    títulos/rutas concretos de shopinbaz y elektra — INTENCIONALES (acceptance #9
    + #5). Deben romperse si alguien confunde las marcas o cambia su identidad.
  (34 casos totales al ejecutar por el desdoble `it.each` → 2 + 2 anclas.)

- **`registry.test.ts`** — es el test-ancla natural de los datos: los literales
  de color por marca (`170 59 255`, `242 74 45`) son correctos y se conservan
  sin cambios.

- **`loadBrand.test.ts` / `applyBrandToDom.test.ts`** — sin cambios de este
  refactor; ya afirmaban contra `BUNDLED_BRANDS` (invariante) salvo los anclajes
  de color en `applyBrandToDom`, que son la prueba deliberada de que la var se
  escribe con el valor de la marca.

Estructura: los tests se mantienen junto a su módulo (`src/brand/*.test.ts`),
convención del repo (`App.test.tsx`, backend `app.test.ts`). No se tocó
`src/test/setup.ts` (setup global: matchers + cleanup). No se añadió marca
ficticia.

Estado post-refactor: `test` 34/34 verde, `lint` sin errores (solo 1 warning
`react-refresh/only-export-components` en `ThemeProvider.tsx`, archivo de
producción del implementer, ajeno a estos tests), `typecheck` limpio.

## Notas para el implementer

- Exports esperados (nombres exactos usados por los tests):
  - `schema.ts`: `brandConfigSchema`, `parseBrandConfig`.
  - `registry.ts`: `BUNDLED_BRANDS`, `BRAND_KEYS`, `DEFAULT_BRAND_KEY`.
  - `resolveBrand.ts`: `resolveBrand(input: { hostname, search, isDev, defaultBrand? })`.
  - `loadBrand.ts`: `loadBrand(key, { fetchFn?, s3BaseUrl?, isDev? })`.
  - `applyBrandToDom.ts`: `applyBrandToDom(config)`.
  - `ThemeProvider.tsx`: `ThemeProvider` (prop `brand: BrandKey`) y `useBrand()`.
- El límite 15 (`NAME_MAX_LENGTH`) NO se testea aquí (es de `welcome_screen`).
- El JSON malformado de S3 debe hacer que `parseBrandConfig` lance (regex de color)
  para que `loadBrand` caiga al `catch` → fallback bundleado.
```
