# Design — brand_config

> **Revisión 2 (2026-07-03).** Re-diseño por decisión de arquitectura del
> usuario: *identidad de marca abierta (S3 manda)* — ver `CLAUDE.md`, sección
> "Decisión: identidad de marca abierta (S3 manda) — brand_config". Este
> documento **revisa** el diseño anterior (Revisión 1); lo que cambia está
> marcado abajo. Todo lo no listado en "Cambios respecto al diseño anterior"
> sigue igual que en Rev. 1.

---

## Cambios respecto al diseño anterior

Delta para tester/implementer. Cada bullet es un cambio concreto respecto a la
Revisión 1 de este mismo archivo.

- **`BrandKey` deja de ser unión cerrada → `BrandKey = string`.** Se **elimina**
  `brandKeySchema = z.enum(['shopinbaz','elektra'])` de `schema.ts`. Ya no se
  valida la key contra una lista; la única red de validación es
  `brandConfigSchema` (Zod con `.default()`/`.prefault()` por campo).
- **El registry deja de exponer un catálogo de 2 marcas.** Se **elimina**
  `BUNDLED_BRANDS` (Record de 2 marcas) y `BRAND_KEYS` (lista cerrada). El único
  bundle de runtime pasa a ser **`DEFAULT_BRAND`** (una sola marca genérica
  neutra) más `DEFAULT_BRAND_KEY = 'default'`.
- **`shopinbaz.json` y `elektra.json` dejan de importarse en runtime.** Se
  **mueven** de `frontend/src/brand/data/` a **`frontend/src/brand/seeds/`**
  como seeds (lo que el deploy sube a S3 y lo que los tests usan como fixtures).
  Solo `default.json` vive en `data/` (o en `seeds/` importado — ver §Ubicación).
- **`resolveBrand` deja de validar contra catálogo.** En prod devuelve el
  subdominio **tal cual** (string, sin filtrar). En dev, el orden pasa a
  `?brand=` > `VITE_DEFAULT_BRAND` > `DEFAULT_BRAND_KEY` (`'default'`), sin
  "primera marca del catálogo" (que ya no existe). Ya no usa `asBrandKey`.
- **`loadBrand(key: string)` recibe una key abierta.** El fallback ante cualquier
  fallo pasa a ser **siempre `DEFAULT_BRAND`** (ya no hay `BUNDLED_BRANDS[key]`;
  no existe catálogo del que sacar la marca concreta offline).
- **`ThemeProvider` cambia de firma: `brand: BrandKey` → `config: BrandConfig`.**
  El Provider ya **no** resuelve ni carga nada; recibe la config **ya resuelta**
  por prop, la expone por `useBrand()` e inyecta las CSS vars. `resolveBrand` +
  `loadBrand` corren **fuera**, en `main.tsx` (o un hook de arranque).
- **El test multi-marca cambia de mecánica.** Ya no pasa `brand="elektra"`;
  importa `seeds/elektra.json` + `seeds/shopinbaz.json`, los pasa por
  `parseBrandConfig` y monta `<ThemeProvider config={...}>` con cada uno. Es
  síncrono, sin red, sin catálogo.
- **Reinterpretación de acceptance #4 y #5** (ver §"Mapeo de acceptance
  reinterpretados"): "primera marca" → `DEFAULT_BRAND_KEY = 'default'`;
  "2 marcas bundleadas como fallback" → el fallback ahora es **1 default
  genérico**, y las 2 marcas de ejemplo son **seeds** para S3/tests.

Lo que **NO cambia**: la forma de `brandConfigSchema` (mismos campos, mismos
`.default()`/`.prefault()`, mismo `rgbChannels`, mismo `parseBrandConfig`), la
constante `NAME_MAX_LENGTH = 15`, `applyBrandToDom` (idéntico), la constante
`S3_BASE_URL`, los tokens `@theme` en `index.css`, y las Alternativas A/B/C de
Rev. 1 (A1 canales RGB, B1 CSS vars, C1 resolución fuera del render — de hecho
C1 ahora se vuelve obligatorio por la decisión 4).

---

## Objetivo

Cerrar el CÓMO del sistema white-label con **identidad de marca abierta**: la
forma exacta de la config de marca (schema Zod con defaults por campo), el
contenido de **un default genérico** bundleado, las **seeds** de las dos marcas
de ejemplo (shopinbaz, elektra) que el deploy subirá a S3, el mecanismo de
carga/selección por entorno (fetch S3 por key `string` + fallback al default) y
la inyección al DOM vía ThemeProvider (que recibe la config ya resuelta) +
tokens Tailwind. Todo listo para que el tester reescriba tests RED desde los
`acceptance` de la feature reinterpretados.

