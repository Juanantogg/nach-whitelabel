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
