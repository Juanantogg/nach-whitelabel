# Tests (RED) — voice_universal

Fase RED del ciclo TDD para el dictado universal (fallback a Whisper vía backend,
Groq `whisper-large-v3-turbo`). Deriva de `progress/voice_universal/design.md` §5
(plan de tests B1-B8, S1-S2, F1-F4, H1-H7, N1-N7, SC1). **Ningún código de
producción se ha escrito**: los tests fallan porque los módulos/símbolos que
ejercitan aún no existen. Todo mockeado — cero red ni API real de Groq.

## Archivos de test

| Archivo | Cubre | Criterios |
|---|---|---|
| `backend/src/routes/voice.routes.test.ts` | `POST /voice/transcribe` sobre `createApp()` (Supertest), service mockeado | B1-B7 |
| `backend/src/services/transcription.service.test.ts` | `transcribeAudio` unitario, SDK `groq-sdk` mockeado | S1-S2 |
| `frontend/src/api/transcribeVoice.test.ts` | `transcribeVoice(blob)` (capa de red del fallback), `fetch` mockeado | F1-F4 |
| `frontend/src/voice/useVoiceFallback.test.ts` | hook `useVoiceFallback` (captura + transcripción), `getUserMedia`/`MediaRecorder` mockeados, `transcribe` inyectado | H1-H7 |
| `frontend/src/features/welcome/NameField/NameField.fallback.test.tsx` | orquestación nativo↔fallback en `NameField` (ambos hooks mockeados) | N1-N7 |
| `frontend/src/brand/core/schema.test.ts` (bloque añadido) | `voice.transcribingLabel` en el schema de marca | SC1 |

Nota: el bloque `voice_universal` de `schema.test.ts` se AÑADIÓ al archivo
existente (no se tocó ni un test previo). El resto son archivos nuevos. No se
tocó `smoke.ts`: B8 (carga en runtime de `voice.routes`/`transcription.service`)
es tarea del implementer al dar el GREEN, según AGENTS.md; el tester solo lo deja
anotado aquí.

## Qué mapea cada test

### Backend — `voice.routes.test.ts` (B1-B7)

- **B1** audio webm válido + service→`'Ana'` → 200 `{ text: 'Ana' }`; el service
  se invoca 1 vez con `audio` (Buffer con los bytes subidos) y `mimeType`
  (`audio/webm…`).
- **B2** multipart SIN campo `audio` → 400 `invalid_payload`; service no invocado.
- **B3** MIME fuera de allowlist (`image/png`) → 400 `invalid_payload`; service no
  invocado.
- **B4** fichero de 3 MB (> `MAX_AUDIO_BYTES` = 2 MB) → 413 `audio_too_large`;
  service no invocado. Se sube un buffer sintético, no un audio real.
- **B5** service rechaza (error con "Groq 401 … api key") → 502
  `transcription_failed`; se afirma que el body **no filtra** detalle del
  proveedor (ni `groq`, ni `401`, ni la key).
- **B6** `GROQ_API_KEY` ausente (`''`) + audio válido → 500 `internal_error`;
  service no invocado (falla-cerrado antes de llamar al proveedor).
- **B7** el backend fija `language: 'es'` al invocar el service (aserción sobre el
  argumento del mock; el cliente no lo manda).

### Backend — `transcription.service.test.ts` (S1-S2)

- **S1** `transcribeAudio` llama al SDK con `model:'whisper-large-v3-turbo'`,
  `language:'es'` y un `file` construido desde el buffer; devuelve `text`.
- **S2** el SDK lanza → `transcribeAudio` propaga el error (el controller lo
  traduce a 502).
- El SDK `groq-sdk` se mockea con `vi.mock('groq-sdk', factory)` — la dep aún no
  está instalada/aprobada; el mock con factory intercepta el especificador sin
  necesidad de que exista en `node_modules`, así que el contrato se expresa sin
  depender de la dep. El RED viene del módulo de producción ausente.

### Frontend — `transcribeVoice.test.ts` (F1-F4)