Restricciones ya decididas por producto (bloque `decisions` + decisión de
arquitectura de `CLAUDE.md`, no se reabren): config = JSON validado con Zod;
fetch S3 en prod + **un default genérico** de fallback; selección por entorno
(subdominio tal cual en prod; `?brand=` solo dev > `VITE_DEFAULT_BRAND` >
`'default'`); ThemeProvider inyecta `--brand-*` en `:root` a partir de una
config recibida por prop; S3 y subdominios reales son de la feature `deploy`
(aquí van MOCKEADOS). Cero colores/textos literales en componentes.

---

## Contrato / arquitectura

### 1. Schema de la config de marca (Zod) — CAMBIA (solo se quita el enum)

Archivo: `frontend/src/brand/schema.ts`. Exporta `brandConfigSchema`,
`parseBrandConfig`, `BrandConfig` (`z.infer`) y `BrandKey`.

**Cambio único respecto a Rev. 1:**

```ts
// ELIMINAR:
// export const brandKeySchema = z.enum(['shopinbaz', 'elektra']);
// export type BrandKey = z.infer<typeof brandKeySchema>;

// AÑADIR:
/** Key de marca abierta: en prod es el subdominio tal cual; el bucket S3 dicta
 *  qué keys existen. La validación es brandConfigSchema, no una lista. */
export type BrandKey = string;
```

Todo lo demás del schema **queda igual** que en el código actual: `rgbChannels`,
los campos `key`/`name`/`text`/`colors`/`style`/`assets` con sus `.default()`,
los `.prefault({})` por bloque anidado, el `.prefault({})` raíz, y
`parseBrandConfig(raw)` = `brandConfigSchema.parse(raw)` (usar `.parse`, no
`.safeParse`, para que el fallo caiga al `try/catch` del loader).

> Nota sobre los `.default()` internos del schema: hoy apuntan a valores de
> shopinbaz (p.ej. `title` default = "¡Te damos la bienvenida a shopinbaz!").
> Eso es **cosmético** y no lo obliga la decisión, pero para coherencia con
> "marca neutra" se recomienda que los defaults del schema describan la **marca
> genérica** (ver §Nota de neutralidad de defaults). No es bloqueante para los
> tests de esta feature.

**Comportamiento común a todas las marcas (NO va en config): el límite de 15
caracteres.** Sigue como `NAME_MAX_LENGTH = 15` en `constants.ts`. Sin cambios.

### 2. Bundle de runtime: UN default genérico — CAMBIA (era catálogo de 2)

Antes: `registry.ts` importaba `shopinbaz.json` + `elektra.json` y exponía
`BUNDLED_BRANDS` (Record de 2) + `BRAND_KEYS`. **Ahora** el único bundle de
runtime es una marca genérica neutra.

**Ubicación del default:** `frontend/src/brand/data/default.json` (se mantiene la
carpeta `data/` pero con un solo archivo). Alternativa considerada:
`seeds/default.json`; se **descarta** para separar conceptualmente lo que es
runtime (`data/default.json`, importado en el bundle) de lo que es seed-para-S3
(`seeds/*.json`, NO importado en runtime). Ver §Ubicación de archivos.

`frontend/src/brand/registry.ts` (nueva forma):

```ts
import { parseBrandConfig, type BrandConfig, type BrandKey } from './schema';
import defaultRaw from './data/default.json';

/** Key de la marca genérica de fallback. En prod, si el subdominio no resuelve
 *  a un JSON en S3, o en dev sin ?brand= ni VITE_DEFAULT_BRAND, se usa esta. */
export const DEFAULT_BRAND_KEY: BrandKey = 'default';

/** ÚNICA marca bundleada en runtime: fallback offline neutro. Añadir una marca
 *  NO se hace aquí, sino subiendo un <key>.json a S3 (cero código). */
export const DEFAULT_BRAND: BrandConfig = parseBrandConfig(defaultRaw);
```

Se **eliminan** `BUNDLED_BRANDS` y `BRAND_KEYS`.

**Contenido de `data/default.json` (marca neutra, sin identidad de terceros):**

```json
{
  "key": "default",
  "name": "Marca",
  "text": {
    "title": "¡Te damos la bienvenida!",
    "subtitle": "Usa tu préstamo como dinero en efectivo o compra en donde quieras.",
    "namePrompt": "¿Cómo prefieres que te llamemos?",
    "inputPlaceholder": "Escribe tu nombre",
    "submitLabel": "Comenzar",
    "counterTemplate": "{count}/{max} caracteres"
  },
  "colors": {
    "bg": "23 22 26",
    "surface": "38 36 43",
    "primary": "124 92 252",
    "accent": "124 92 252",
    "text": "245 245 247",
    "muted": "148 143 156"
  },
  "style": {
    "radius": "0.75rem",
    "fontFamily": "system-ui, sans-serif",
    "titleWeight": "700",
    "buttonVariant": "soft"
  },
  "assets": {
    "logo": "/brands/default/logo.svg",
    "illustration": "/brands/default/illustration.svg",
    "logoAlt": "Marca",
    "illustrationAlt": "Ilustración de bienvenida"
  }
}
```

