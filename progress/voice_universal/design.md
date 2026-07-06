# Design — voice_universal (dictado universal en los 4 navegadores)

> Feature EXTRA / stretch, `layer: fullstack`, `requires_approval: true`.
> Decisión de proveedor YA TOMADA por el usuario (2026-07-05): **enfoque (A)
> Whisper vía backend, proveedor Groq `whisper-large-v3-turbo`**. Research
> completo con fuentes primarias en `progress/voice_universal/research.md`
> (sección "## Research A vs B"). Este diseño la respalda, no la reabre.

## Objetivo

Convertir el "ocultar el micrófono" que hoy hace `voice_reliability` (Firefox
sin Web Speech API; Brave con el servicio de Google bloqueado → `errorCode ===
'network'`) en **degradación funcional**: en esos navegadores se captura audio
con `getUserMedia`/`MediaRecorder` (soportados en Firefox/Brave), se sube el
`Blob` webm/opus a un endpoint propio del backend que lo reenvía a Groq Whisper,
y la transcripción rellena el **mismo** estado del nombre con el **mismo clamp de
15**. Chrome/Safari NO cambian: siguen usando Web Speech nativo (gratis,
instantáneo, cero coste/infra). El input manual sigue siendo el camino
garantizado si todo falla.

**Fallback, no reemplazo.** El servicio de IA se activa SOLO cuando el camino
nativo no está disponible: `isSupported === false` (Firefox) o
`voiceUnavailable === true` (latch de `network`, p.ej. Brave).

---

## 1. ADR (borrador listo para `docs/decisiones.md` — siguiente número: ADR 22)

