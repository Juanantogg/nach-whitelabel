# Tests RED — welcome_screen

Fase **RED** de TDD. Tests escritos ANTES del código de producción, derivados de
los `acceptance` de `welcome_screen` en `feature_list.json` y del plan de testeo
de `progress/welcome_screen/design.md`. Todos fallan hoy por **ausencia del
código a implementar** (no por errores de setup ni imports triviales).

## Archivos de test creados / modificados

| Archivo | Objetivo a implementar (aún ausente) |
|---|---|
| `frontend/src/brand/core/schema.test.ts` (ampliado) | 5 campos de texto nuevos en `brandConfigSchema.text` |
| `frontend/src/features/welcome/NameField/NameField.test.tsx` | `NameField.tsx` (input controlado + contador + botón de voz) |
| `frontend/src/features/welcome/ResultView/ResultView.test.tsx` | `ResultView.tsx` (número descifrado + `resultLabel`) |
| `frontend/src/features/welcome/useNameSubmission.test.ts` | `useNameSubmission.ts` (orquesta el flujo) |
| `frontend/src/features/welcome/WelcomeScreen/WelcomeScreen.test.tsx` | `WelcomeScreen.tsx` (layout + estados + multi-marca) |
| `frontend/src/App.test.tsx` (actualizado post-GREEN) | `App.tsx` compone `<WelcomeScreen/>` bajo `ThemeProvider` (acceptance #7) |

> **Nota (post-GREEN):** `App.test.tsx`, el placeholder de Fase 0, afirmaba el
> título literal `nach-whitelabel` y montaba `<App/>` sin `ThemeProvider`. Quedó
> obsoleto porque `App` ahora compone `<WelcomeScreen/>`. Se reescribió para
> verificar el comportamiento real (acceptance #7): montado bajo el
> `ThemeProvider` con una marca, `App` muestra la pantalla de bienvenida con el
> título y el botón de envío desde la config de marca. Los hooks del borde
> (`useNameSubmission`, `useVoiceInput`) se mockean como en los tests de welcome.

## Mapa test → criterio de aceptación

### `schema.test.ts` — decisión aprobada #1 (textos de flujo)

Bloque nuevo `brandConfigSchema — textos de flujo de welcome_screen (decisión #1)`:

| Test | Verifica |
|---|---|
| un JSON sin esos textos produce una BrandConfig con los cinco campos completos y usables | `text.resultLabel`, `loadingLabel`, `errorGeneric`, `errorNetwork`, `retryLabel` existen con `.default()` no vacío |
| conserva valores parciales de esos textos y rellena el resto con los defaults del schema | JSON parcial respeta lo provisto y rellena el resto (mecanismo, no copy) |

Se prueba el MECANISMO (existencia + default + relleno de parcial), no el copy
exacto; la fuente de verdad del default es `parseBrandConfig({}).text`.

### `NameField.test.tsx` — acceptance #2 (límite/contador) + voz

Mapea a: "El input limita a 15 caracteres y muestra el contador '0/15 caracteres'".

- Contador inicial `0/15 caracteres` desde `counterTemplate` → **acceptance #2**.
- El contador interpola `{count}` con el largo actual → **acceptance #2**.
- Escribir texto propaga a `onChange` (input controlado).
- `maxLength=15` en el DOM → **acceptance #2** (defensa DOM).
- Dictado por voz con >15 chars se trunca a 15 → **acceptance #2** (borde: voz).
- Dictado por voz rellena el mismo estado que el input manual → integra `voice_capture`.
- Placeholder desde config (cero literal) → **acceptance #1**.
- Botón de voz con `aria-label` = `voice.startLabel` → **acceptance #1** + voz.
- Pulsar botón de voz llama a `start()`.
- Sin soporte de voz: degrada con elegancia, el input manual sigue presente.

Mock: `useVoiceInput` (borde = SpeechRecognition API). El límite/contador —la
lógica bajo prueba— NO se mockea.

### `ResultView.test.tsx` — acceptance #3 (número mostrado, estado success)

- Renderiza el número consecutivo recibido → **acceptance #3**.
- Acompaña el número con `text.resultLabel` (cero literal) → **acceptance #1 + #3**.

### `useNameSubmission.test.ts` — acceptance #3, #4, #5 (flujo end-to-end)

Orquestación aislada con `renderHook`. Mock del borde: `fetchPublicKey`,
`encryptName`, `apiFetch`, `decryptNumber` (respetando sus firmas reales).

Flujo feliz (**acceptance #3**):
- Estado inicial `idle`, sin número ni error.
- Encadena `fetchPublicKey → encryptName → apiFetch → decryptNumber` y expone el número.
- Respeta el **ORDEN** exacto del flujo.
- POST a `/names` con el payload EXACTO `{ encryptedKey, iv, ciphertext }`.
- Cachea el PEM: un segundo `submit` no re-pide la clave pública.

Loading (**acceptance #4**):
- Pasa a `loading` mientras el flujo está en vuelo y a `success` al resolver.

Errores (**acceptance #5**, sin filtrar detalle criptográfico):
- Red caída (`ApiError` status 0) → `error` con `errorKind === 'network'`.
- HTTP 422 → `error` genérico; `errorMessage` no expone `422`/`decrypt`.
- Fallo de `decryptNumber` → `error` genérico.
- `retry()` reejecuta el flujo y llega a `success` cuando el back se recupera.

### `WelcomeScreen.test.tsx` — acceptance #1, #3, #4, #5, #6 (integración UI)

Mock de `useNameSubmission` (conduce la máquina de estados) y `useVoiceInput`
(borde). NO se mockea el layout ni el consumo de la config de marca.

Layout desde config (**acceptance #1**, cero literales):
- título, subtítulo, pregunta, input (placeholder), botón "Comenzar", contador
  inicial `0/15 caracteres`, botón de voz (`aria-label`), ilustración con `alt`.

Envío / estado inicial (**acceptance #3**, #4):
- Botón "Comenzar" deshabilitado con nombre vacío.
- Escribir nombre + Comenzar → `submit(name)`.

Loading visible (**acceptance #4**):
- Botón de envío deshabilitado en `loading`.
- Muestra `text.loadingLabel`.

Success visible (**acceptance #3**):
- Muestra el número (`ResultView`) + `resultLabel`.

Error visible (**acceptance #5**):
- Red → `role="alert"` con `text.errorNetwork`.
- Genérico → `text.errorGeneric`.
- Botón "Reintentar" (`retryLabel`) que llama a `retry()`.

Render multi-marca (**acceptance #6**):
- El MISMO componente refleja título/ilustración/`--brand-primary` de shopinbaz y
  elektra (parametrizado por `it.each` con las seeds reales).
- ANCLA: shopinbaz morado `170 59 255` vs elektra rojo `242 74 45`, distintos.

> Nota: acceptance #7 (cableado de `main.tsx` con `ThemeProvider`) es integración
> a nivel de arranque, no unit-testeable de forma útil en jsdom (`main.tsx` está
> excluido de coverage). Se cubre por inspección del reviewer y por el smoke de
> arranque; no se le escribe test RED aquí para no forzar un mock de `createRoot`
> sin valor de regresión.

## Evidencia de RED

`pnpm --filter @nach/frontend test`:

```
Test Files  5 failed | 15 passed (20)
      Tests  2 failed | 94 passed (96)
```

- **`schema.test.ts`**: los 2 tests nuevos fallan por **assertion** (los campos
  `resultLabel`/`loadingLabel`/`errorGeneric`/`errorNetwork`/`retryLabel` aún no
  existen en el schema → `undefined`). RED real, el archivo carga.
  ```
  TypeError: Cannot read properties of undefined (reading 'length')
    ❯ src/brand/core/schema.test.ts:105  expect(config.text.resultLabel.length)...
  AssertionError: expected undefined to be 'Volver a intentar'
    ❯ src/brand/core/schema.test.ts:117  expect(config.text.retryLabel)...
  ```

- **`NameField` / `ResultView` / `useNameSubmission` / `WelcomeScreen`**: cada
  archivo falla porque su **módulo objetivo aún no existe** (los imports
  auxiliares —`ThemeProvider`, `parseBrandConfig`, seeds, `ApiError`— sí
  resuelven; el ÚNICO import roto es el del componente/hook a implementar):
  ```
  Failed to resolve import "./useNameSubmission" from ".../useNameSubmission.test.ts"
  Failed to resolve import "./ResultView"        from ".../ResultView.test.tsx"
  Failed to resolve import "./NameField"         from ".../NameField.test.tsx"
  Failed to resolve import "./WelcomeScreen"     from ".../WelcomeScreen.test.tsx"
  ```

Esto es RED por ausencia de código de producción, no por setup roto.

## Contrato que estos tests imponen al implementer (GREEN)

- **schema**: añadir a `text` con `.default()`: `resultLabel`, `loadingLabel`,
  `errorGeneric`, `errorNetwork`, `retryLabel`.
- **`NameField`** (controlado): props `{ value: string; onChange: (v: string) => void }`.
  Aplica tope de 15 (DOM `maxLength=15` + recorte en el handler y en el `onResult`
  de voz). Renderiza contador desde `counterTemplate` y botón de voz con
  `voice.startLabel` que llama a `start()`.
- **`ResultView`**: prop `{ numero: string }`; muestra el número + `text.resultLabel`.
- **`useNameSubmission()`**: devuelve
  `{ status: 'idle'|'loading'|'success'|'error'; numero: string|null; errorMessage: string|null; errorKind: 'network'|'generic'|null; submit: (name: string) => Promise<void>; retry: () => Promise<void> }`.
  Encadena `fetchPublicKey → encryptName → apiFetch('/names', POST) → decryptNumber`
  en ESE orden; POST con body `{ encryptedKey, iv, ciphertext }`; cachea el PEM;
  mapea `ApiError.status === 0` → `errorKind 'network'`, resto → `'generic'` sin
  filtrar detalle criptográfico.
- **`WelcomeScreen`**: dueño del estado del nombre; compone `NameField` +
  `ResultView` + estados de la máquina; botón submit deshabilitado con nombre
  vacío o en `loading`; error en `role="alert"` con reintento.
- Barriles `index.ts` por carpeta de componente (convención del repo).

---

## Ajuste loadBrand: cadena de fallback dev (Rev.3)

**Decisión aprobada por el humano (registrada en `CLAUDE.md`).** `loadBrand`
deja de devolver `DEFAULT_BRAND` a ciegas en dev. Ahora la resolución depende del
entorno:

- **Dev** (`isDev:true`): S3 por key → si falla → **seed bundleada** de esa key →
  si no hay seed → `DEFAULT_BRAND`.
- **Prod** (`isDev:false`): S3 por key → si falla → `DEFAULT_BRAND` (las seeds NO
  participan, aunque exista una para esa key).

"Fallo de S3" = rechazo de red/CORS, `!res.ok`/404, JSON malformado o error de Zod.

### Firma que estos tests IMPONEN al implementer

Se añade una dep opcional `seeds` a `LoadBrandDeps` (registro key → JSON crudo,
inyectable como se inyecta `fetchFn`). El valor por defecto en runtime es el
registro real de `seeds/*.json`. Solo se consulta en **dev** tras un fallo de S3.

```ts
interface LoadBrandDeps {
  fetchFn?: typeof fetch;
  s3BaseUrl?: string;
  isDev?: boolean;
  // Registro de seeds bundleadas: key -> JSON crudo (sin parsear). Por defecto,
  // el registro real de seeds/*.json. Consultado SOLO en dev tras fallo de S3.
  seeds?: Record<string, unknown>;
}
```

El implementer parsea la seed con `parseBrandConfig` (mismo camino de validación
que el JSON de S3); si la seed falta o no valida, cae a `DEFAULT_BRAND`.

### Marcadores distinguibles por fixture (`colors.primary`)

| Fixture | `colors.primary` | `key` |
|---|---|---|
| elektra   | `242 74 45`  | `elektra`   |
| shopinbaz | `170 59 255` | `shopinbaz` |
| default   | `124 92 252` | `default`   |

Cada caso cruza key pedida ≠ payload de S3 ≠ seed para que el color delate de
qué fuente vino la config (S3 vs seed vs default).

### Mapeo caso → comportamiento (`frontend/src/brand/core/loadBrand.test.ts`)

| Caso (nombre del test) | Entrada | Resultado esperado | ¿RED hoy? |
|---|---|---|---|
| caso 1 — dev + S3 OK | `isDev:true`, key `elektra`, S3 devuelve shopinbaz | usa S3 (`170 59 255`); fetch llamado 1× a `.../elektra.json` | **Sí** (hoy no llama a fetch) |
| caso 2a — dev + S3 rechazado + seed existe | `isDev:true`, key `elektra`, fetch rechaza | seed elektra (`242 74 45`); fetch llamado 1× | **Sí** (hoy → default) |
| caso 2b — dev + S3 404 + seed existe | `isDev:true`, key `shopinbaz`, 404 | seed shopinbaz (`170 59 255`) | **Sí** (hoy → default) |
| caso 2c — dev + S3 JSON malformado + seed existe | `isDev:true`, key `elektra`, 200 con color inválido | seed elektra (`242 74 45`) | **Sí** (hoy → default) |
| caso 3 — dev + S3 falla + sin seed | `isDev:true`, key `banco_azteca` (sin seed), 404 | `DEFAULT_BRAND` (`124 92 252`) | No (ya daba default, pero blinda la rama sin seed) |
| caso 4 — prod + S3 OK | `isDev:false`, key `elektra`, S3 OK | usa S3 (`242 74 45`) | No (comportamiento conservado) |
| caso 5a — prod + S3 rechazado + seed existe | `isDev:false`, key `elektra`, rechaza | `DEFAULT` (`124 92 252`), NO la seed | No (verifica que prod ignora seeds) |
| caso 5b — prod + S3 404 + seed existe | `isDev:false`, key `shopinbaz`, 404 | `DEFAULT` | No |
| caso 5c — prod + JSON malformado | `isDev:false`, key `shopinbaz`, color inválido | `DEFAULT` | No |
| sin `s3BaseUrl` (prod) | `isDev:false`, `s3BaseUrl:''` | `DEFAULT`, sin llamar a fetch | No |

Los casos 3, 4, 5a-c y "sin s3BaseUrl" no fallan hoy: son la **cobertura de
regresión** del comportamiento que NO debe cambiar (prod intacto, prod ignora
seeds). El cambio real lo prueban los casos 1, 2a, 2b y 2c.

Nota de alcance: no hay caso "dev sin `s3BaseUrl`" porque sin bucket no hay S3
que intentar; el implementer decide ese borde (queda fuera de esta tanda para no
imponer una decisión ambigua vía test frágil).

### Evidencia de RED

`pnpm --filter @nach/frontend test run src/brand/core/loadBrand.test.ts`:

```
Test Files  1 failed (1)
     Tests  4 failed | 6 passed (10)
```

Los 4 fallos son los casos de dev (1, 2a, 2b, 2c) y son AssertionError de
comportamiento, NO errores de import/setup:

- caso 1: `expected "vi.fn()" to be called 1 times, but got 0 times` (dev no
  toca fetch hoy).
- caso 2a: `expected "vi.fn()" to be called 1 times, but got 0 times`.
- caso 2b: `expected '124 92 252' to be '170 59 255'` (cae al default, no a la
  seed shopinbaz).
- caso 2c: `expected '124 92 252' to be '242 74 45'` (cae al default, no a la
  seed elektra).

Rojo real: falla porque la cadena de fallback dev aún no existe.

---

## Bugfix RED — fondo blanco de la pantalla de bienvenida (2026-07-04)

### Bug

El fondo de `WelcomeScreen` se ve BLANCO (default del navegador) en vez del
color de marca oscuro. Causa: ningún elemento aplica el token de fondo de
marca `bg-brand-bg`, y ni `body` ni `#root` pintan fondo en `index.css`.

### Criterios de aceptación (fix en AMBOS sitios — defensa en profundidad)

1. El `<main>` de `WelcomeScreen` debe incluir la clase de token `bg-brand-bg`.
2. El fondo global debe estar pintado en `body` (o `#root`) usando la variable
   de marca `--brand-bg` (regla en `index.css` tipo
   `background: rgb(var(--brand-bg))`).

### Tests añadidos

Archivo: `frontend/src/features/welcome/WelcomeScreen/WelcomeScreen.test.tsx`

**Criterio #1 — token en el `<main>`** (assert de DOM con Testing Library):

```ts
describe('WelcomeScreen — fondo de marca (bug: fondo blanco)', () => {
  it('el <main> aplica el token de fondo de marca bg-brand-bg', () => {
    renderScreen();
    const main = screen.getByRole('main');
    expect(main).toHaveClass('bg-brand-bg');
  });
});
```

**Criterio #2 — fondo global en `index.css`** (assert sobre el archivo estático,
NO sobre el DOM: se evita acoplarse al pipeline de Tailwind en runtime, que en
jsdom no compila las utilidades). Se lee `src/index.css` desde `process.cwd()`
(raíz del paquete `@nach/frontend`, que es el cwd de Vitest):

```ts
describe('index.css — fondo global de marca (bug: fondo blanco)', () => {
  const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

  it('pinta el fondo global en body o #root usando rgb(var(--brand-bg))', () => {
    const rule =
      /(?:^|\s)(?:body|#root)\s*\{[^}]*background(?:-color)?\s*:[^;}]*rgb\(\s*var\(\s*--brand-bg\s*\)/is;
    expect(indexCss).toMatch(rule);
  });
});
```

La regex es tolerante: acepta `body` o `#root`, `background` o
`background-color`, espacios y el canal alfa opcional de Tailwind v4.

> Nota sobre el criterio #2: se evaluó como razonable de testear porque
> `index.css` es un archivo estático y la aserción es sobre su contenido, no
> sobre estilo computado (que jsdom no resuelve sin compilar Tailwind). No es
> frágil: no depende del orden de propiedades ni de valores concretos de color.

### Evidencia del RED

`pnpm --filter @nach/frontend exec vitest run src/features/welcome/WelcomeScreen/WelcomeScreen.test.tsx`

```
 Test Files  1 failed (1)
      Tests  2 failed | 18 passed (20)
```

Los 2 fallos son AssertionError de comportamiento (implementación ausente), NO
errores de import/setup. Los 18 tests previos siguen en verde:

- Criterio #1:
  ```
  Error: expect(element).toHaveClass("bg-brand-bg")
  Expected the element to have class:  bg-brand-bg
  Received:  mx-auto flex min-h-screen w-full max-w-sm flex-col items-center px-6 py-10 text-brand-text
  ```
  → el `<main>` NO tiene aún `bg-brand-bg`.

- Criterio #2:
  ```
  AssertionError: expected '@import \'tailwindcss\';…' to match
  /(?:^|\s)(?:body|#root)\s*\{[^}]*background(?:-color)?…/is
  ```
  → `index.css` NO tiene aún regla de fondo global con `rgb(var(--brand-bg))`.

---

## RED — Bug de theming: utilidades de color de marca inválidas (`<alpha-value>`)

**Fecha:** 2026-07-05
**Fase:** RED
**Criterio de aceptación mapeado:** #6 white-label — "los colores se consumen
vía tokens Tailwind (`bg-brand-primary`, `text-brand-primary`, …); cero hex en
componentes". No basta con que el token exista en `@theme`: la UTILIDAD que
Tailwind genera para ese token tiene que ser un color CSS **válido**, o el
navegador la descarta y la marca no se pinta.

### El bug (confirmado en runtime con Playwright)

En `frontend/src/index.css`, el bloque `@theme inline` define los tokens como:

```css
--color-brand-primary: rgb(var(--brand-primary) / <alpha-value>);
```

Tailwind v4 emite las utilidades (`.text-brand-primary`, `.bg-brand-primary`,
`.text-brand-muted`, …) con el literal `<alpha-value>` **sin sustituir**,
produciendo `color: rgb(var(--brand-primary) / <alpha-value>)`. Ese
`<alpha-value>` es un placeholder inválido: el navegador rechaza la declaración
entera y el color de marca no llega a la CSSOM. Consecuencia verificada en
`http://localhost:5173`: el `<h1>` con `text-brand-primary` hereda el color de
texto en vez de ser morado; el botón con `bg-brand-primary` queda con fondo
transparente. **Los colores de marca NO se aplican.**

### Por qué un test de render con Testing Library NO capturaría esto

Vitest + jsdom **no compilan Tailwind ni validan CSS real**. Se verificó que
`el.style.color = 'rgb(var(--brand-primary) / <alpha-value>)'` en jsdom NO
descarta el valor (lo almacena tal cual), a diferencia del navegador. Por tanto
un test de `render()` + `getComputedStyle` nunca vería el defecto.

### Test añadido (comportamiento, no solución)

**Ruta:** `frontend/src/brand/core/brandUtilitiesCss.test.ts`

Compila el `src/index.css` **real** con el pipeline programático de Tailwind v4
(`compile()` de `tailwindcss`, el mismo motor que `@tailwindcss/vite`),
resolviendo `@import 'tailwindcss'` contra el paquete instalado, con un set de
clases de prueba (una por token de color de marca, cubriendo `text-*` y `bg-*`).
Luego afirma sobre el **CSS generado**:

| Test | Qué valida |
|---|---|
| `genera una regla para cada utilidad…` | Guarda de cordura: la compilación funciona y las reglas existen (aísla "regla ausente" de "valor inválido"). **Pasa hoy.** |
| `NO deja el placeholder <alpha-value> sin sustituir…` | El CSS final no contiene el marcador inválido. **Falla hoy (RED).** |
| `text-brand-primary produce un color CSS válido…` | La declaración `color` de `.text-brand-primary` no tiene `<alpha-value>` y sigue usando `var(--brand-primary)` (theming en vivo por marca). **Falla hoy (RED).** |
| `bg-brand-primary produce un background-color CSS válido…` | Ídem para `background-color` de `.bg-brand-primary`. **Falla hoy (RED).** |
| `ninguna declaración de color/background de marca contiene un placeholder…` | Barre las 8 utilidades y lista las infractoras. **Falla hoy (RED).** |

La aserción es de **comportamiento** ("la utilidad brand produce un color
usable"), no de solución: no exige una técnica concreta de theming, solo que el
CSS emitido sea un color válido sin placeholders y que siga leyendo la CSS var
de marca. Cualquier arreglo correcto en `@theme inline` (p. ej. definir los
tokens como el canal RGB crudo que Tailwind resuelva bien) pondrá los tests en
verde.

### Evidencia del RED

`pnpm --filter @nach/frontend exec vitest run src/brand/core/brandUtilitiesCss.test.ts`

```
 FAIL  src/brand/core/brandUtilitiesCss.test.ts > … > la utilidad bg-brand-primary produce un background-color CSS válido, no un placeholder
AssertionError: expected 'rgb(var(--brand-primary) / <alpha-val…' not to contain '<alpha-value>'
Expected: "<alpha-value>"
Received: "rgb(var(--brand-primary) / <alpha-value>)"

 FAIL  src/brand/core/brandUtilitiesCss.test.ts > … > ninguna declaración de color/background de marca contiene un placeholder inválido
AssertionError: utilidades con placeholder inválido:
.text-brand-primary { color: rgb(var(--brand-primary) / <alpha-value>) }
.bg-brand-primary { background-color: rgb(var(--brand-primary) / <alpha-value>) }
.text-brand-accent { color: rgb(var(--brand-accent) / <alpha-value>) }
.bg-brand-accent { background-color: rgb(var(--brand-accent) / <alpha-value>) }
.text-brand-text { color: rgb(var(--brand-text) / <alpha-value>) }
.text-brand-muted { color: rgb(var(--brand-muted) / <alpha-value>) }
.bg-brand-bg { background-color: rgb(var(--brand-bg) / <alpha-value>) }
.bg-brand-surface { background-color: rgb(var(--brand-surface) / <alpha-value>) }

 Test Files  1 failed (1)
      Tests  4 failed | 1 passed (5)
```

Los 4 fallos son AssertionError de comportamiento (el CSS generado contiene el
placeholder inválido), NO errores de import/setup: el único test que pasa
confirma que la compilación de Tailwind y la extracción de reglas funcionan.
`eslint` y `tsc -b --noEmit` sobre el archivo pasan en limpio. **RED real
confirmado.** No se tocó código de producción (`index.css` intacto).

RED real confirmado: ambos fallan porque la implementación no existe.

---

## RED — fallback de assets rotos (degradación white-label)

**Fecha:** 2026-07-05
**Archivo:** `frontend/src/features/welcome/WelcomeScreen/WelcomeScreen.test.tsx`
(nuevo `describe` "WelcomeScreen — fallback de assets de marca rotos").

### Problema (verificado en navegador con Playwright)

Los dos `<img>` de `WelcomeScreen.tsx` (logo e ilustración) usan
`src={assets.logo}` / `src={assets.illustration}` de la config de marca **sin
manejo de error**. Las marcas remotas (elektra/shopinbaz apuntan a
`https://brands.garcia3apps.com/<key>/...svg`) dan 404/red/CORS y el navegador
pinta el **ícono roto** — degradación pobre para un producto white-label.

### Comportamiento deseado (contrato bajo prueba)

- Si el `<img>` de un asset de marca dispara `onError`, su `src` cae al asset
  **bundleado de la marca default** (`DEFAULT_BRAND.assets`, rutas
  `/brands/default/logo.svg` y `/brands/default/illustration.svg`, que existen
  en `public/`). El logo cae al logo de default; la ilustración a la de default.
- **Guarda anti-bucle:** el swap ocurre **como mucho una vez**. Si el src ya es
  el de default (o el fallback también falla), `onError` NO re-asigna → sin
  bucle infinito de errores.
- Sin cambios cuando el asset carga bien (default en local, o prod con bucket
  poblado).

### Tests y mapeo

| Test | Qué cubre | Criterio |
|---|---|---|
| ANCLA: DEFAULT_BRAND expone las rutas bundleadas de fallback | Fuente de verdad de las rutas; elektra remoto ≠ default | precondición |
| logo de marca falla → src cae al logo de default | Camino feliz del fallback del logo | fallback logo |
| ilustración de marca falla → src cae a la de default | Camino feliz del fallback de la ilustración | fallback ilustración |
| no re-entra si el src ya es el de default (guarda anti-bucle) | Borde: marca default, `error` sobre el src ya-default no reasigna (`setAttribute('src')` nunca se llama) | anti-bucle |
| dos errores seguidos sobre el logo dejan el src estable en default | Borde end-to-end: 2º `error` (el fallback "falla") no re-dispara swap | anti-bucle |

**Técnica:** `fireEvent.error(img)` de Testing Library simula el fallo de carga
(jsdom no carga imágenes reales). Se localizan los `<img>` por rol/nombre
(`logoAlt` / `illustrationAlt`). Las rutas de fallback se afirman contra
`DEFAULT_BRAND.assets` (import de `brand/core/registry`), sin strings sueltos.
Se reutiliza el helper `renderScreen(config)` y los mocks de `useNameSubmission`
/ `useVoiceInput` ya existentes.

### Evidencia del RED

`pnpm --filter @nach/frontend test -- --run WelcomeScreen -t "fallback de assets"`

```
FAIL … > cuando el logo de marca falla al cargar, su src cae al logo de default
Expected the element to have attribute: src="/brands/default/logo.svg"
Received:                               src="https://brands.garcia3apps.com/elektra/logo.svg"

FAIL … > cuando la ilustración de marca falla al cargar, su src cae a la ilustración de default
Expected the element to have attribute: src="/brands/default/illustration.svg"
Received:                               src="https://brands.garcia3apps.com/elektra/illustration.svg"

FAIL … > guarda anti-bucle end-to-end: dos errores seguidos … dejan el src estable en default
Expected the element to have attribute: src="/brands/default/logo.svg"
Received:                               src="https://brands.garcia3apps.com/elektra/logo.svg"

Tests  3 failed | 184 passed (187)
```

Los 3 fallos son **AssertionError de comportamiento**: sin `onError` en el
componente el `src` se queda en la ruta remota rota, que es exactamente la razón
correcta (código ausente), no un error de import/setup. Los 2 tests de guarda
(ANCLA de rutas y anti-bucle sobre la marca default) pasan hoy porque verifican
precondiciones y la **ausencia** de re-asignación, que sin implementación se
cumple trivialmente — quedan como red de seguridad para la fase GREEN. **RED
real confirmado.** No se tocó código de producción (`WelcomeScreen.tsx` intacto).