- **F1** `POST /voice/transcribe` con `FormData` que contiene el campo `audio`;
  `fetch`→`{text:'Ana'}` → resuelve `'Ana'`. Se afirma URL, método POST, body
  `FormData` con `audio`.
- **F2** respuesta `!ok` (413 y 502) → rechaza con `ApiError` con ese status.
- **F3** `fetch` throw (red caída) → `ApiError` status 0.
- **F4** NO fija `Content-Type` manualmente (headers sin `Content-Type`) para que
  el navegador ponga el boundary del multipart.

### Frontend — `useVoiceFallback.test.ts` (H1-H7)

- **H1** `start()` → `getUserMedia({audio:true})` + recorder arranca; status
  `recording`, `isRecording` true.
- **H2** `stop()` → ensambla Blob, `transcribing`, llama a `transcribe(blob)`; al
  resolver `'Ana'` → `onResult('Ana')` y vuelve a `idle`.
- **H3** `getUserMedia` rechaza (permiso) → `errorCode:'permission-denied'`,
  status `error`; no se transcribe.
- **H4** `transcribe` rechaza con `ApiError(0)` → `errorCode:'network'`.
- **H5** `transcribe` resuelve `''` (silencio) → `errorCode:'no-audio'`, status
  `error`, y **NO** se propaga vacío a `onResult`.
  - Decisión del tester (design §5.4 lo deja abierto): se elige `'no-audio'` +
    `error` para que `NameField` reuse `voice.noSpeech` por el mismo canal que los
    demás errores, sin ensuciar el estado del nombre con `''`.
- **H6** auto-stop tras `MAX_RECORDING_MS` (timers falsos, avance 30 s) detiene la
  grabación y dispara la transcripción.
- **H7** cleanup en unmount libera los tracks del stream (`track.stop()`).
- Se mockea el borde: `navigator.mediaDevices.getUserMedia`, la clase
  `MediaRecorder` (jsdom no las trae) y `transcribe` inyectado. La máquina de
  estados bajo prueba no se mockea.

### Frontend — `NameField.fallback.test.tsx` (N1-N7)

Ambos hooks mockeados (`useVoiceInput` y `useVoiceFallback`).

- **N1** `isSupported:false` (Firefox) → pulsar el botón invoca `fallback.start`,
  NO `nativo.start`.
- **N2** `voiceUnavailable:true` (Brave) → igual, usa el fallback.
- **N3** nativo disponible → pulsar el botón usa `nativo.start`, NO el fallback
  (regresión: no se rompe el camino actual).
- **N4** `onResult` del fallback con 20 chars → `onChange` recibe exactamente 15
  (mismo `clampToMax`).
- **N5** fallback en `transcribing` → se muestra `voice.transcribingLabel` y el
  botón queda `aria-busy` — sin literales ni hex.
- **N6** errores del fallback → `voice.permissionDenied` / `voice.noSpeech` /
  `voice.genericError` en la región `role="status"`.
- **N7** input manual sigue funcionando (escribe con tope 15) con el fallback
  activo; el formulario no se rompe.
- N3, N7 (manual y textbox-presente) ya pasan hoy: son **regresiones** que
  protegen el comportamiento actual; los casos RED reales son N1/N2/N4/N5/N6.

### Frontend — `schema.test.ts` bloque `voice.transcribingLabel` (SC1)

- `parseBrandConfig({})` produce `voice.transcribingLabel` con un default no
  vacío; un JSON de marca que lo OMITE sigue válido (cae al default); una marca
  puede sobreescribirlo (white-label).

## Evidencia de RED (salida de `pnpm test` por paquete)

### Backend — `pnpm --filter @nach/backend test`

```
 ❯ src/services/transcription.service.test.ts (2 tests | 2 failed) 18ms
 ❯ src/routes/voice.routes.test.ts (7 tests | 7 failed) 291ms
 Test Files  2 failed | 8 passed (10)
      Tests  9 failed | 44 passed (53)
```

Razón del rojo (RED legítimo, código de producción ausente):

