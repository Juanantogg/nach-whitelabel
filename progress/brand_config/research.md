# Research — brand_config

> Fecha de investigación: 2026-07-03. Fuentes primarias (MDN, zod.dev,
> tailwindcss.com, docs y discussions oficiales de Vitest/Zod/Tailwind).
> Las decisiones de producto (JSON en S3, Zod con `.default()` por campo,
> selección por entorno, ThemeProvider + CSS vars + Tailwind v4) YA están
> tomadas en `feature_list.json`; aquí solo se investiga el CÓMO implementarlas
> bien y hoy.

## Versiones reales (verificadas en `frontend/package.json`, 2026-07-03)

- React `^19.2.7`, Vite `^8.1.3`, TypeScript `~6.0.2`.
- Tailwind `^4.3.2` + `@tailwindcss/vite ^4.3.2` (plugin de Vite, NO PostCSS).
- Vitest `^4.1.9`, jsdom `^29.1.1`, Testing Library React `^16.3.2`.
- **Zod NO está instalado todavía.** Hay que añadirlo al frontend. Última
  estable en npm hoy: **`zod@4.4.3`** (`npm view zod dist-tags` → `latest: 4.4.3`).
  Instalar con `pnpm --filter @nach/frontend add zod`.

## Preguntas

1. Zod v4: ¿cómo se rellena un JSON PARCIAL campo a campo con `.default()` (no
   todo-o-nada)? ¿Objetos anidados ausentes? ¿`.catch()` por campo para tolerar
   tipos inválidos sin romper?
2. Tailwind v4: ¿cómo se define un token `bg-brand-primary` que lea una CSS var
   `--brand-primary` inyectada en `:root` en runtime? ¿`@theme` vs `@theme inline`?
3. Detección de subdominio en el front (`window.location.hostname`) y cómo
   mockear el hostname en Vitest/jsdom sin contaminar tests.
4. Fetch de JSON público desde S3/CloudFront con CORS: patrón resiliente con
   fallback y cómo mockear el fetch en Vitest sin red.

## Hallazgos

### 1. Zod v4 — defaults campo a campo, anidados y tolerancia de tipos

- **`.default()` se aplica campo a campo y solo cuando el valor es `undefined`.**
  `z.object({ a: z.string().default("x"), b: z.number().default(0) }).parse({})`
  → `{ a: "x", b: 0 }`. Cada campo ausente se rellena con SU default; no es
  todo-o-nada. Este es exactamente el patrón que pide la decisión de producto.
  Fuente: https://zod.dev/api (sección Defaults, consultada 2026-07-03).
  > "setting a default value will short-circuit the parsing process. If the
  > input is `undefined`, the default value is eagerly returned."

- **TRAMPA con objetos ANIDADOS ausentes (cambio real de Zod v4).** Si la clave
  del objeto anidado falta por completo, el campo es requerido y el parse
  **falla** salvo que le des un default/prefault al objeto anidado. Pero
  `.default()` en un objeto **short-circuita**: devuelve el literal SIN
  re-parsear, así que `z.object({ primary: z.string().default("#000") }).default({})`
  al recibir `undefined` devuelve `{}` **literal, sin `primary`**. NO rellena los
  campos internos. Fuente: https://zod.dev/api (Defaults), verificado 2026-07-03.

- **Solución correcta para anidados: `.prefault({})`.** `.prefault()` NO
  short-circuita: re-parsea el valor a través del schema, de modo que los
  `.default()` internos SÍ se disparan.
  `z.object({ primary: z.string().default("#000") }).prefault({})` con input
  `undefined` → re-parsea `{}` → `{ primary: "#000" }`. Es el patrón para que un
  bloque anidado ausente (p. ej. `colors`, `text`) se rellene entero.
  > "the prefault value will be parsed instead. The parsing process is _not_
  > short circuited."
  Fuente: https://zod.dev/api (Prefault), 2026-07-03.

- **`.catch()` por campo para tolerar tipos INVÁLIDOS sin romper.** `.default()`
  solo cubre `undefined`; si el JSON trae un tipo equivocado (p. ej. `primary:
  123` donde se espera string), `.default()` NO lo salva y el parse falla.
  `.catch(fallback)` devuelve el fallback ante CUALQUIER error de validación de
  ese campo. `z.string().catch("#000").parse(123)` → `"#000"`. Para máxima
  resiliencia (JSON malformado campo a campo), combinar:
  `z.string().default("#000").catch("#000")` — ausente → default; tipo malo →
  catch. Acepta callback con acceso al error: `.catch((ctx) => { ctx.error; ... })`.
  Fuente: https://zod.dev/api (Catch), 2026-07-03.