Racional del contenido: colores base del schema (fondo casi negro, texto claro),
acento un violeta neutro `124 92 252` (ni el morado exacto de shopinbaz ni el
rojo de elektra — es una marca genérica, no una copia de un cliente), textos
sin nombre de cliente ("¡Te damos la bienvenida!", "Marca"), assets bajo
`/brands/default/`. Cumple `brandConfigSchema` al 100%.

### 3. Las 2 marcas de ejemplo → SEEDS (no runtime) — CAMBIA

Antes vivían en `data/` e importadas por el registry. **Ahora** son **seeds**:
los JSON que el deploy subirá a S3 y que los tests usan como fixtures. **No** se
importan en runtime.

**Ubicación recomendada:** `frontend/src/brand/seeds/shopinbaz.json` y
`frontend/src/brand/seeds/elektra.json`.

Justificación de `seeds/` bajo `src/brand/` (vs. `frontend/brands-seed/` en la
raíz): así los **tests** (que viven en `src/brand/*.test.ts`) importan los seeds
con una ruta relativa corta (`./seeds/elektra.json`) sin cruzar fuera de `src`,
y el bundler no los incluye en el bundle salvo que alguien los importe (los
tests sí, el runtime no). El script de deploy (feature `deploy`) los lee de esta
carpeta y los sube a S3. Ver §Ubicación de archivos.

**Contenido:** los `shopinbaz.json` y `elektra.json` **actuales** (los de
`data/`) se mueven **sin cambios de contenido** a `seeds/`. Sus colores y textos
ya están derivados de las maquetas (shopinbaz morado `170 59 255`; elektra rojo
`242 74 45` + naranja `247 132 40`). El `mv` es literal; no se re-editan valores.

> Los seeds **no** pasan por el registry ni por ningún import de runtime. El
> único que los consume es (a) el test multi-marca como fixture y (b) el script
> de deploy. Añadir una marca nueva = añadir un seed y subirlo a S3; cero
> cambios en `registry.ts` ni en componentes.

### 4. Mecanismo de carga y selección — CAMBIA (sin catálogo)

Módulos (todos bajo `frontend/src/brand/`):

| Archivo | Función/export | Responsabilidad | ¿Cambia? |
|---|---|---|---|
| `schema.ts` | `brandConfigSchema`, `parseBrandConfig`, `BrandConfig`, `BrandKey` | validación + defaults | ✅ quita enum, `BrandKey=string` |
| `registry.ts` | `DEFAULT_BRAND`, `DEFAULT_BRAND_KEY` | único default de runtime | ✅ 1 default, sin catálogo |
| `resolveBrand.ts` | `resolveBrand(env): BrandKey` | qué marca toca según entorno | ✅ sin validar catálogo |
| `loadBrand.ts` | `loadBrand(key): Promise<BrandConfig>` | fetch S3 + Zod + fallback default | ✅ fallback = DEFAULT_BRAND |
| `constants.ts` | `NAME_MAX_LENGTH`, `S3_BASE_URL` | constantes compartidas | ⬜ igual |
| `applyBrandToDom.ts` | `applyBrandToDom(config)` | escribe `--brand-*` en `:root` | ⬜ igual |
| `ThemeProvider.tsx` | `<ThemeProvider config>`, `useBrand()` | expone config + inyecta al DOM | ✅ recibe config, no brand |

**`resolveBrand(input)` — CAMBIA: ya no valida contra catálogo.**

Firma igual (`ResolveBrandInput`: `hostname`, `search`, `isDev`, `defaultBrand?`).
Nueva lógica:

```ts
export function resolveBrand(input: ResolveBrandInput): BrandKey {
  const { hostname, search, isDev, defaultBrand } = input;

  if (!isDev) {
    // Prod: el subdominio TAL CUAL es la key. S3 dirá si <key>.json existe;
    // si no, loadBrand cae al default. NO se filtra contra ninguna lista.
    return hostname.split('.')[0];
  }

  // Dev/tests: ?brand= > VITE_DEFAULT_BRAND > 'default'. Sin catálogo.
  const queryBrand = new URLSearchParams(search).get('brand');
  return queryBrand || defaultBrand || DEFAULT_BRAND_KEY;
}
```

- Se **elimina** `asBrandKey` y el import de `BRAND_KEYS`.
- Prod: `elektra.garcia3apps.com` → `'elektra'`. `garcia3apps.com` → `'garcia3apps'`
  (subdominio tal cual; S3 no tendrá `garcia3apps.json` → `loadBrand` cae al
  default). `www.x.com` → `'www'` (idem). Esto es **intencional** por la
  decisión: prod delega en S3, no en una lista.
- Dev: `?brand=elektra` → `'elektra'` (aunque no sea "catálogo", loadBrand lo
  resolverá desde seed en test o S3 en prod). Sin `?brand=` ni env → `'default'`.
