# Design — welcome_screen

## Objetivo

Pantalla de bienvenida white-label (maquetas `docs/images/`) que integra las
piezas YA construidas sin reimplementarlas: captura el nombre (input manual +
dictado por voz), lo **cifra** con la pública del back, lo **envía**, recibe el
**número consecutivo cifrado**, lo **descifra** y lo **muestra**. Cero colores y
cero textos literales: todo vía tokens Tailwind `bg-brand-*` y textos de la
`BrandConfig`. Añadir una marca sigue siendo "subir un JSON", sin tocar un
componente.

Alcance: solo la capa de UI + orquestación del flujo. NO se toca cifrado,
contador, voz, capa API ni theming (todas `done`). SÍ se completa el cableado de
`main.tsx` (hoy monta `<App />` sin `ThemeProvider` ni marca resuelta).

---

## Layout desde maquetas (mapeo elemento → token/texto de marca)

Ambas maquetas son **la misma pantalla**; solo cambian logo, ilustración,
colores y el título. Jerarquía vertical, centrada, ancho de columna limitada:

| # | Elemento (maqueta) | Fuente (config de marca) | Color / token |
|---|---|---|---|
| 1 | Logo superior (elektra / shopinbaz) | `assets.logo` + `assets.logoAlt` | imagen; sin token de color |
| 2 | Ilustración (pareja saludando) | `assets.illustration` + `assets.illustrationAlt` | imagen por marca |
| 3 | Título ("¡Te damos la bienvenida a …!") | `text.title` | `text-brand-primary` |
| 4 | Subtítulo ("Usa tu préstamo…") | `text.subtitle` | `text-brand-muted` |
| 5 | Pregunta ("¿Cómo prefieres que te llamemos?") | `text.namePrompt` | `text-brand-muted` |
| 6 | Input (placeholder "Escribe tu nombre") | `text.inputPlaceholder` | `text-brand-text`, borde `border-brand-muted`, foco `border-brand-primary` |
| 6b | Botón de voz (dentro/junto al input) | `voice.startLabel` / `voice.listeningLabel` (aria-label) | icono `text-brand-primary` / activo `text-brand-accent` |
| 7 | Contador "0/15 caracteres" (bajo el input, derecha) | `text.counterTemplate` (`{count}`/`{max}`) | `text-brand-muted` |
| 8 | Botón "Comenzar" | `text.submitLabel` | fondo `bg-brand-primary`/`bg-brand-surface` según `style.buttonVariant`, texto legible |
| 9 | Fondo de pantalla | — | `bg-brand-bg` |

- Radio de esquinas de input/botón: variable `--brand-radius` (ya inyectada por
  `applyBrandToDom`). Peso del título: `--brand-title-weight`. Fuente:
  `--brand-font`. Nada de esto se hardcodea en el componente.
- El botón de voz de la maqueta no aparece explícito en las capturas (input con
  línea inferior); se ubica como icono al final del input. Es requisito del
  enunciado ("dictado por voz"), así que existe; su etiqueta accesible sale de
  `voice.*`.

**Cobertura del schema de marca:** los textos 1–8 y las etiquetas de voz YA
existen en `brandConfigSchema` (`frontend/src/brand/core/schema.ts`) con
`.default()`. Ver "Riesgos / decisiones abiertas" para los textos que faltan
(resultado y errores de flujo).

---

## Árbol de componentes (convención repo: componente-por-carpeta PascalCase + barrel; hook fuera del componente)