- **Claves desconocidas: `z.object()` hace `strip` por defecto** (las descarta
  del resultado). Bien para robustez ante un JSON con campos de más. Alternativas
  explícitas: `z.strictObject()` (falla), `z.looseObject()` (passthrough).
  Fuente: https://zod.dev/api (Objects), 2026-07-03.

- **Nota sobre `.default({})` en Zod 3 → 4:** en v3 se abusaba de `.default({})`
  para autorrellenar anidados; en v4 eso ya NO rellena los campos internos (por
  el short-circuit). Tutoriales/blogs de Zod 3 que usan `.default({})` para
  anidados están **obsoletos** para v4. Fuente: discusión oficial
  https://github.com/colinhacks/zod/discussions/5506 (2025).

### 2. Tailwind v4 — token que lee una CSS var externa en runtime

- **Tailwind v4 usa CSS-first: el `@theme` va en el CSS, no en `tailwind.config`.**
  Un token declarado en `@theme` genera automáticamente las utilidades. Con
  namespace `--color-*`: `@theme { --color-brand-primary: #6366F1; }` genera
  `bg-brand-primary`, `text-brand-primary`, `border-brand-primary`, etc.
  Fuente: https://tailwindcss.com/docs/theme (Theme variables) y
  https://tailwindcss.com/blog/tailwindcss-v4 (2025-01), 2026-07-03.

- **CLAVE para theming dinámico: `@theme inline`.** Diferencia exacta:
  - `@theme { --color-brand-primary: var(--brand-primary); }` emite en el CSS
    una var global `--color-brand-primary: var(--brand-primary)` y las utilidades
    referencian `var(--color-brand-primary)`. Como esa var global se resuelve una
    vez, cambiar `--brand-primary` en `:root` en runtime NO siempre se propaga
    limpiamente (hay indirección y problemas con overrides en cascada).
  - `@theme inline { --color-brand-primary: var(--brand-primary); }` **incrusta
    el valor del token directamente en las utilidades**: `.bg-brand-primary {
    background-color: var(--brand-primary); }`. Así la utilidad lee EN VIVO la
    var externa `--brand-primary` que el ThemeProvider inyecte/actualice en
    `:root` en runtime. **Este es el modo correcto** para nuestro caso (token
    Tailwind que apunta a una CSS var inyectada por marca en runtime).
  Fuente: https://github.com/tailwindlabs/tailwindcss/discussions/18560 (2025)
  y https://tailwindcss.com/docs/theme (sección "referencing other variables" /
  inline), 2026-07-03.

- **Patrón recomendado para brand_config (ejemplo mínimo, en el CSS global):**
  ```css
  @import "tailwindcss";

  @theme inline {
    --color-brand-primary: var(--brand-primary);
    --color-brand-secondary: var(--brand-secondary);
    --color-brand-bg: var(--brand-bg);
    --color-brand-text: var(--brand-text);
  }

  /* Valores por defecto de arranque (marca fallback) para evitar FOUC.
     El ThemeProvider sobrescribe estas vars en :root al montar / al
     cambiar de marca. */
  :root {
    --brand-primary: #6d28d9;   /* shopinbaz morado (default) */
    --brand-secondary: #a78bfa;
    --brand-bg: #ffffff;
    --brand-text: #111827;
  }
  ```
  El ThemeProvider hace `document.documentElement.style.setProperty('--brand-primary', color)`
  por cada token de la marca activa. Los componentes usan solo `bg-brand-primary`,
  `text-brand-text`, etc. Cero hex en componentes. Cambiar de marca = re-setear
  las vars, sin recargar (cumple la decisión).

- **Trampa Tailwind v4:** el proyecto ya usa `@tailwindcss/vite` (plugin de
  Vite), NO PostCSS ni `tailwind.config.js`. Toda la config de tema es CSS-first
  (`@theme` en el CSS). No introducir `tailwind.config.js` estilo v3.
  Fuente: `frontend/package.json` + https://tailwindcss.com/blog/tailwindcss-v4.

### 3. Detección de subdominio + mock del hostname en Vitest/jsdom

- **Extracción del subdominio:** leer `window.location.hostname` y separar por
  `.`. `elektra.garcia3apps.com` → `["elektra","garcia3apps","com"]` → primer
  segmento = `"elektra"`. Trampas a manejar en la lógica (no en el test):
  - Apex sin subdominio (`garcia3apps.com`, 2 labels) → no hay marca → fallback.
  - `www.` → tratar como "sin marca" (excluir `www`).
  - `localhost` / IPs / `*.cloudfront.net` (Plan B deploy) → no aplicar
    subdominio; en esos casos manda la ruta dev (`?brand=` > env > primera marca).
  - Puerto: `hostname` NO incluye el puerto (eso es `host`), así que es seguro.
  Fuente: MDN `Location.hostname`
  https://developer.mozilla.org/en-US/docs/Web/API/Location/hostname (2026-07-03).