> El leader debe pegar este ADR en `docs/decisiones.md` ANTES de que el
> implementer escriba código de producción. La acceptance lo exige
> explícitamente ("Decisión A vs B tomada y justificada en un ADR … antes de
> implementar"). **Gate de aprobación humana (`requires_approval: true`): el
> usuario aprueba este ADR + este diseño antes del RED.**

### 22. Dictado universal: fallback a Whisper vía backend (Groq `whisper-large-v3-turbo`)

- **Contexto (2026-07-05):** el dictado usa la Web Speech API nativa, que
  funciona en Chrome/Edge/Safari pero NO en Firefox (no implementa la API) ni en
  Brave (bloquea el servicio de reconocimiento de Google → `errorCode ===
  'network'`). `voice_reliability` ya degrada elegante ocultando el micrófono
  donde no hay forma de dictar. El enunciado (`docs/ExamenPractico_Front.md`,
  requisito de dictado por voz) permite explícitamente "APIs nativas, librerías
  o **servicios de IA**". Se quiere dictado FUNCIONAL en los 4 navegadores.

- **Decisión:** añadir un **fallback** basado en **Whisper vía backend**,
  proveedor **Groq `whisper-large-v3-turbo`**. El front graba con
  `MediaRecorder` (`audio/webm;codecs=opus`) y hace un único `POST` multipart a
  un endpoint propio (`POST /voice/transcribe`); el backend reenvía el `Blob`
  **sin transcodificar** a Groq (Groq acepta `webm` directo) y devuelve
  `{ text }`. La `GROQ_API_KEY` es secreto de entorno (Parameter Store en prod,
  validado por Zod al boot), **nunca en el bundle ni en el repo**. El fallback
  se activa SOLO cuando el camino nativo no sirve (`isSupported === false` o
  `voiceUnavailable === true`); Chrome/Safari siguen con Web Speech nativo.

- **Por qué (A/Groq frente a las alternativas):**
  - **Fiabilidad idéntica en los 4 navegadores:** el trabajo lo hace el
    servidor, así que Firefox y Brave obtienen exactamente la misma calidad y
    latencia que cualquier otro. Es justo lo que la feature busca arreglar.
  - **Sin transcodificar:** Groq (y OpenAI) aceptan `webm/opus` directo → se
    elimina la Web Audio API, el downsample a PCM y el troceo de chunks que
    hacían caro a Transcribe. Patrón batch simple: graba → un POST → texto.
  - **Encaja con la infra existente:** ~35 líneas de endpoint en el backend que
    ya vive en App Runner, y una API key por el mismo patrón Parameter Store que
    ya usa `CRYPTO_PRIVATE_KEY`. Nada de WebSocket, nada stateful.
  - **Coste ~nulo:** free tier de Groq (2.000 req/día, 7.200 s/hora) cubre de
    sobra una demo; `whisper-large-v3-turbo` a $0.04/hora y clips de ~3-5 s.
  - **Latencia:** Groq turbo transcribe clips cortos en cientos de ms; mejor
    experiencia que OpenAI para el fallback interactivo.
  - **Endpoint agnóstico del proveedor:** el service aísla Groq tras una
    interfaz `transcribeAudio(...)`; cambiar a OpenAI = cambiar el service, no el
    controller/route/contrato HTTP.

- **Alternativas descartadas** (detalle en `progress/voice_universal/research.md`):
  - **(B) transformers.js (Whisper WASM en el navegador):** 0 backend y 0
    secreto, pero castiga justo a Firefox/Linux (sin WebGPU estable en 2026 →
    WASM lento) con una descarga de modelo de 78-145 MB antes del primer texto;
    peor experiencia en el navegador a rescatar, y mete complejidad WASM/WebGPU +
    CSP del CDN de HF. Ver research "## Research A vs B → B".
  - **Amazon Transcribe (streaming):** descartado antes (2026-07-04, usuario):
    exige PCM crudo transcodificado + proxy WebSocket de larga duración en App
    Runner + coste $0.024/min. Ver research (sección superior).
  - **OpenAI `gpt-4o-mini-transcribe`:** alternativa válida y ~igual de simple;
    Groq gana por free tier más generoso y menor latencia. Endpoint diseñado
    agnóstico, así que quedar en Groq no cierra la puerta.

---

## 2. Contrato del endpoint backend

Nuevo endpoint, en las mismas capas `routes → controllers → services` que el
resto (ver `backend/src/app.ts`, `names.routes.ts`, `crypto.controller.ts`).

### 2.1. Superficie HTTP

- **Método y ruta:** `POST /voice/transcribe`
- **Content-Type:** `multipart/form-data`
- **Campo del archivo:** `audio` (un único fichero). El front sube el `Blob` de
  `MediaRecorder` como `audio/webm;codecs=opus` con nombre `voice.webm`.
- **Sin body JSON, sin cifrado.** A diferencia de `/names`, aquí no viaja el
  nombre en claro ni PII persistida: es audio efímero de un nombre corto que se
  transcribe y se devuelve; el backend **no lo persiste** (no lo escribe en
  Mongo ni en disco; se mantiene en memoria el tiempo de la petición). El
  `language` se fija a `'es'` en el backend (no lo manda el cliente), coherente
  con `voice.lang` de la marca por defecto; si en el futuro se quisiera
  parametrizar, sería un campo del form, no ahora (minimalismo).

### 2.2. Límites (defensa de abuso y coste)

- **Tamaño máximo del audio:** `2 MB` (constante `MAX_AUDIO_BYTES`). Un nombre
  de ≤15 chars dura ~3-5 s; webm/opus a esa duración pesa decenas de KB. 2 MB da
  margen holgado y corta subidas abusivas muy por debajo del límite de 25 MB de
  Groq. Rechazo → **413**.
- **Duración máxima:** el front limita la grabación a **~10 s** (constante
  `MAX_RECORDING_MS`, para-automático con `setTimeout` que llama a
  `recorder.stop()`); el backend NO decodifica audio para medir duración (sería
  transcodificar), confía en el tope de bytes como proxy de duración. La
  facturación mínima de Groq es 10 s/request, así que no tiene sentido grabar más.
- **Tipos MIME aceptados:** `audio/webm`, `audio/ogg` (Firefox puede emitir
  `audio/ogg;codecs=opus` según versión), `audio/mp4` (Safari, aunque Safari usa
  el camino nativo y no llega aquí; se acepta por robustez). MIME fuera de la
  allowlist → **400**.
- **Rate-limit:** reutilizar el patrón de `namesLimiter` (`express-rate-limit`,
  por IP, ventana 60 s). Un limiter propio `voiceLimiter` montado solo en
  `/voice`, con `max: env.rateLimitMax` (misma env que ya existe). Al exceder →
  **429** con el mismo contrato `{ error, message }`.

### 2.3. Respuestas

| Status | Cuerpo | Cuándo |
|---|---|---|
| `200` | `{ "text": "<transcripción>" }` | Transcripción OK. `text` es string (puede ser `""` si Groq no oyó nada). |
| `400` | `{ "error": "invalid_payload" }` | Falta el campo `audio`, MIME no permitido, o body no multipart. |
| `413` | `{ "error": "audio_too_large" }` | El fichero supera `MAX_AUDIO_BYTES`. |
| `429` | `{ "error": "too_many_requests", "message": "…" }` | Rate-limit excedido (mismo contrato que `/names`). |
| `502` | `{ "error": "transcription_failed" }` | Groq responde error o es inaccesible (fallo del proveedor upstream). |
| `500` | `{ "error": "internal_error" }` | La API key no está configurada / error inesperado no atribuible al proveedor. |

- El controller NO filtra detalle del proveedor (nada de status/body de Groq en
  la respuesta ni en el `message`): errores upstream → `502
  transcription_failed` genérico, coherente con cómo `crypto.controller` mapea
  fallos sin filtrar detalle criptográfico.
- El `errorHandler` central sigue siendo la red final; el controller responde
  los códigos de negocio directamente (mismo estilo que `postName`).

### 2.4. Reparto por capas

- **Route** (`backend/src/routes/voice.routes.ts`): define
  `voiceRouter.post('/transcribe', <upload middleware>, postTranscribe)`. El
  middleware de subida parsea el multipart y aplica el límite de bytes/MIME
  (rechazando a 413/400 ANTES de llegar al controller cuando sea posible).
- **Controller** (`backend/src/controllers/voice.controller.ts`,
  `postTranscribe`): valida presencia del fichero y MIME (→ 400), comprueba que
  la key está configurada (→ 500 `internal_error` si falta), llama al service
  con el buffer/stream + MIME, y responde `{ text }` (200) o traduce el fallo del
  service a **502 `transcription_failed`**. No conoce a Groq.
- **Service** (`backend/src/services/transcription.service.ts`,
  `transcribeAudio({ audio: Buffer, mimeType: string }): Promise<string>`): única
  capa que conoce el proveedor. Construye el `File`/blob a partir del buffer y
  llama al SDK/HTTP de Groq con `model: 'whisper-large-v3-turbo'`, `language:
  'es'`; devuelve `text`. Lee la key vía `env.groqApiKey`. Aísla el proveedor
  tras esta firma agnóstica → cambiar a OpenAI toca solo este archivo.

### 2.5. Dependencia nueva — DECISIÓN

- **Cliente del proveedor: `groq-sdk`** (paquete oficial de Groq, API compatible
  OpenAI, `client.audio.transcriptions.create({ file, model, language })`). Se
  prefiere el SDK sobre `fetch` manual multipart porque encapsula la
  construcción del multipart hacia Groq y el manejo de errores, con un tipado
  estable; es una sola dependencia acotada al `transcription.service`. Añadir
  dependencias es decisión del leader/usuario, no un supuesto del designer:
  **queda propuesta explícita `groq-sdk` para aprobación en el gate**. Si el
  usuario prefiere no añadir SDK, el fallback es `fetch` nativo (Node 20+) a
  `https://api.groq.com/openai/v1/audio/transcriptions` con `FormData` —
  mismo contrato del service, cero deps nuevas; decídelo en el gate.
- **Parseo de multipart en Express: `multer`** (en memoria, `memoryStorage`,
  `limits.fileSize = MAX_AUDIO_BYTES`). Es la vía estándar y madura para
  multipart en Express; su límite de tamaño integrado produce el 413 sin leer
  todo el fichero. También sujeto a aprobación en el gate (es una dep nueva). No
  se reinventa el parseo de multipart a mano.
- **Ambas dependencias son decisión del gate de aprobación humana**, no un hecho
  consumado por el designer.

### 2.6. Configuración / secreto (`GROQ_API_KEY`)

- Añadir a **`backend/src/config/env.ts`**:
  - En el objeto `env`: `groqApiKey: process.env.GROQ_API_KEY ?? ''`.
  - En `envSchema`: `GROQ_API_KEY: z.string().optional().default('')` —
    **opcional**, no obligatorio al boot. Motivo: la feature es EXTRA/stretch y
    el backend debe arrancar en dev/prod aunque la key no esté configurada; el
    endpoint responde `500 internal_error` si se invoca sin key (verificado en
    el controller), en vez de tumbar el arranque. Esto NO relaja la seguridad:
    el resto de la validación (Mongo, clave privada) sigue siendo fail-fast.
  - En `ValidatedEnv` y en el `return` de `validateEnv`: propagar `groqApiKey`.
- Añadir a **`.env.example`** (raíz), bloque backend, con comentario de que es un
  secreto de Parameter Store en prod y jamás va al bundle:
  ```
  # Servicio de IA para el dictado universal (fallback de voz en Firefox/Brave).
  # Secreto de entorno (Parameter Store en prod), NUNCA en el bundle ni en el repo.
  # Opcional: si falta, el endpoint /voice/transcribe responde 500 y el fallback
  # de voz queda inactivo, pero el resto de la app arranca igual.
  GROQ_API_KEY=
  ```
- En **prod**: la key entra por Parameter Store como el resto de secretos
  (mismo mecanismo que `CRYPTO_PRIVATE_KEY`); el hook `PreToolUse` que bloquea
  escribir `.env` sigue protegiendo contra fugas. El `secret-scan` del CI debe
  seguir en verde (no se commitea ninguna key real).
- **Montaje en `app.ts`:** `app.use('/voice', voiceLimiter, voiceRouter)`,
  junto a los otros routers. `POST` ya está en `corsOptions.methods`.

---

## 3. Arquitectura de fallback en el front

### 3.1. Dónde vive la lógica (respeta la convención frontend del repo)

Convención del repo (memoria "convención estructura frontend"):
componente-por-carpeta PascalCase, módulos por rol con barrel, hook/Context
fuera del Provider. Se añade **un módulo de rol nuevo** sin tocar la máquina de
`useVoiceInput` (que ya cumple sus features):

- **`frontend/src/api/transcribeVoice.ts`** (+ export en `api/index.ts`): función
  `transcribeVoice(audio: Blob, deps?): Promise<string>` que hace el `POST`
  multipart a `/voice/transcribe` reutilizando el patrón de `client.ts`
  (base URL `env.apiUrl`, `ApiError` con el status en fallo). Devuelve `text`.
  Es la capa de red, inyectable en tests (`fetchFn`/`apiUrl` como en `apiFetch`).
  NOTA: `apiFetch` fija `Accept: application/json` y no toca el body; para
  multipart el navegador debe poner el `Content-Type` con el boundary → esta
  función construye el `FormData` y llama a `fetch`/`apiFetch` SIN fijar
  `Content-Type` manualmente (el navegador lo añade). Si `apiFetch` no encaja
  limpio para multipart, `transcribeVoice` usa `fetch` directo con el mismo
  contrato de error (`ApiError(status)`), sin duplicar lógica de negocio.

- **`frontend/src/voice/useVoiceFallback.ts`** (hook nuevo, hermano de
  `useVoiceInput`, fuera de cualquier Provider): encapsula la captura por IA.
  Expone una máquina de estados análoga a la del hook nativo para que la UI no
  distinga la fuente:
  ```ts
  type FallbackStatus = 'idle' | 'recording' | 'transcribing' | 'error';
  interface UseVoiceFallbackResult {
    status: FallbackStatus;
    isRecording: boolean;        // status === 'recording'
    isTranscribing: boolean;     // status === 'transcribing'
    errorCode: 'permission-denied' | 'no-audio' | 'network' | 'unknown' | null;
    start: () => void;           // getUserMedia + MediaRecorder.start()
    stop: () => void;            // MediaRecorder.stop() → dispara el POST
  }
  ```
  Responsabilidades:
  1. `start()`: `navigator.mediaDevices.getUserMedia({ audio: true })` →
     `new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })` (con
     fallback de `mimeType` según `MediaRecorder.isTypeSupported`, p.ej.
     `audio/ogg;codecs=opus` en Firefox). Acumula chunks en `ondataavailable`,
     arranca un `setTimeout(MAX_RECORDING_MS)` que auto-detiene. Estado
     `recording`.
  2. `stop()` / auto-stop: en `onstop`, ensambla el `Blob`, libera el micrófono
     (`stream.getTracks().forEach(t => t.stop())`), pasa a `transcribing`, llama
     a `transcribeVoice(blob)` (inyectable). Con el resultado invoca
     `onResult(text)`; en fallo mapea a `errorCode` y estado `error`.
  3. `getUserMedia` denegado → `errorCode: 'permission-denied'`. `ApiError`
     status 0 → `'network'`; otros status → `'unknown'`. Blob vacío/silencio con
     `text === ''` → tratable como `'no-audio'` (reusa el aviso de "no te
     escuchamos", ver §3.4).
  4. Cleanup en unmount: aborta grabación y libera tracks (como el `useEffect` de
     cleanup del hook nativo).
  - Recibe `onResult(transcript: string)` igual que `useVoiceInput`, para que el
    dueño del estado (NameField) aplique el **clamp de 15** exactamente igual.

### 3.2. Orquestación nativo-vs-fallback en `NameField` (sin romper el contrato actual)

`NameField.tsx` hoy consume `useVoiceInput` y calcula `showMic = isSupported &&
!voiceUnavailable`. Se **invierte esa condición** para el fallback, sin tocar el
hook nativo:

- `const nativeAvailable = isSupported && !voiceUnavailable;`
- `const useFallback = !nativeAvailable;` → exactamente los casos que hoy ocultan
  el mic (Firefox `isSupported===false`, Brave `voiceUnavailable===true`).
- Se llama a **ambos** hooks siempre (reglas de hooks: sin llamadas
  condicionales), pero solo se "cablea" el activo:
  - `useVoiceInput({ onResult: applyName, lang: voice.lang })` — como hoy.
  - `useVoiceFallback({ onResult: applyName })` — nuevo.
  - `applyName = (t: string) => onChange(clampToMax(t))` — **una sola** función,
    el MISMO clamp de 15 para ambas fuentes (ya existe `clampToMax`).
- El botón de micrófono **siempre se renderiza** (ya no hay caso "oculto"):
  - Si `nativeAvailable`: comportamiento actual (toggle `start/stop` según
    `isListening`, pulso en `listening`, errores de marca).
  - Si `useFallback`: el botón hace toggle `start/stop` del hook de fallback
    según `isRecording`; muestra el estado `transcribing` (spinner/etiqueta).
  - La decisión de qué handler/label/estado usar se resuelve con una pequeña capa
    de adaptación en el propio `NameField` (o un helper `voiceViewModel` puro,
    testeable) que unifica ambos hooks en `{ micActive, onToggle, statusLabel,
    errorText }`. Cero literales: todos los labels salen de `voice.*`.

**Por qué en NameField y no dentro de `useVoiceInput`:** `voice_reliability`
decidió (memoria + feature_list) NO reescribir la máquina de `useVoiceInput`; su
contrato `status/isSupported/isListening/errorCode/voiceUnavailable/start/stop`
se mantiene intacto. El fallback es un hook hermano; la orquestación (elegir
fuente) es integración de UI, que es donde `voice_reliability` ya puso la lógica
de `showMic`. Añadir el fallback = añadir un hook + cablear NameField, sin tocar
el hook nativo ni WelcomeScreen.

### 3.3. Estados de carga/error visibles

- **Grabando (fallback):** reutiliza el mismo feedback visual que "escuchando"
  del nativo — pulso en el botón (`motion-safe:animate-pulse`,
  `prefers-reduced-motion` respetado) + etiqueta `voice.listeningLabel`
  ("Escuchando…"). Semánticamente equivale a "listening".
- **Transcribiendo (fallback):** estado nuevo sin equivalente nativo. El botón
  se marca ocupado (`aria-busy`, spinner o icono distinto) y se muestra una
  etiqueta de marca. **Requiere una clave de texto nueva** (ver §3.4).
- **Errores (fallback):** se mapean a textos de marca EXISTENTES para minimizar
  el schema:
  - `permission-denied` → `voice.permissionDenied` (ya existe).
  - `no-audio` → `voice.noSpeech` (ya existe, "No te escuchamos…").
  - `network` / `unknown` → `voice.genericError` (ya existe).
  - Se muestran en la MISMA región `role="status" aria-live="polite"` que ya
    tiene NameField.

### 3.4. Texto de marca nuevo — mínimo imprescindible

Solo se añade **UNA** clave nueva al schema (`voice.transcribingLabel`), porque
el estado "transcribiendo" no tiene equivalente en el flujo nativo y no hay texto
existente que lo cubra sin mentir al usuario. Todos los demás estados reusan
claves existentes.

- En `frontend/src/brand/core/schema.ts`, bloque `voice`, añadir:
  ```ts
  transcribingLabel: z.string().default('Transcribiendo…'),
  ```
- Al tener `.default()`, ninguna marca existente necesita editar su JSON
  (principio "marca nueva = un JSON"); el default neutro aplica a todas.
- **Cero hex, cero color literal, cero texto hardcoded** en los componentes: el
  spinner usa tokens (`text-brand-accent`/`text-brand-primary`), la etiqueta sale
  de `voice.transcribingLabel`.

---

## 4. Seguridad

- **API key jamás en el bundle:** vive solo en el backend (`env.groqApiKey`,
  Parameter Store en prod). El front nunca la ve; solo habla con `/voice/transcribe`
  de nuestro propio backend. El hook `PreToolUse` bloquea escribir `.env`; el
  `secret-scan` del CI debe seguir en verde.
- **Límites de abuso:** `MAX_AUDIO_BYTES = 2 MB` (413) + `MAX_RECORDING_MS ≈ 10s`
  en el front + `voiceLimiter` por IP (429). El audio no se persiste (memoria
  efímera, `multer.memoryStorage`), no toca Mongo ni disco.
- **CORS:** `/voice` cae bajo el mismo `corsOptions` (allowlist `env.corsOrigins`,
  `POST` ya permitido). Sin cambios de allowlist.
- **Sin fuga de detalle upstream:** errores de Groq → `502 transcription_failed`
  genérico; nada del proveedor en la respuesta ni en logs de nivel usuario.
- **Front en CloudFront:** el `POST` va a NUESTRO backend (dominio ya permitido
  en `connect-src` para `/names` y `/crypto`), NO al CDN de HuggingFace → a
  diferencia de la alternativa (B), **no hay que ampliar la CSP**. Confirmar que
  `connect-src` del front cubre el host del backend (ya lo hace para las
  llamadas existentes; `/voice` es el mismo host).
- **Qué audita `security-auditor` después (la acceptance lo exige):**
  1. `GROQ_API_KEY` no aparece en `frontend/**` ni en el bundle build (`grep`
     del `dist` del front); solo en backend y `.env.example` (vacía).
  2. El límite de tamaño (413) se aplica de verdad y ANTES de reenviar a Groq
     (multer `limits.fileSize`), no solo declarado.
  3. El endpoint no persiste el audio ni el nombre transcrito.
  4. Errores del proveedor no filtran detalle (status/body de Groq) al cliente.
  5. Rate-limit activo en `/voice`.

---

## 5. Plan de tests (para el tester — RED primero, sin red ni API real)

### 5.1. Backend — `POST /voice/transcribe` (service/SDK mockeado, Supertest)

Estilo idéntico a `names.routes.test.ts`: `vi.mock` del service, `vi.resetModules`
+ import dinámico de `createApp`, `vi.stubEnv('GROQ_API_KEY', ...)`.

- **B1.** `audio` webm válido + service mockeado devuelve `'Ana'` → **200**
  `{ text: 'Ana' }`; el service se invoca **una** vez con el buffer y el MIME.
- **B2.** Petición SIN campo `audio` (o body no multipart) → **400**
  `{ error: 'invalid_payload' }`; el service NO se invoca.
- **B3.** MIME fuera de la allowlist (p.ej. `image/png`) → **400**
  `invalid_payload`; service no invocado.
- **B4.** Fichero > `MAX_AUDIO_BYTES` → **413** `{ error: 'audio_too_large' }`;
  service no invocado. (Se sube un buffer sintético mayor al límite; el límite
  de test puede reducirse vía constante si conviene, sin depender de subir 2 MB
  reales.)
- **B5.** El service (Groq) lanza / rechaza → **502**
  `{ error: 'transcription_failed' }`; sin detalle del proveedor en el body.
- **B6.** `GROQ_API_KEY` ausente (`stubEnv` a `''`) + audio válido → **500**
  `{ error: 'internal_error' }`; el service NO se invoca (o se corta antes).
- **B7.** El service recibe `language: 'es'` fijado por el backend (aserción
  sobre el argumento con que se invoca el mock, o un test unitario del service
  con el SDK de Groq mockeado que verifica `model` y `language`).
- **B8. (runtime, no solo vitest):** confirmar que el módulo del service y el
  router CARGAN en runtime (`pnpm --filter @nach/backend smoke` /
  `init.sh full`), porque los tests mockean el service y un import ESM roto
  (p.ej. named export inexistente de `groq-sdk`) pasaría lint+typecheck+vitest.
  Esto es tarea del implementer al dar el GREEN (regla de AGENTS.md), pero el
  tester deja el smoke cubriendo la carga de `voice.routes`/`transcription.service`.

### 5.2. Backend — `transcription.service` unitario (SDK mockeado)

- **S1.** `transcribeAudio` llama al SDK con `model: 'whisper-large-v3-turbo'`,
  `language: 'es'` y el fichero construido desde el buffer; devuelve `text`.
- **S2.** SDK lanza → `transcribeAudio` propaga el error (el controller lo
  traduce a 502).

### 5.3. Frontend — `transcribeVoice` (fetch mockeado)

- **F1.** `transcribeVoice(blob)` hace `POST` a `/voice/transcribe` con
  `FormData` que contiene el campo `audio`; con `fetch` mockeado devolviendo
  `{ text: 'Ana' }` → resuelve `'Ana'`.
- **F2.** Respuesta `!ok` (413/502) → rechaza con `ApiError` con ese status.
- **F3.** Rechazo de red (`fetch` throw) → `ApiError` status 0.
- **F4.** No fija `Content-Type` manualmente (deja el boundary al navegador).

### 5.4. Frontend — `useVoiceFallback` (MediaRecorder + getUserMedia mockeados)

Se mockean `navigator.mediaDevices.getUserMedia`, `MediaRecorder` (clase falsa
con `start/stop/ondataavailable/onstop`) y `transcribeVoice` (inyectado).

- **H1.** `start()` pide `getUserMedia({ audio: true })` y arranca el recorder →
  `status === 'recording'`, `isRecording === true`.
- **H2.** `stop()` → ensambla blob, pasa a `transcribing`, llama a
  `transcribeVoice` con el blob; al resolver `'Ana'` invoca `onResult('Ana')` y
  vuelve a `idle`.
- **H3.** `getUserMedia` rechaza (permiso denegado) → `errorCode:
  'permission-denied'`, `status: 'error'`.
- **H4.** `transcribeVoice` rechaza con `ApiError(0)` → `errorCode: 'network'`.
- **H5.** `transcribeVoice` resuelve `''` (silencio) → `errorCode: 'no-audio'`
  (o `onResult('')` que NameField ignora + aviso), según decida el tester al
  escribir el RED; el diseño acepta cualquiera de las dos siempre que el usuario
  vea el aviso `voice.noSpeech`.
- **H6.** Auto-stop tras `MAX_RECORDING_MS` (timers falsos) detiene la grabación
  y dispara la transcripción.
- **H7.** Cleanup en unmount libera los tracks del stream.

### 5.5. Frontend — integración en `NameField` (ambos hooks mockeados)

- **N1. Activación del fallback solo donde el nativo no sirve:** con
  `useVoiceInput` mockeado a `isSupported === false` → el botón usa el hook de
  **fallback** (al pulsarlo se invoca `useVoiceFallback.start`, NO
  `useVoiceInput.start`).
- **N2.** Con `useVoiceInput` mockeado a `voiceUnavailable === true` (Brave) →
  igual: el botón usa el fallback.
- **N3.** Con nativo disponible (`isSupported`, `!voiceUnavailable`) → el botón
  usa el hook **nativo** (comportamiento actual), NO el fallback.
- **N4. Clamp de 15 sobre el resultado del fallback:** el `onResult` del fallback
  devuelve un texto de 20 chars → `onChange` recibe exactamente 15
  (mismo `clampToMax` que el nativo).
- **N5. Estado de carga visible:** con el fallback en `transcribing`, se muestra
  `voice.transcribingLabel` y el botón queda `aria-busy` — sin literales ni hex.
- **N6. Estado de error visible:** `errorCode: 'permission-denied'` del fallback
  → se muestra `voice.permissionDenied` en la región `aria-live`; `'no-audio'` →
  `voice.noSpeech`; `'network'`/`'unknown'` → `voice.genericError`.
- **N7.** El input manual sigue funcionando en todos los casos (escribir rellena
  el campo con el tope de 15) — el fallback nunca rompe el formulario.

### 5.6. Schema — `voice.transcribingLabel`

- **SC1.** `parseBrandConfig({})` produce `voice.transcribingLabel` con el
  default; un JSON de marca que lo omite sigue siendo válido (test del schema
  como los existentes).

---

## Puntos que requieren gate de aprobación humana (`requires_approval: true`)

1. **Aprobar el ADR 22** (§1) y que se añada a `docs/decisiones.md` ANTES del RED
   (exigido por la acceptance).
2. **Aprobar las dependencias nuevas** `groq-sdk` y `multer` (§2.5) — añadir deps
   es decisión del leader/usuario, no del designer. Alternativa sin `groq-sdk`
   (fetch nativo) queda documentada por si se prefiere no añadir SDK.
3. **Aprobar la clave de texto nueva** `voice.transcribingLabel` (§3.4) — única
   adición al schema de marca.
4. **Aprobar el gasto de tiempo:** es feature EXTRA/stretch; solo se implementa
   con el core + deploy impecables y tiempo de sobra (decisión ya registrada en
   `feature_list.json`).

---

## Criterios de aceptación traducibles a tests (resumen para el tester)

- El fallback se activa SOLO cuando `isSupported === false` o `voiceUnavailable
  === true`; con nativo disponible se usa Web Speech (N1/N2/N3).
- Captura → POST multipart → `{ text }` rellena el mismo estado del nombre con el
  clamp de 15 (H2/N4).
- `POST /voice/transcribe`: 200 `{text}` (B1), 400 payload/MIME inválido (B2/B3),
  413 too large (B4), 502 fallo del proveedor (B5), 500 sin key (B6),
  `language:'es'` fijado por el backend (B7/S1).
- API key nunca en el bundle; audio no persistido; límites y rate-limit activos
  (§4, auditados por security-auditor).
- Estados de carga (`voice.transcribingLabel`) y error (claves de marca
  existentes) visibles; cero literales ni hex (N5/N6/SC1).
- Todos los tests con red/API/MediaRecorder/getUserMedia mockeados; el smoke
  confirma la carga en runtime del router y el service (B8).