- Sigue siendo función pura, deps inyectadas, **nunca lanza**, **siempre**
  devuelve un `string` no vacío (garantía: `hostname.split('.')[0]` de un
  hostname no vacío es no vacío; en dev el `|| DEFAULT_BRAND_KEY` cierra el caso).

> Edge case a cubrir en test: `hostname === ''` en prod → `''.split('.')[0]` es
> `''` (string vacío). El implementer debe hacer que resolveBrand devuelva
> `DEFAULT_BRAND_KEY` si el primer label sale vacío (guardar: `subdomain ||
> DEFAULT_BRAND_KEY`). Documentado como criterio de aceptación abajo.

**`loadBrand(key)` — CAMBIA: fallback = DEFAULT_BRAND, key abierta.**

```ts
export async function loadBrand(
  key: BrandKey,                                  // string abierto
  deps: { fetchFn?: typeof fetch; s3BaseUrl?: string; isDev?: boolean } = {},
): Promise<BrandConfig>
```

Flujo nuevo:

1. En dev/tests (o si no hay `s3BaseUrl`) → devuelve **`DEFAULT_BRAND`**
   directamente (cero red). *(Antes devolvía `BUNDLED_BRANDS[key]`; ya no hay
   catálogo del que sacar una marca concreta offline. En dev, ver la nota de
   abajo sobre cómo los tests inyectan seeds concretos.)*
2. En prod → `fetch(`${s3BaseUrl}/${key}.json`)` → `parseBrandConfig(await
   res.json())`. Cualquier fallo (`!res.ok`, rechazo de red/CORS, JSON inválido,
   error de Zod) → `catch`/guard → **`DEFAULT_BRAND`**.

Se **elimina** `bundledFor(key)`; el fallback es siempre `DEFAULT_BRAND`.

> **Cómo cargan los tests una marca concreta (importante para el tester).** El
> test multi-marca NO usa `loadBrand` para obtener shopinbaz/elektra (loadBrand
> en modo test devuelve el default). En su lugar importa el **seed** y lo parsea:
> `parseBrandConfig(elektraSeed)`, y se lo pasa al Provider por prop. `loadBrand`
> se testea aparte para: (a) modo test/sin S3 → `DEFAULT_BRAND`; (b) fetch OK con
> `fetchFn` mock que resuelve un seed → esa config parseada; (c) los fallos →
> `DEFAULT_BRAND`.

Resultado: **la app nunca se rompe por config** (acceptance clave). Zod garantiza
que incluso un JSON parcial de S3 produce una `BrandConfig` completa.

**Orquestación — CAMBIA de sitio: fuera del Provider (`main.tsx`).**

Por la decisión 4, resolución+carga corren **antes** de montar el Provider:

```ts
// main.tsx (o un hook useBrandBootstrap)
const key = resolveBrand({
  hostname: window.location.hostname,
  search: window.location.search,
  isDev: import.meta.env.DEV,
  defaultBrand: import.meta.env.VITE_DEFAULT_BRAND,
});
const config = await loadBrand(key, { isDev: import.meta.env.DEV });
// render: <ThemeProvider config={config}><App/></ThemeProvider>
```

`main.tsx` es de la integración final (welcome_screen/deploy); aquí basta con
que `resolveBrand` y `loadBrand` estén listos y testeados para consumirse así.

### 5. ThemeProvider + tokens — CAMBIA (recibe config, no brand)

Archivo: `frontend/src/brand/ThemeProvider.tsx`. Nueva firma:

```ts
interface ThemeProviderProps {
  /** Config de marca YA resuelta (por resolveBrand+loadBrand fuera del árbol). */
  config: BrandConfig;
  children: ReactNode;
}

export function ThemeProvider({ config, children }: ThemeProviderProps) {
  useEffect(() => { applyBrandToDom(config); }, [config]);
  return <BrandContext.Provider value={config}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandConfig { /* igual: Context, throw si null */ }
```

Cambios respecto a Rev. 1 / código actual:

- Prop `brand: BrandKey` → `config: BrandConfig`.
- Se **elimina** el `import { BUNDLED_BRANDS }` y el `useMemo(() =>
  BUNDLED_BRANDS[brand])`. El Provider ya no conoce el registry.
- El Provider es **síncrono**: no hay estado de carga, no hace fetch. Recibe la
  config lista.
- `applyBrandToDom(config)` en `useEffect([config])` → cambiar la config
  re-inyecta las CSS vars **sin recargar** (acceptance). `useBrand()` sin cambios.

`applyBrandToDom.ts` **no cambia** (escribe `--brand-*` en
`document.documentElement.style`). Tabla de CSS vars idéntica a Rev. 1
(`--brand-bg/surface/primary/accent/text/muted` + `--brand-radius/font/title-weight`).

**Tokens de marca** (los componentes SOLO usan estas clases, cero hex) — idéntico
a Rev. 1:

| Token Tailwind | CSS var | Uso en maqueta |
|---|---|---|
| `bg-brand-bg` | `--brand-bg` | fondo de pantalla |
| `bg-brand-surface` | `--brand-surface` | input / botón |
| `text-brand-primary` / `bg-brand-primary` | `--brand-primary` | título con color de marca, foco |
| `text-brand-accent` / `bg-brand-accent` | `--brand-accent` | acento secundario (elektra naranja) |
| `text-brand-text` | `--brand-text` | subtítulo, texto de input |
| `text-brand-muted` | `--brand-muted` | pregunta, placeholder, contador |
| `rounded-[var(--brand-radius)]` | `--brand-radius` | radio de input/botón |
| `font-[var(--brand-font)]` | `--brand-font` | tipografía de marca |

---

## Ubicación de archivos (resumen)

```
frontend/src/brand/
├── schema.ts              # (edit) quita enum, BrandKey = string
├── registry.ts           # (edit) DEFAULT_BRAND + DEFAULT_BRAND_KEY, sin catálogo
├── resolveBrand.ts       # (edit) subdominio tal cual / dev sin catálogo
├── loadBrand.ts          # (edit) fallback = DEFAULT_BRAND, key: string
├── ThemeProvider.tsx     # (edit) prop config: BrandConfig
├── applyBrandToDom.ts    # (sin cambios)
├── constants.ts          # (sin cambios)
├── data/
│   └── default.json      # (nuevo) marca genérica neutra — ÚNICO import de runtime
└── seeds/                # (nuevo) NO importado en runtime
    ├── shopinbaz.json    # (mv desde data/) seed para S3 + fixture de test
    └── elektra.json      # (mv desde data/) seed para S3 + fixture de test
```

Los `data/shopinbaz.json` y `data/elektra.json` **actuales** se **mueven** a
`seeds/`. `data/` queda solo con `default.json`.

---

## Nota de neutralidad de defaults (schema.ts)

Los `.default()` internos del schema hoy contienen textos de shopinbaz. No es un
bloqueante de esta feature, pero para coherencia con "marca genérica" se
**recomienda** (no obliga) alinear los defaults del schema con `default.json`
(`title` → "¡Te damos la bienvenida!", `name`/`key` → genéricos, `primary` →
`124 92 252`). Si el implementer los deja como están, ningún test de esta feature
falla (los tests de schema comprueban *que existen* defaults, no su literal
exacto — ver acceptance #1 abajo, redactado para no depender de la cadena
concreta). Marcado como recomendación, no requisito.

---

## Tokens y textos de marca (derivados de las maquetas)

Sin cambios respecto a Rev. 1. La comparación shopinbaz vs elektra (logo,
ilustración, acento morado vs rojo/naranja, mismos textos salvo `title`) sigue
vigente y ahora vive en los **seeds**. El límite 15 sigue siendo constante
(`NAME_MAX_LENGTH`), no config; la config aporta la plantilla `{count}/{max}`.

---

## Mapeo de acceptance reinterpretados (para el tester)

Dos acceptance de `feature_list.json` mencionan el modelo viejo. Traducción a la
luz de la decisión (reinterpretables, NO contradicciones insalvables):

- **Acceptance #4** — *"…en dev/tests ?brand= (solo dev) > VITE_DEFAULT_BRAND >
  **primera marca**…"*. Reinterpretación: "primera marca" era el primer elemento
  de `BRAND_KEYS`, que ya no existe. **Se mapea a `DEFAULT_BRAND_KEY = 'default'`**
  (el último fallback en dev). El comportamiento observable (último recurso
  determinista cuando no hay `?brand=` ni env) se conserva; solo cambia cuál es
  ese fallback: de `'shopinbaz'` a `'default'`.