- **Mock del hostname en Vitest/jsdom — TRAMPA principal:** en jsdom `window.location`
  no es trivialmente reasignable (`window.location = ...` puede lanzar o no
  propagar). Dos patrones que funcionan hoy:
  - **Recomendado por mantenedores de Vitest: `vi.spyOn` sobre el getter:**
    ```js
    vi.spyOn(window, 'location', 'get')
      .mockReturnValue({ hostname: 'elektra.garcia3apps.com' } as Location);
    ```
    Con `restoreMocks: true` en la config de Vitest, se limpia solo entre tests.
  - **Alternativa robusta: `Object.defineProperty`** con `configurable: true`
    (imprescindible para poder resetear):
    ```js
    Object.defineProperty(window, 'location', {
      value: { hostname: 'elektra.garcia3apps.com' },
      configurable: true,
    });
    ```
  - `vi.stubGlobal('location', { hostname })` también sirve, pero **NO se
    resetea solo**: exige `unstubGlobals: true` en config o
    `vi.unstubAllGlobals()` en `beforeEach`. Si no, contamina tests posteriores.
  Fuente: https://github.com/vitest-dev/vitest/discussions/2213 y
  https://vitest.dev/guide/mocking/globals (2026-07-03).

- **Contaminación entre tests (falso positivo clásico):** `window.location`
  arrastra estado entre tests. Resetear SIEMPRE en `beforeEach`/`afterEach`
  (`vi.restoreAllMocks()` con `restoreMocks: true`, o `vi.unstubAllGlobals()`).
  Fuente: https://github.com/vitest-dev/vitest/discussions/2213 (2025).

- **Mejor diseño para testabilidad:** que la función de detección acepte el
  hostname como argumento puro (`resolveBrandFromHostname(hostname: string)`) y
  solo la capa fina que la llama toque `window.location`. Así el grueso de los
  tests no necesita mockear nada (funciones puras). Es más limpio que mockear
  `location` en cada caso.

### 4. Fetch de JSON público (S3/CloudFront) resiliente + mock en Vitest

- **Fetch con fallback (patrón resiliente):** envolver el `fetch` en `try/catch`
  y comprobar `res.ok`. Un fallo de CORS o de red hace que `fetch` **rechace**
  (throw), mientras que un 404 resuelve con `res.ok === false` — hay que cubrir
  AMBOS. Ante cualquiera → devolver la marca bundleada por defecto. Nunca dejar
  que el error se propague a la UI. Ejemplo mínimo:
  ```js
  async function loadBrandConfig(url, fallback) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return fallback;               // 404/403/5xx
      const json = await res.json();
      return brandConfigSchema.parse(json);       // Zod rellena/tolera
    } catch {
      return fallback;                            // CORS, red, JSON inválido
    }
  }
  ```
  El `brandConfigSchema.parse` con `.default()`/`.catch()` por campo hace que un
  JSON parcial o con campos malos siga produciendo una marca usable (decisión de
  producto). Fuente: MDN `fetch()` / `Response.ok`
  https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch (2026-07-03).

- **CORS del bucket (contexto, la infra la implementa `deploy`):** el bucket
  S3/CloudFront debe responder con `Access-Control-Allow-Origin` para los
  subdominios de marca. Un fallo de CORS se manifiesta como `fetch` rechazado
  (no como respuesta 4xx legible): el `catch` de arriba lo cubre → fallback.

- **Caché:** el JSON de marca es público e inmutable-ish. Recomendado servir vía
  CloudFront con `Cache-Control` (p. ej. `max-age` moderado) y dejar que el
  navegador cachee; NO añadir cache-busting agresivo en el front. Para forzar
  frescura en un despliegue, versionar el path del JSON o invalidar CloudFront
  (tema de `deploy`, no de esta feature).

- **Mock del fetch en Vitest (sin red):** `vi.stubGlobal('fetch', vi.fn(...))`.
  Cubrir los 3 escenarios de la acceptance:
  ```js
  // OK con JSON parcial
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ text: { title: 'Hola' } }),
  })));

  // 404 → fallback
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

  // CORS / red → fetch rechaza → fallback
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  ```
  Limpiar con `vi.unstubAllGlobals()` en `beforeEach`/`afterEach` (o
  `unstubGlobals: true`), igual que con `location`, para no contaminar.
  Fuente: https://vitest.dev/guide/mocking/globals y
  https://vitest.dev/api/vi.html (2026-07-03).

## Recomendación para esta feature