```
frontend/src/
├─ features/
│  └─ welcome/
│     ├─ WelcomeScreen/
│     │  ├─ WelcomeScreen.tsx        # layout + composición; consume useBrand() y useNameSubmission()
│     │  ├─ WelcomeScreen.test.tsx   # (lo escribe el tester)
│     │  └─ index.ts                 # barrel
│     ├─ NameField/
│     │  ├─ NameField.tsx            # input controlado + contador {count}/{max} + botón de voz
│     │  ├─ NameField.test.tsx
│     │  └─ index.ts
│     ├─ ResultView/
│     │  ├─ ResultView.tsx           # muestra el consecutivo descifrado (estado success)
│     │  ├─ ResultView.test.tsx
│     │  └─ index.ts
│     └─ useNameSubmission.ts        # hook: orquesta el flujo de cifrado/envío/descifrado (fuera de los componentes)
└─ App.tsx                            # pasa a renderizar <WelcomeScreen /> (hoy es placeholder)
```

Notas de convención:
- `useNameSubmission` es un hook, vive **suelto** en `features/welcome/` (no
  dentro de una carpeta de componente), igual que `useVoiceInput` vive suelto en
  `voice/`.
- `NameField` encapsula input + contador + botón de voz; `useVoiceInput` se usa
  **dentro** de `NameField` (es donde vive el estado del texto) con
  `onResult` → set del nombre aplicando el límite de 15.
- Alternativa más plana (todo en `WelcomeScreen`) descrita en Alternativas; se
  recomienda la de arriba por testabilidad aislada del contador y del hook.
- Se ubica bajo `features/welcome/` (no `components/`) porque es una vista con
  lógica de negocio, no un primitivo reutilizable como `ErrorBoundary`. Si el
  reviewer prefiere `components/`, es un rename sin impacto de diseño.

---

## Contrato de integración (orden exacto y firmas reales)

Las firmas son las del repo HOY (no inventadas):

- `fetchPublicKey(deps?): Promise<string>` — `frontend/src/crypto/fetchPublicKey.ts`.
  Devuelve el PEM SPKI de la pública. Usa la capa `api` internamente.
- `encryptName(name, publicKeyPem): Promise<{ payload: EncryptedPayload; sessionKey: CryptoKey }>`
  — `frontend/src/crypto/encryptName.ts`. `EncryptedPayload = { encryptedKey, iv, ciphertext }` (base64).
- `apiFetch<T>(path, init?, deps?): Promise<T>` — `frontend/src/api/client.ts`.
  Para el POST: `apiFetch('/names', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })`.
- `decryptNumber({ iv, ciphertext }, sessionKey): Promise<string>` —
  `frontend/src/crypto/decryptNumber.ts`. Devuelve el número como string.

### Flujo (dentro de `useNameSubmission`)

```
1. Usuario escribe/dicta el nombre (≤15) y pulsa "Comenzar".
2. publicKeyPem = await fetchPublicKey()                 // GET /crypto/public-key
3. { payload, sessionKey } = await encryptName(name, publicKeyPem)
4. envelope = await apiFetch<{ iv, ciphertext }>('/names', { method:'POST', … body: payload })
5. numero  = await decryptNumber(envelope, sessionKey)   // AES-GCM con la misma sessionKey
6. render ResultView con `numero`.
```