- **Acceptance #5** — *"Al menos 2 marcas de ejemplo (shopinbaz morado, elektra
  rojo/naranja…), **bundleadas como fallback**"*. Reinterpretación: el fallback
  offline ahora es **1 default genérico** (`DEFAULT_BRAND`), no 2 marcas. Las 2
  marcas de ejemplo **siguen existiendo** en el repo, pero como **seeds**
  (`seeds/shopinbaz.json`, `seeds/elektra.json`) para S3 y como fixtures de test,
  **no** como fallback importado en runtime. El espíritu del acceptance ("hay 2
  marcas de ejemplo distinguibles, morada y roja/naranja, y hay un fallback que
  evita romper la app") se cumple: 2 seeds distinguibles + 1 default de fallback.

> **Nota para el leader (posible contradicción literal, NO insalvable).** El
> texto literal de acceptance #5 dice "2 marcas … bundleadas como fallback". Con
> la decisión, el *fallback* es 1 (default) y las *2 marcas* son seeds, no
> fallback. Es una **reinterpretación**, no un imposible: el diseño entrega 2
> marcas de ejemplo + un fallback robusto. **No requiere elevar al usuario**
> porque la decisión de `CLAUDE.md` ya autoriza explícitamente este cambio
> ("shopinbaz/elektra pasan a ser seeds … el único bundle de runtime es un
> default.json genérico"). Se documenta aquí solo para que el tester escriba el
> test de #5 contra *seeds + default*, no contra un catálogo de 2. No hay ningún
> acceptance que quede en contradicción **insalvable** con la decisión.

---

## Alternativas consideradas

> `requires_approval: true` → se mantienen las alternativas. A/B siguen igual que
> Rev. 1 (A1 canales RGB, B1 CSS vars); C se actualiza porque la decisión ya
> fijó "resolución fuera del Provider". Se añade D (ubicación de seeds) y E
> (nombre del default).

### A. Formato de colores en el JSON: canales "R G B" vs hex — sin cambios

- **A1 — canales "R G B" (recomendada).** Encaja 1:1 con los tokens `@theme` ya
  existentes (`rgb(var(--brand-primary) / <alpha-value>)`), soporta opacidad
  Tailwind sin conversión. Contra: menos legible que hex.
- **A2 — hex + conversión en el loader.** Más legible; contra: función hex→rgb
  (superficie de bug) y desalinea de `index.css`.
- **Recomendación: A1.**

### B. Estilos NO-color (radius/fuente/peso): CSS vars vs data-attrs — sin cambios

- **B1 — CSS vars `--brand-*` junto a los colores (recomendada).** Un único
  `applyBrandToDom`; componentes con `rounded-[var(--brand-radius)]`.
- **B2 — `data-brand` + reglas CSS por marca.** Contra: reintroduce CSS por marca
  (añadir marca ≈ tocar CSS), rompe "añadir marca = subir JSON".
- **B3 — clases condicionales en el componente.** Contra: lógica de estilo en JSX.
- **Recomendación: B1.**

### C. Punto de resolución/carga — ACTUALIZADA por la decisión

- **C1 (Rev. 1) — resolver+cargar dentro del Provider con estado.** Ya **no
  aplica**: la decisión 4 fija que el Provider recibe la config resuelta por prop
  y es síncrono. Se descarta por mandato.
- **C2 — resolver+cargar en `main.tsx`, Provider síncrono por prop (elegida por
  decisión).** Ventaja: Provider trivialmente testeable (síncrono, sin red, sin
  catálogo); el test multi-marca inyecta seeds directos; separa I/O (resolve+load)
  de presentación (Provider). "Cambiar de marca sin recargar" se cubre igual:
  cambiar la prop `config` re-dispara `applyBrandToDom`. Contra: `main.tsx` debe
  `await loadBrand` antes de montar (o montar con `DEFAULT_BRAND` y refinar) —
  detalle de la integración (welcome_screen), no de esta feature.
- **Recomendación: C2 (impuesta por la decisión, y además la más limpia para
  testear).**

### D. Ubicación de los seeds — nueva

- **D1 — `frontend/src/brand/seeds/` (recomendada).** Ruta relativa corta para
  los tests (`./seeds/elektra.json`), dentro de `src` (sin cruzar fuera), no se
  bundlea salvo import explícito (solo los tests importan). El deploy los lee de
  aquí.
- **D2 — `frontend/brands-seed/` en la raíz del paquete.** Separa "datos de
  deploy" del código; contra: import de test cruza fuera de `src` (rutas
  `../../../brands-seed/…`) y requiere config extra de Vitest/tsconfig para
  resolver JSON fuera de `src`.
- **Recomendación: D1.**

### E. Nombre/ubicación del default de runtime — nueva

- **E1 — `DEFAULT_BRAND` (const) desde `data/default.json` (recomendada).**
  Nombre explícito, `data/` separado de `seeds/` deja claro qué es runtime.
- **E2 — `defaultBrand` en `seeds/default.json`.** Mezcla el fallback de runtime
  con los seeds de S3; menos claro qué se importa en el bundle.
- **Recomendación: E1** (`DEFAULT_BRAND` + `DEFAULT_BRAND_KEY = 'default'`).

---

## Riesgos

- **Subdominio "tal cual" en prod puede pedir keys inesperadas a S3.** `www.`,
  apex, o un typo generan `www.json`/`garcia3apps.json` inexistentes → 404 →
  default. Es el comportamiento deseado (S3 manda), pero conviene que el test
  cubra explícitamente "key inexistente → default" para documentarlo. Riesgo
  bajo: nunca rompe la app.
- **Hostname vacío / sin puntos.** `''` o `localhost` en prod → primer label
  raro. Mitigado con el guard `subdomain || DEFAULT_BRAND_KEY` (ver §resolveBrand
  y criterio de aceptación #4).
- **Pérdida del fallback por marca concreta offline.** Antes, sin red,
  `loadBrand('elektra')` daba elektra bundleada; ahora da el default genérico.
  Es intencional (solo hay 1 bundle), pero implica que **en dev sin S3 la app se
  ve con la marca genérica**, no con shopinbaz/elektra, salvo que el test/dev
  inyecte un seed. Documentado para que nadie lo lea como bug.
- **`data/` vs `seeds/` mal separados.** Si el implementer deja seeds en `data/`
  o importa un seed en `registry.ts`, se reintroduce el catálogo cerrado y se
  rompe la decisión. El review debe verificar que `registry.ts` importa **solo**
  `data/default.json` y **nada** de `seeds/`.
- **Defaults del schema con textos de shopinbaz.** Cosmético; si molesta al
  evaluador ver "shopinbaz" como default genérico, alinear con `default.json`
  (§Nota de neutralidad). No rompe tests.

---

## Criterios de aceptación traducibles a tests (para reescribir RED)

Mapeo 1:1 con los `acceptance`, reinterpretados por la decisión. Cada línea es un
test RED. **Los tests que cambian respecto a Rev. 1 van marcados `[CAMBIA]`.**

1. **Schema con defaults por campo** (igual salvo no depender del literal) →
   - `parseBrandConfig({})` devuelve objeto con `text.title`, `colors.primary`,
     `style.radius`, `assets.logo` **definidos** (== defaults del schema). No
     asserar la cadena exacta del título (para no acoplarse a shopinbaz/genérico).
   - `parseBrandConfig(undefined)` no lanza y devuelve config completa.
   - `colors.primary: "morado"` (formato inválido) hace fallar
     `brandConfigSchema.parse` (regex rechaza).
   - **[CAMBIA]** `brandKeySchema` **ya no se exporta**: un test/typecheck de que
     `BrandKey` es asignable desde cualquier `string` (p.ej. `const k: BrandKey =
     'cualquier-marca'` compila). Confirmar que NO hay `z.enum` de keys en
     `schema.ts`.

2. **Carga con fallback** →
   - **[CAMBIA]** `loadBrand('elektra')` en modo test (sin `s3BaseUrl` / `isDev:
     true`) resuelve a **`DEFAULT_BRAND`** (ya NO a una elektra bundleada) sin
     llamar a `fetch`.
   - Con `fetchFn` mock que resuelve un JSON válido (p.ej. el seed de elektra) y
     `s3BaseUrl` presente + `isDev:false` → `loadBrand` devuelve esa config
     parseada (== `parseBrandConfig(elektraSeed)`).

3. **JSON parcial usable / fetch fallido → default** →
   - `parseBrandConfig({ text: { title: 'X' } })` → `title === 'X'` y el resto con
     defaults (marca usable).
   - **[CAMBIA]** `loadBrand('shopinbaz', { fetchFn: () => Promise.reject(...),
     s3BaseUrl, isDev:false })` → **`DEFAULT_BRAND`** (no lanza).
   - **[CAMBIA]** `fetchFn` con `res.ok === false` (404) → **`DEFAULT_BRAND`**.
   - **[CAMBIA]** `fetchFn` con JSON malformado / que falla Zod → **`DEFAULT_BRAND`**.

4. **Selección por entorno** (input mockeado) →
   - **[CAMBIA]** Prod, `hostname: 'elektra.garcia3apps.com'` → `'elektra'`
     (subdominio tal cual; sin filtrar contra catálogo).
   - **[CAMBIA]** Prod, `hostname: 'garcia3apps.com'` (apex) → `'garcia3apps'`
     (subdominio tal cual; NO `'default'`). *(Es loadBrand quien luego cae al
     default al no encontrar `garcia3apps.json`.)*
   - **[CAMBIA]** Prod, `hostname: ''` (vacío) → `DEFAULT_BRAND_KEY` (`'default'`)
     por el guard.
   - Prod, `search: '?brand=elektra'`, `hostname: 'shopinbaz.x.com'` → `?brand=`
     IGNORADO → `'shopinbaz'` (subdominio manda en prod).
   - Dev, `search: '?brand=elektra'` → `'elektra'` (solo dev).
   - Dev, sin `?brand=`, `defaultBrand: 'elektra'` → `'elektra'`.
   - **[CAMBIA]** Dev, sin `?brand=` ni `VITE_DEFAULT_BRAND` → `DEFAULT_BRAND_KEY`
     (`'default'`, no "primera marca del catálogo").
   - **[CAMBIA]** Dev, `?brand=marca-que-no-existe` → devuelve `'marca-que-no-existe'`
     tal cual (ya NO se descarta contra catálogo; loadBrand decidirá). El test
     debe reflejar el nuevo contrato: `resolveBrand` no filtra keys en dev.
   - `resolveBrand` nunca lanza y siempre devuelve un `string` no vacío.

5. **≥2 marcas de ejemplo (ahora seeds) + 1 default de fallback** →
   - **[CAMBIA]** Existen `seeds/shopinbaz.json` y `seeds/elektra.json`; al pasarlos
     por `parseBrandConfig`: `shopinbaz.colors.primary === '170 59 255'` (morado)
     y `elektra.colors.primary === '242 74 45'` (rojo). *(El test importa los
     seeds como fixtures, NO desde el registry.)*
   - **[CAMBIA]** `DEFAULT_BRAND` existe, valida, y es una marca **distinta** de
     shopinbaz y elektra (p.ej. `DEFAULT_BRAND.key === 'default'` y su `primary`
     no es ni el morado ni el rojo de las seeds).
   - **[CAMBIA]** `registry.ts` **no** exporta `BUNDLED_BRANDS` ni `BRAND_KEYS`
     (confirmar que el catálogo cerrado desapareció).

6. **ThemeProvider inyecta `--brand-*`; cero hex en componentes** →
   - Tras `applyBrandToDom(parseBrandConfig(elektraSeed))`,
     `documentElement.style.getPropertyValue('--brand-primary') === '242 74 45'`.
   - Aplicar shopinbaz y luego elektra → `--brand-primary` pasa de `170 59 255` a
     `242 74 45` (re-set sin recargar).
   - (Lint/estático) los componentes de UI no contienen `#` hex ni `rgb(` literal.

7. **Textos/ilustración desde config; cero literales** →
   - Un componente que consume `useBrand()` renderiza `text.title`,
     `text.submitLabel`, `text.inputPlaceholder`, y `src`/`alt` de
     `assets.logo`/`assets.illustration` de la config activa.

8. **Cambiar de marca no requiere editar componentes** →
   - **[CAMBIA]** El MISMO componente envuelto en `<ThemeProvider config={...}>`
     con la config de shopinbaz vs la de elektra (ambas desde seed parseado)
     produce salidas distintas sin tocar el componente. *(La parametrización es
     por prop `config`, ya no por `brand`.)*

9. **Render multi-marca** (test estrella) — **[CAMBIA]** →
   - `import shopinbazSeed from './seeds/shopinbaz.json'` y
     `import elektraSeed from './seeds/elektra.json'`; parsearlos con
     `parseBrandConfig`.
   - `<ThemeProvider config={parseBrandConfig(shopinbazSeed)}>` → aparece
     "¡Te damos la bienvenida a shopinbaz!", `--brand-primary === '170 59 255'`,
     `illustration` de shopinbaz.
   - `<ThemeProvider config={parseBrandConfig(elektraSeed)}>` → aparece
     "¡Te damos la bienvenida a Préstamo Elektra!", `--brand-primary === '242 74 45'`,
     `illustration` de elektra.
   - Ambos render usan el mismo componente/import; solo cambia la config inyectada
     por prop.

Notas para el tester:
- `resolveBrand` y `loadBrand` reciben deps inyectadas → NO tocar
  `import.meta`/`window` reales; pasar `hostname`/`search`/`isDev`/`defaultBrand`/
  `fetchFn`/`s3BaseUrl` como argumentos.
- El test multi-marca (#9) y el de "cambiar marca" (#8) obtienen shopinbaz/elektra
  **desde los seeds** (`./seeds/*.json` + `parseBrandConfig`), **no** desde
  `loadBrand` (que en modo test devuelve el default) ni desde el registry (que ya
  no tiene catálogo).
- El límite 15 se testea en `welcome_screen`, no aquí (aquí solo existe
  `NAME_MAX_LENGTH === 15` y la plantilla del contador).
- Los tests actuales (`registry.test.ts`, `resolveBrand.test.ts`,
  `loadBrand.test.ts`, `ThemeProvider.test.tsx`, `schema.test.ts`) referencian el
  modelo viejo (`BUNDLED_BRANDS`, `BRAND_KEYS`, `brand="..."`, enum) → deben
  **reescribirse** siguiendo los criterios `[CAMBIA]` de arriba (fase RED).

---

## Recomendación

Identidad de marca **abierta**: `schema.ts` sin enum (`BrandKey = string`),
`registry.ts` con un único `DEFAULT_BRAND` (desde `data/default.json`, marca
neutra) y `DEFAULT_BRAND_KEY = 'default'`, `resolveBrand.ts` que en prod devuelve
el subdominio tal cual (con guard a default si sale vacío) y en dev `?brand=` >
`VITE_DEFAULT_BRAND` > `'default'`, `loadBrand.ts` que siempre intenta S3 por key
`string` y cae a `DEFAULT_BRAND` ante cualquier fallo, `ThemeProvider.tsx` que
recibe `config: BrandConfig` por prop (síncrono) e inyecta vía `applyBrandToDom`
(sin cambios). Las 2 marcas de ejemplo pasan a `seeds/` (para S3 + fixtures de
test), fuera del runtime. Alternativas: A1 (canales RGB), B1 (CSS vars), C2
(resolución en `main.tsx`, impuesta por la decisión), D1 (seeds en
`src/brand/seeds/`), E1 (`DEFAULT_BRAND` desde `data/default.json`). Reutilizar
los tokens `@theme` de `index.css`. Límite 15 = constante, no config.