- **Enfoque sugerido:**
  1. `brandConfigSchema` (Zod v4): `.default()` + `.catch()` en CADA campo hoja
     (textos, colores hex, urls de logo/ilustración, estilos). Para bloques
     anidados (`colors`, `text`, `assets`) usar **`.prefault({})`** en el objeto
     anidado, no `.default({})`, para que un bloque ausente se rellene con los
     defaults de sus hijos. `z.object()` (strip) para tolerar campos extra.
  2. Función pura `resolveBrandFromHostname(hostname)` + selector por entorno
     puro que reciba `{ hostname, searchParams, env }` y devuelva el id de marca.
     Prod: solo subdominio. Dev/test: `?brand=` (solo si no es prod) > env
     `VITE_DEFAULT_BRAND` > primera marca. Testeables sin tocar `window`.
  3. `loadBrandConfig(url, fallbackBrand)` con `try/catch` + `res.ok`, que valida
     con Zod y devuelve la marca bundleada ante 404/CORS/red/JSON malo.
  4. `ThemeProvider` que, dada la marca activa, hace `setProperty('--brand-*')`
     en `document.documentElement`. CSS global con `@theme inline` mapeando
     `--color-brand-*` → `var(--brand-*)` y un `:root` con la marca default para
     evitar FOUC.
  5. Marcas bundleadas: shopinbaz (morado) y elektra (rojo/naranja) como
     objetos TS/JSON en el repo (ver `docs/images`) — sirven de fallback y de
     fixtures de tests.

- **Trampas a evitar:**
  - Usar `.default({})` en objetos anidados (Zod v4 NO rellena los hijos por el
    short-circuit) → usar `.prefault({})`.
  - Confiar solo en `.default()` para JSON malformado: los tipos inválidos
    necesitan `.catch()`; `.default()` solo cubre `undefined`.
  - `@theme` (sin `inline`) para tokens que deben leer una var de runtime → usar
    `@theme inline`, si no el theming dinámico no propaga limpio.
  - Reasignar `window.location` directamente en jsdom → usar `vi.spyOn(...,'get')`
    u `Object.defineProperty(...configurable:true)`; resetear en `beforeEach`.
  - No resetear `vi.stubGlobal` (location y fetch) → contamina otros tests.
  - Cubrir 404 (res.ok false) Y rechazo (CORS/red) por separado en el fetch.
  - Introducir `tailwind.config.js` estilo v3: el repo es Tailwind v4 CSS-first
    con `@tailwindcss/vite`.

- **Deprecaciones relevantes:**
  - Zod 3: `.default({})` para autorrellenar anidados — obsoleto en v4.
  - Tailwind v3: config JS de `theme.extend.colors` + `tailwind.config.js` —
    reemplazado por `@theme` en CSS en v4.
  - `vi.stubGlobal` sin `unstubGlobals`/reset — patrón frágil, documentar el reset.

## Fuentes

- https://zod.dev/api — API v4: Defaults (short-circuit), Prefault (re-parse),
  Catch (tolerancia de tipos), Objects (strip por defecto). (2026-07-03)
- https://github.com/colinhacks/zod/discussions/5506 — cambio v3→v4 en defaults
  de objetos anidados; `.default({})` ya no autorrellena hijos. (2025)
- `npm view zod dist-tags` — última estable `zod@4.4.3`. (2026-07-03)
- https://tailwindcss.com/docs/theme — `@theme` genera utilidades; namespace
  `--color-*`; referenciar otras vars. (2026-07-03)
- https://github.com/tailwindlabs/tailwindcss/discussions/18560 — `@theme` vs
  `@theme inline`: inline incrusta el valor y permite leer vars de runtime;
  sin inline emite var global y complica overrides/runtime. (2025)
- https://tailwindcss.com/blog/tailwindcss-v4 — Tailwind v4 CSS-first, tokens
  como CSS vars, theming en runtime sin rebuild. (2025-01)
- https://github.com/vitest-dev/vitest/discussions/2213 — mock de
  `window.location`: `vi.spyOn(get)` recomendado; `Object.defineProperty`
  configurable; contaminación entre tests. (2025)
- https://vitest.dev/guide/mocking/globals — `vi.stubGlobal` / `unstubGlobals` /
  `vi.unstubAllGlobals()` para location y fetch. (2026-07-03)
- https://vitest.dev/api/vi.html — API de `vi.spyOn`, `vi.stubGlobal`,
  `vi.restoreAllMocks`. (2026-07-03)
- https://developer.mozilla.org/en-US/docs/Web/API/Location/hostname —
  `hostname` sin puerto; base para extraer el subdominio. (2026-07-03)
- https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch — `fetch`
  rechaza en CORS/red; 404 resuelve con `res.ok === false`. (2026-07-03)
- `frontend/package.json` — versiones instaladas: Tailwind 4.3.2 + plugin Vite,
  Vitest 4.1.9, jsdom 29.1.1, React 19.2.7; Zod aún NO instalado. (2026-07-03)