- `voice.routes.test.ts` → Express responde **404** (la ruta `/voice` aún no se
  monta en `app.ts`, no existen `voice.routes.ts`/`voice.controller.ts`), en vez
  de los 200/400/413/500/502 del contrato. El service mockeado nunca se invoca.
  Ej.: `expected 404 to be 200`, `expected 404 to be 502`.
- `transcription.service.test.ts` → `Cannot find module
  './transcription.service.js'` (el módulo de producción no existe). El mock de
  `groq-sdk` sí resuelve (factory), así que el fallo es por el módulo bajo
  prueba, no por la dep.

Los 44 tests previos del backend siguen **verdes** (sin regresiones).

### Frontend — `pnpm --filter @nach/frontend test`

```
 ❯ src/voice/useVoiceFallback.test.ts (0 test)
 ❯ src/api/transcribeVoice.test.ts (0 test)
 ❯ src/brand/core/schema.test.ts (14 tests | 2 failed) 13ms
 ❯ src/features/welcome/NameField/NameField.fallback.test.tsx (11 tests | 8 failed) 183ms
 Test Files  4 failed | 21 passed (25)
      Tests  10 failed | 226 passed (236)
```

Razón del rojo (RED legítimo):

- `transcribeVoice.test.ts` y `useVoiceFallback.test.ts` → fallo de COLECCIÓN
  (`Failed to resolve import "./transcribeVoice"` / `"./useVoiceFallback"`, "Does
  the file exist?"): sus módulos de producción no existen. Son 4 files-suite en
  rojo → `pnpm test` sale con código ≠ 0 (RED garantizado). Los casos que
  cubrirán al existir el módulo: F1-F4 (5) y H1-H7 (7).
- `NameField.fallback.test.tsx` → N1/N2 fallan porque el `NameField` actual
  **oculta** el mic cuando el nativo no sirve (`Unable to find … button "Dictar
  mi nombre"`); N5 falla porque `voice.transcribingLabel` es `undefined` (schema
  sin la clave) → `getByText(undefined)`; N4/N6 fallan por la orquestación
  ausente. N3/N7 pasan (regresión protegida).
- `schema.test.ts` (SC1) → los 2 tests nuevos fallan porque
  `voice.transcribingLabel` aún no está en el schema (`expected undefined …`).

Los 226 tests previos del frontend siguen **verdes** (sin regresiones): los
únicos archivos en rojo son los de esta feature.

## Nota sobre typecheck / smoke (para el leader)

- El `typecheck` del backend (`tsc --noEmit` sobre todo `src`, incluidos los
  `*.test.ts`) va en **rojo** con `TS2307: Cannot find module
  './transcription.service.js'` (y el router import cuando se cablee). Es el
  MISMO patrón que tuvieron RED anteriores del repo (p.ej.
  `crypto.service.test.ts` importaba su módulo antes de existir): en la fase RED
  el typecheck queda rojo por los módulos pendientes y se cierra al GREEN. El
  typecheck base (sin estos archivos) es verde — verificado moviendo los archivos
  aparte —, así que el rojo lo introducen exclusivamente estos tests.
- **B8** (smoke de carga en runtime de `voice.routes`/`transcription.service`) NO
  se implementa aquí: es responsabilidad del implementer al dar el GREEN de
  backend (regla de AGENTS.md: "el GREEN de backend no está verificado hasta que
  el módulo CARGA en runtime"). El implementer debe extender `backend/src/smoke.ts`
  para importar el nuevo router/service, ya que los tests de endpoint mockean el
  service y un import ESM roto de `groq-sdk` pasaría lint+typecheck+vitest.

## Lint

Los seis archivos de test pasan ESLint (sin `.only`, sin `no-unsafe-*`): los
`act(async …)` de `useVoiceFallback.test.ts` incluyen un `await flush()` para no
disparar `require-await`.

---

## Reconciliación RED→GREEN (post-implementación)

El implementer cerró el GREEN (los 21 tests nuevos pasan) y dejó dos asuntos del
dominio del tester, resueltos aquí SIN tocar código de producción ni debilitar
las aserciones nuevas N1-N7.

### 1) Tests obsoletos en `NameField.test.tsx` reconciliados con ADR 22

ADR 22 (aprobado por el usuario) sustituye el "ocultar el mic" de
`voice_reliability` por **degradación funcional**: cuando `isSupported===false`
(Firefox) o `voiceUnavailable===true` (Brave), el botón de mic AHORA SÍ se
renderiza y opera el fallback de Groq. Cuatro tests de `NameField.test.tsx`
(que mockean solo `useVoiceInput`) afirmaban lo contrario y contradecían la spec
nueva. Se actualizaron para reflejar la verdad nueva, conservando lo que sigue
válido (textbox + contador presentes, formulario intacto):

| Caso | Antes (voice_reliability) | Ahora (voice_universal / ADR 22) |
|---|---|---|
| Caso 13 (no-soporte) | "sin soporte NO hay botón de mic" | "sin soporte el botón de mic SÍ está (startLabel de marca) para el fallback" |
| Caso 15-último (white-label no-soporte) | "sin soporte no hay botón con textos de la marca" | "sin soporte el botón usa el startLabel de la marca activa; no filtra el de otra marca" |
| B11 (`!isSupported`) | "no hay botón de mic; textbox sigue" | "el botón de mic (startLabel) SÍ está para el fallback; textbox sigue" |
| B12 (`voiceUnavailable`) | "el botón de mic se oculta; textbox+contador siguen" | "el botón de mic SÍ está para el fallback; textbox+contador siguen" |

No se debilitó nada: la verificación de QUÉ hook se dispara (fallback vs nativo)
vive —con más fuerza— en **N1/N2/N3** de `NameField.fallback.test.tsx`, que
mockean AMBOS hooks. Estos cuatro casos de `NameField.test.tsx` (que solo mockean
el nativo) quedan reducidos a afirmar la PRESENCIA del botón y la integridad del
formulario, evitando duplicar débilmente lo que N1/N2/N3 ya cubren. El resto de
`NameField.test.tsx` (contador, límite 15, toggle, errores nativos, Caso 14) no
se tocó.

### 2) `useVoiceFallback.test.ts` compatible con `tsc` del repo

El repo usa `erasableSyntaxOnly` + `noUncheckedIndexedAccess`. El
`MockMediaRecorder` usaba parámetros-propiedad (`public stream`, `public options`)
y `transcribe.mock.calls[0]?.[0]` sobre un mock sin firma tipada. Se corrigió sin
cambiar lo que verifica (H1-H7 intactos):

- `MockMediaRecorder` declara `stream`/`options` como campos y los asigna en el
  cuerpo del constructor (nada de parámetros-propiedad).
- `makeTranscribe` (y el mock inline de H4) se tipan con `vi.fn<TranscribeFn>`
  (`(audio: Blob) => Promise<string>`), de modo que `mock.calls[0]?.[0]` es
  `Blob | undefined` y `toBeInstanceOf(Blob)` typechea bajo índice comprobado.

### 3) Simplificación menor en `transcription.service.test.ts`

Con el service ya existente (GREEN), el `as TranscriptionModule` del import
dinámico pasó a ser innecesario (`no-unnecessary-type-assertion`): se eliminó la
interfaz local y la aserción; `import('./transcription.service.js')` ya resuelve
al módulo real tipado.

### Estado final (los tres gates en verde, cero regresiones)

```
backend  test:  Test Files 10 passed (10)   Tests 53 passed (53)
frontend test:  Test Files 25 passed (25)   Tests 248 passed (248)
pnpm lint:      backend Done | frontend Done
pnpm typecheck: backend Done | frontend Done
```

Los 21 tests nuevos de voice_universal pasan; los previos siguen verdes. No se
tocó código de producción (`backend/**`, `frontend/src` fuera de los tests). B8
(smoke de carga en runtime del router/service) sigue siendo verificación del
implementer/leader al cerrar el GREEN de backend.