- `fetchPublicKey` **no cachea** (lo dice su doc: "el cacheo, si hace falta, es
  de welcome_screen"). Decisión: **cachear el PEM en el hook** durante la vida de
  la pantalla (una `ref`/estado), para no repetir el GET en reintentos. Es
  cacheo en memoria de sesión, no persistente. Minimalista: sin lib.

### Estado de la pantalla → UI

Máquina de estados en `useNameSubmission`:

| Estado | Disparador | UI |
|---|---|---|
| `idle` | inicial | formulario habilitado; botón "Comenzar" activo solo si `name.length > 0` |
| `loading` | tras pulsar Comenzar (pasos 2–5) | botón deshabilitado + indicador; input bloqueado |
| `success` | paso 6 ok | `ResultView` con el número; formulario oculto o secundario |
| `error` | rechazo en cualquier paso | mensaje de error (texto de marca) + botón "Reintentar" que vuelve a `idle` conservando el nombre |

Mapeo de errores a mensaje (todos textos de marca — ver decisión abierta):
- `ApiError.status === 0` (red caída) → mensaje de "sin conexión".
- `ApiError.status >= 400` (incl. 400 `invalid_payload`, 422 `decryption_failed`,
  500) → mensaje genérico "no se pudo procesar, inténtalo de nuevo". No se
  distingue por status en la UI (el back devuelve códigos genéricos sin PII; la
  pantalla no expone detalle criptográfico, coherente con `seguridad.md`).
- Rechazo de `decryptNumber` (tag inválido) → mismo mensaje genérico.

---

## Contrato front↔back verificado (contra el backend real)

Verificado contra `backend/src/controllers/crypto.controller.ts`,
`routes/crypto.routes.ts`, `routes/names.routes.ts`, `app.ts`:

| Paso | Método + ruta | Request | Response OK | Errores |
|---|---|---|---|---|
| Clave | `GET /crypto/public-key` | — | `200 { publicKey, alg:'RSA-OAEP-256' }` | `500 { error:'public_key_unavailable' }` |
| Envío | `POST /names` | `{ encryptedKey, iv, ciphertext }` (base64) | `200 { iv, ciphertext }` (envelope de vuelta) | `400 invalid_payload`, `422 decryption_failed`, `500 crypto_unavailable`/`internal_error` |

Casan sin discrepancias con las piezas del front:
- `fetchPublicKey` lee `body.publicKey` → coincide con `{ publicKey, alg }`. ✅
- `encryptName` produce exactamente `{ encryptedKey, iv, ciphertext }` que
  `parsePayload` del back valida. ✅
- La respuesta 200 de `POST /names` es **directamente** `{ iv, ciphertext }`
  (no anidado bajo otra clave); `decryptNumber` espera justo `{ iv, ciphertext }`. ✅
- El límite de 15 se valida en el back tras descifrar; el front lo aplica antes
  de cifrar (defensa en profundidad, no exclusiva). ✅

**Nota (no bloqueante para welcome_screen): CORS.** En dev con proxy de Vite o
mismo origen no hay problema; en deploy real front↔back cross-origin, CORS lo
resuelve la feature `backend_hardening` (aún `pending`). El diseño del front no
cambia por ello. Se registra como riesgo, no como bloqueo.

---

## Estados de carga y error visibles (con textos de marca)

- **loading**: botón "Comenzar" deshabilitado, con spinner/label alterno; input
  read-only. El label alterno ("Procesando…") es texto de marca (falta en
  schema — ver decisión abierta; hasta entonces, default del schema).
- **error**: bloque `role="alert"` con el mensaje de marca correspondiente +
  botón "Reintentar" (texto de marca). No deja la pantalla en blanco (esto es
  error de flujo async, lo maneja el estado del componente, NO el ErrorBoundary,
  como documenta `ErrorBoundary.tsx`).
- **success**: `ResultView` muestra el número. El texto que acompaña ("Tu número
  es…") es de marca — ver decisión abierta.

---

## Límite de 15 caracteres + contador

- Constante común a todas las marcas: `MAX_NAME = 15` (comportamiento, no marca;
  espeja `MAX_NAME_LENGTH` del back). Vive en el front como const del feature, no
  en la config de marca.
- El input aplica el tope: `maxLength={15}` en el `<input>` + recorte defensivo
  en el handler `value.slice(0, 15)` (cubre el dictado por voz, que no pasa por
  `maxLength` del DOM). El `onResult` de `useVoiceInput` set-ea el nombre
  aplicando el mismo `slice(0,15)`.
- Contador renderizado desde `text.counterTemplate` (`"{count}/{max} caracteres"`)
  interpolando `count = name.length` y `max = 15`. Estado inicial → "0/15
  caracteres" como en las maquetas. La plantilla es de marca (permite traducir
  "caracteres"); los números son comportamiento.

---

## Plan de testeo (para el tester — RED antes que GREEN, no lo implemento)

**Integración del flujo (`WelcomeScreen` + `useNameSubmission`)**, con
`fetchPublicKey`/`apiFetch` mockeados (o `encryptName`/`decryptNumber` reales
sobre un par de claves de test tipo `crypto/__test__/backSideKit.ts` si se
quiere round-trip real):
- Feliz: escribir nombre → click Comenzar → se llama a `fetchPublicKey`, luego
  `encryptName`, luego POST `/names` con el payload cifrado, luego
  `decryptNumber`; se muestra el número. Verificar el **orden** de llamadas.
- El body del POST contiene exactamente `{ encryptedKey, iv, ciphertext }`.
- Estado `loading`: botón deshabilitado durante la promesa; se rehabilita al
  resolver.
- Error de red (`apiFetch` lanza `ApiError` status 0) → mensaje de sin conexión +
  botón Reintentar; reintentar reejecuta el flujo.
- Error HTTP (status 400/422/500) → mensaje genérico, sin filtrar detalle.
- Fallo de `decryptNumber` (rechaza) → mensaje genérico.

**Límite / contador (`NameField`)**:
- Escribir >15 caracteres: el valor se trunca a 15; el contador muestra "15/15".
- Estado inicial: contador "0/15 caracteres".
- Dictado por voz (`onResult` con string >15) → se trunca a 15.
- Botón Comenzar deshabilitado con nombre vacío.

**Voz (`NameField` con `useVoiceInput` mockeado)**:
- `onResult` rellena el mismo input que la escritura manual.
- Estado `unsupported`/`error` → botón de voz refleja no-soporte/error usando
  textos `voice.*` (degradación elegante; no rompe el formulario).

**Render multi-marca (`WelcomeScreen` bajo `ThemeProvider`)**:
- Con seed `elektra` vs `shopinbaz` (fixtures `frontend/src/brand/seeds/*.json`):
  el **mismo** componente renderiza título, logo/`alt`, ilustración distintos, y
  las CSS vars `--brand-primary` cambian (rojo/naranja vs morado). Ni un color ni
  un texto literal en el árbol renderizado.
- Test de "cero literales": el título mostrado proviene de `config.text.title`,
  no de una cadena en el JSX.

Herramientas: Vitest + Testing Library (ya en el repo). Web Crypto está
disponible en el entorno de test de Node ≥ para el round-trip real si se opta por
él; si no, mockear `encryptName`/`decryptNumber`.

---

## Riesgos / decisiones abiertas (requieren tu aprobación)

1. **Textos que faltan en `brandConfigSchema`** (la pantalla los necesita y hoy
   no existen). Propongo **añadirlos al schema con `.default()`** (marca nueva =
   JSON, se mantiene el principio), sin tocar componentes. Bloque propuesto
   `text` extendido:
   - `text.resultLabel` (ej. default "Tu número de registro es:") — acompaña al
     número en `ResultView`.
   - `text.loadingLabel` (ej. default "Procesando…") — label del botón en loading.
   - `text.errorGeneric` (ej. default "No pudimos procesarlo. Inténtalo de nuevo.")
   - `text.errorNetwork` (ej. default "Sin conexión. Revisa tu internet e inténtalo.")
   - `text.retryLabel` (ej. default "Reintentar").
   Estos textos NO están en las maquetas (las maquetas solo muestran el estado
   inicial), por eso los marco como decisión y no los invento en firme. **¿Los
   añado al schema con esos defaults, o prefieres otros literales?** Esto lo
   ejecuta el implementer de brand tras tu OK; el tester los da por existentes.

2. **Ubicación `features/welcome/` vs `components/`.** Recomiendo `features/`;
   si prefieres mantener todo bajo `components/`, es un rename sin impacto.

3. **Botón de voz en el layout.** Las maquetas no lo dibujan explícitamente
   (input con línea inferior). Lo coloco como icono al final del input. Si
   prefieres una fila/botón aparte, decisión de UI menor.

4. **CORS front↔back en deploy** — no bloquea welcome_screen (lo resuelve
   `backend_hardening`), pero se anota para no olvidarlo en el flujo end-to-end
   real.

---

## Alternativas consideradas

### A. Orquestación del flujo: hook `useNameSubmission` (recomendado) vs lógica inline en `WelcomeScreen`
- **Hook dedicado (recomendado):** aísla la máquina idle/loading/success/error y
  el encadenado cripto→API→cripto. Testeable con `renderHook`, mantiene el
  componente declarativo. Coste: un archivo más.
- **Inline en el componente:** menos archivos, pero mezcla orquestación async con
  render; tests de integración más pesados y menos foco. Descartada por
  testabilidad.

### B. Composición: `NameField`/`ResultView` separados (recomendado) vs un único `WelcomeScreen`
- **Separados (recomendado):** el contador y el límite se testean aislados en
  `NameField`; `ResultView` se testea sin montar el flujo. Alinea con la
  convención componente-por-carpeta.
- **Monolítico:** más simple de leer, pero los tests del contador arrastran todo
  el árbol. Descartada.

### C. Caché de la clave pública: en el hook (recomendado) vs sin caché vs módulo global
- **En el hook (recomendado):** una `ref` guarda el PEM tras el primer GET;
  reintentos no repiten la llamada. Vive y muere con la pantalla; sin estado
  global.
- **Sin caché:** cada reintento re-pide la clave (llamadas extra, más lento).
- **Módulo global:** caché entre montajes, pero introduce estado mutable global y
  complica los tests. Innecesario para una sola pantalla. Descartada.

---

## Recomendación

Construir `features/welcome/` con `WelcomeScreen` (layout, solo tokens/textos de
marca), `NameField` (input controlado + contador `counterTemplate` + botón de voz
vía `useVoiceInput`, límite 15 en DOM y en handler), `ResultView` (número
descifrado) y `useNameSubmission` (orquesta `fetchPublicKey → encryptName →
apiFetch('/names') → decryptNumber`, con caché de la pública en `ref` y máquina
idle/loading/success/error). Cablear `main.tsx` para resolver la marca
(`resolveBrand` + `loadBrand`) y envolver `<App/>` en `<ThemeProvider config>`.
Antes de arrancar el tester, aprobar la extensión del `brandConfigSchema` con los
textos de resultado/error (decisión abierta #1).

---

## Criterios de aceptación traducibles a tests

1. La pantalla renderiza título, subtítulo, pregunta, input (placeholder), botón
   de voz, contador y botón "Comenzar" **desde la config de marca** (cero
   literales, cero hex; colores vía `bg-brand-*`).
2. El input limita a 15 caracteres (DOM + handler) y el dictado por voz también
   se trunca a 15; el contador usa `text.counterTemplate` y muestra "0/15
   caracteres" en el estado inicial.
3. Flujo end-to-end: nombre → `fetchPublicKey` → `encryptName` →
   `POST /names` con `{ encryptedKey, iv, ciphertext }` → `decryptNumber` →
   número mostrado, en ese **orden**.
4. Estado `loading` visible: botón deshabilitado durante el flujo.
5. Estado `error` visible: mensaje (texto de marca) + Reintentar ante red caída,
   HTTP 4xx/5xx o fallo de descifrado; sin filtrar detalle criptográfico.
6. Render multi-marca: el mismo `WelcomeScreen` produce elektra (rojo/naranja,
   su logo/ilustración/título) y shopinbaz (morado, los suyos) sin editar el
   componente; las CSS vars `--brand-*` cambian entre marcas.
7. `main.tsx` monta `<ThemeProvider>` con la marca resuelta envolviendo `<App/>`
   (dentro del `ErrorBoundary` existente).
