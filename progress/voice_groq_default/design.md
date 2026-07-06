# Design — voice_groq_default

REWORK que supersede la voz existente. Groq pasa a ser el **motor de voz único**
en los 4 navegadores; se elimina el camino nativo (Web Speech). El botón cambia a
un flujo **grabar → enviar** en 2 clics. Es una feature de **frontend**: el backend
`POST /voice/transcribe` (Groq, commit 1808940) queda intacto.

## Objetivo

- Un solo motor de voz (Groq vía backend) para todos los navegadores → sin el
  "baile" del fallback reactivo (la 1ª pulsación desperdiciada en Brave).
- Eliminar `useVoiceInput` (Web Speech) y toda su UX en vivo (isListening,
  voiceUnavailable, interimResults, no-speech sintético, ocultar mic).
- Botón grabar→enviar: el icono refleja la acción del **próximo** clic
  (micrófono → enviar), estado ocupado con `voice.transcribingLabel` al subir.
- Mantener intactos: white-label estricto (cero literales/hex), clamp de 15,
  input manual como camino garantizado, y la seguridad (key solo en backend).

---

## 1. ADR 23 (borrador para docs/decisiones.md) — GATE de aprobación humana

> **Este ADR revierte una decisión previa (ADR 22) → requiere OK humano antes de
> implementar.** El leader lo presenta en el gate de diseño.

### 23. Groq como motor de voz ÚNICO y flujo grabar→enviar — feature `voice_groq_default` (supersede parte del ADR 22)

- **Contexto (2026-07-05):** el ADR 22 decidió Web Speech nativo como preferente y
  Groq solo como **fallback** para Firefox/Brave (`isSupported === false` o
  `voiceUnavailable === true`). Probándolo en runtime apareció un defecto de UX del
  fallback reactivo: en Brave el nativo **arranca**, muere con `error === 'network'`,
  y solo **la 2ª pulsación** cae a Groq — la 1ª se desperdicia. El problema es
  estructural: no se puede saber **a priori** si un Chromium tiene el servicio de
  reconocimiento de Google disponible (Brave lo bloquea, Chrome no), así que la
  detección solo ocurre **después** de fallar una vez. El "baile" nativo↔fallback
  es intrínseco a tener dos motores decididos en caliente.

- **Decisión (con el usuario, 2026-07-05):** **Groq pasa a ser el motor de voz
  único** en los 4 navegadores. Se **elimina** `useVoiceInput` (Web Speech) y toda
  su UX en vivo. El motor de grabación+transcripción (hoy `useVoiceFallback`) pasa a
  ser el **motor principal** y se renombra a `useVoiceRecorder` (ya no es
  "fallback"). La UX del botón cambia a **grabar → enviar en 2 clics**: el icono
  refleja la acción del PRÓXIMO clic (micrófono para empezar a grabar; icono
  "enviar" nuevo para parar la grabación y subir el audio a Groq); durante la subida
  el botón queda ocupado (`aria-busy`) con `voice.transcribingLabel`.

- **Qué se ELIMINA:** `frontend/src/voice/useVoiceInput.ts` y su test
  `useVoiceInput.test.ts`; toda la UX nativa en `NameField` (toggle isListening,
  `listeningLabel` como estado en vivo, `voiceUnavailable`, `interimResults`,
  no-speech sintético, ocultar/deshabilitar mic por soporte). Los tests de
  `voice_ux`/`voice_reliability` que afirman sobre esos comportamientos se retiran
  con justificación (§4.4).

- **Qué se CONSERVA sin cambios:** el endpoint backend `POST /voice/transcribe`
  (Groq, multer, rate-limit; commit 1808940), la capa de red
  `frontend/src/api/transcribeVoice.ts`, y el schema de marca `voice.*` (mismas
  claves; se evalúa 1 clave nueva de aria en §3, marcada como gate).

- **Por qué motor único (revierte el ADR 22):** el valor de tener dos motores
  (nativo gratis/instantáneo en Chrome/Safari) no compensa el "baile" de la 1ª
  pulsación en Brave ni la complejidad de orquestar dos hooks en `NameField`. Un
  motor único da **comportamiento idéntico y predecible** en los 4 navegadores; la
  presentación (grabar→enviar) es explícita y no depende de detectar soporte en
  caliente.

- **Trade-off aceptado (explícito):** Chrome/Safari **ahora también** dependen de
  Groq + backend + `GROQ_API_KEY` + red en el camino **común** (antes solo
  Firefox/Brave). Se pierden los parciales en vivo (`interimResults`) y la latencia
  sube de ~0 a cientos de ms + red. A cambio: cero baile, un solo camino de código,
  UX uniforme. El evaluador puede quedarse sin dictado si el backend/Groq caen — el
  **input manual sigue siendo el camino garantizado** (mitiga el riesgo).

- **Supersede:** la parte del ADR 22 sobre arquitectura de fallback (nativo
  preferente); las features `voice_ux` y `voice_reliability` (UX nativa completa),
  y la orquestación nativo↔fallback de `voice_universal`. El endpoint y la decisión
  Groq/Whisper del ADR 22 **siguen vigentes**.

---

## 2. Máquina de estados del botón (grabar → enviar)

El motor `useVoiceRecorder` ya expone la máquina correcta (renombrado de
`useVoiceFallback`, sin cambios de lógica): `status ∈ idle | recording |
transcribing | error`, más `isRecording`, `isTranscribing`, `errorCode`, `start()`,
`stop()`. El botón de `NameField` mapea **1:1** ese estado a icono + texto + acción.

| Estado (`status`) | Icono            | aria-label del botón            | aria-busy | Región de estado (bajo el input) | Clic dispara |
|-------------------|------------------|---------------------------------|-----------|----------------------------------|--------------|
| `idle`            | **micrófono**    | `voice.startLabel`              | `false`   | (vacía)                          | `start()` → graba |
| `recording`       | **enviar** (nuevo)| `voice.listeningLabel`         | `false`   | `voice.listeningLabel`           | `stop()` → sube a Groq |
| `transcribing`    | **enviar** (nuevo, atenuado) | `voice.transcribingLabel` | `true` | `voice.transcribingLabel`       | (deshabilitado) |
| `error`           | **micrófono**    | `voice.startLabel`              | `false`   | texto de error de marca (§3.3)   | `start()` → reintenta |

Notas de mapeo:
- **El icono refleja la acción del PRÓXIMO clic:** en `idle` se ofrece "grabar"
  (micrófono); en `recording` se ofrece "enviar" (avión de papel). Es el cambio
  central de UX vs. el toggle anterior.
- **`recording` reusa `voice.listeningLabel`** como aria-label y como texto de la
  región de estado: "Escuchando…" describe fielmente que el mic está capturando. No
  hace falta clave nueva para "grabando".
- **`transcribing`** deshabilita el botón (`disabled` + `aria-busy="true"`) para que
  un 2º clic no dispare otra grabación mientras sube; el clic no hace nada.
- **`error`** vuelve a `idle` visualmente (icono micrófono, `startLabel`) y muestra
  el texto de error en la región `role="status"`; el siguiente clic reintenta con
  `start()`. El motor ya deja `status='error'` con `errorCode` y `start()` es
  idempotente.
- **Sin `aria-pressed`:** ya no es un toggle de "activado/desactivado" (nativo), es
  un flujo lineal de 2 pasos. Se elimina `aria-pressed` del botón; el estado lo
  comunica el icono + aria-label + aria-busy. (Los tests viejos que afirmaban
  `aria-pressed` se retiran, §4.4.)

### 2.1 Casos de error (mapeados por el motor `useVoiceRecorder`, sin cambios)

| Situación                              | `errorCode`        | Texto de marca mostrado (`role="status"`) |
|----------------------------------------|--------------------|-------------------------------------------|
| Permiso de micrófono denegado (getUserMedia) | `permission-denied` | `voice.permissionDenied`             |
| Silencio (Groq devuelve `text === ''`) | `no-audio`         | `voice.noSpeech`                          |
| Red caída / backend inaccesible (ApiError status 0) | `network` | `voice.genericError`                 |
| 500 del backend (p.ej. `GROQ_API_KEY` ausente en el server) | `unknown` | `voice.genericError`      |

El motor ya distingue estos códigos (ver `useVoiceFallback.ts` actual: `network`
solo si `ApiError.status === 0`; cualquier otro HTTP no-ok cae a `unknown`). El
500-sin-key resuelve como `unknown` → `voice.genericError`, coherente con "hubo un
problema con el dictado, escribe tu nombre". **Sin cambios en el motor.**

---

## 3. Tokens y textos de marca

Cero literales/hex: todos los textos salen de `voice.*` de la marca activa
(`brand/core/schema.ts`), los colores de tokens Tailwind (`text-brand-primary`,
`text-brand-accent`), el icono usa `stroke="currentColor"`.

### 3.1 Claves de marca reutilizadas (ya existen, cero cambio de schema)

- `voice.startLabel` — aria-label del botón en `idle`/`error` (icono micrófono).
- `voice.listeningLabel` — aria-label + región de estado en `recording` (icono enviar).
- `voice.transcribingLabel` — aria-label + región de estado en `transcribing`.
- `voice.permissionDenied` / `voice.noSpeech` / `voice.genericError` — errores.

### 3.2 Claves que DEJAN de usarse (no se borran del schema)

- `voice.unsupported` — sin motor nativo no hay concepto de "navegador no soportado"
  (getUserMedia/MediaRecorder están en los 4). Se deja en el schema con su
  `.default()` (borrarla sería un cambio de schema innecesario y rompería marcas que
  la traigan), pero **ningún componente la consume**.
- `voice.lang` — el idioma lo fija el backend (`language: 'es'` en el service Groq).
  Se deja en el schema; `NameField` ya no lo pasa a ningún hook.

### 3.3 ¿Clave de texto NUEVA? — decisión y GATE

**Recomendación: NO añadir clave nueva.** El flujo grabar→enviar se cubre con las
claves existentes:
- "grabando" → `voice.listeningLabel` (el mic está escuchando: descripción fiel).
- "enviando/transcribiendo" → `voice.transcribingLabel` (ya existe).

El único texto sin cobertura literal sería un aria-label específico del icono
"enviar" tipo "Enviar y transcribir". **Se descarta** porque `voice.listeningLabel`
ya comunica el estado y el icono es `aria-hidden`; añadir "sendLabel" infla el
schema para un matiz que la región `role="status"` ya cubre. Se sigue la regla de
minimalismo (reusar antes que crear).

> **GATE:** si en review de accesibilidad se concluye que el aria-label en
> `recording` DEBE decir "enviar" (no "escuchando") para no confundir al lector de
> pantalla, entonces se añade **una** clave `voice.sendLabel: z.string()
> .default('Enviar y transcribir')` con su `.default()` — decisión de gate humano,
> no supuesto del implementer. Diseño base: **sin clave nueva**.

### 3.4 Icono "enviar" — SVG inline nuevo (se verifica visualmente)

Mismo patrón que el micrófono actual en `NameField.tsx`: `<svg viewBox="0 0 24 24"
fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">` con `<path>`. **Nada
de librería de iconos.**

- **Forma: avión de papel** (paper plane), la metáfora universal de "enviar". Es un
  triángulo/cometa apuntando arriba-derecha con la línea de pliegue interior.
- Path de referencia para el implementer (silueta avión de papel, estilo outline
  coherente con el mic de trazo):
  `<path d="M22 2 11 13" />` (línea diagonal interior) y
  `<path d="M22 2 15 22 11 13 2 9 22 2z" />` (contorno del avión).
  El implementer ajusta los puntos para que quede centrado en el viewBox 24×24 y
  con el mismo peso visual que el micrófono; **debe renderizarlo con `qlmanage -t`
  y revisar el PNG** (los cambios de SVG no los cubren los tests — memoria
  "Verificar SVG visualmente").
- El icono se elige por estado: `idle`/`error` → micrófono; `recording`/
  `transcribing` → avión de papel. Ambos con `text-brand-*` según estado (idle:
  `text-brand-primary`; recording/transcribing: `text-brand-accent`).

---

## 4. Reorganización de archivos (concreta, para el implementer)

### 4.1 Se BORRA

- `frontend/src/voice/useVoiceInput.ts` — motor nativo Web Speech. **GATE:** borrar
  trabajo `done` (voice_capture); ver §6.
- `frontend/src/voice/useVoiceInput.test.ts` — su test. Se retira entero (§4.4).

### 4.2 Se RENOMBRA (motor principal, ya no "fallback")

- `frontend/src/voice/useVoiceFallback.ts` → `frontend/src/voice/useVoiceRecorder.ts`
- `frontend/src/voice/useVoiceFallback.test.ts` → `useVoiceRecorder.test.ts`
- Símbolos: `useVoiceFallback` → `useVoiceRecorder`; tipos `FallbackStatus` →
  `RecorderStatus`, `FallbackErrorCode` → `RecorderErrorCode`,
  `UseVoiceFallbackOptions/Result` → `UseVoiceRecorderOptions/Result`.
- **Lógica interna sin cambios:** getUserMedia → MediaRecorder → `transcribeVoice`
  → `onResult`, máquina idle/recording/transcribing/error, clamp lo aplica
  `NameField`, auto-stop de 10 s, liberación de micrófono en stop/unmount. Todo se
  conserva; solo cambia el nombre y los comentarios (quitar "hermano del nativo" /
  "fallback"). `transcribeVoice.ts` (§ importa `transcribe`) queda **igual**.

> El motor renombrado ya no debe importar nada de `useVoiceInput` (hoy
> `useVoiceFallback.ts` **no** lo importa — el listado de 9 archivos lo señalaba por
> precaución; verificado: no hay import cruzado). Confirmar en implementación.

### 4.3 `NameField.tsx` — reescritura

Queda de un solo motor con flujo grabar→enviar. Estructura resultante:

- Importa solo `useVoiceRecorder` (elimina el import de `useVoiceInput` y toda la
  rama `native`/`useFallback`/`nativeAvailable`).
- `const recorder = useVoiceRecorder({ onResult: applyName });` (sin `lang`).
- `applyName` = `onChange(clampToMax(transcript))` — **sin cambios** (clamp de 15).
- Deriva del `recorder.status`:
  - `isRecording = recorder.isRecording`
  - `isTranscribing = recorder.isTranscribing`
  - `errorText` = si `status === 'error' && errorCode` → `recorderErrorText(code)`
    (mismo switch que el `fallbackErrorText` actual: permission-denied→permissionDenied,
    no-audio→noSpeech, resto→genericError).
- **Icono por estado:** micrófono si `!isRecording && !isTranscribing`; avión de
  papel en otro caso.
- **aria-label:** `transcribing` → `transcribingLabel`; `recording` →
  `listeningLabel`; resto → `startLabel`.
- **Botón:** `disabled={isTranscribing}`, `aria-busy={isTranscribing}`, **sin**
  `aria-pressed`. `onClick`:
  ```
  if (isTranscribing) return;
  if (isRecording) recorder.stop(); else recorder.start();
  ```
- **Región de estado** (bajo el input): `transcribing` → `transcribingLabel`;
  `recording` → `listeningLabel`; resto → placeholder vacío `aria-hidden`.
- **Contador** y **región `role="status"` de error**: sin cambios estructurales.
- El botón de mic **siempre se renderiza** (ya no se oculta por soporte): Grabar
  está disponible en todos los navegadores.

### 4.4 Limpieza de imports/mocks en tests que sobreviven

- `frontend/src/App.test.tsx` — cambia `vi.mock('./voice/useVoiceInput', …)` por
  `vi.mock('./voice/useVoiceRecorder', …)` devolviendo la forma del recorder
  (`{ status:'idle', isRecording:false, isTranscribing:false, errorCode:null,
  start, stop }`). Elimina campos nativos (`isSupported`, `isListening`,
  `transcript`).
- `frontend/src/features/welcome/WelcomeScreen/WelcomeScreen.test.tsx` — mismo
  cambio de mock (de `useVoiceInput` a `useVoiceRecorder`, forma del recorder). El
  resto del test de WelcomeScreen (flujo/textos de marca) no toca voz → intacto.
- `NameField.fallback.test.tsx` → se **renombra/reescribe** como el nuevo test de
  NameField (§5.2): pasa a mockear **solo** `useVoiceRecorder` (un motor), y sus
  casos N1-N3 (elegir fuente nativo↔fallback) **se retiran** (ya no hay dos fuentes).

### 4.5 Tests que se RETIRAN (con justificación — GATE de borrado de `done`)

> **GATE:** retirar tests de features `done` (`voice_capture`, `voice_ux`,
> `voice_reliability`) requiere OK humano; ver §6.

- **`useVoiceInput.test.ts` — entero.** El motor nativo se elimina; su suite ya no
  aplica. Justificación: ADR 23 (motor único Groq).
- En **`NameField.test.tsx`**, se retiran los bloques que afirman sobre la máquina
  nativa, porque describen comportamiento eliminado:
  - `aria-pressed` del botón (casos 3, 4) — ya no es toggle.
  - `voiceUnavailable` / `isSupported` como ejes de decisión (B11, B12, N-*) —
    ya no hay detección de soporte ni latch de network.
  - "sin soporte degrada / mic para el fallback" (casos 13, 14, B11, y el de
    white-label de no-soporte) — ya no hay "no-soporte" (un solo motor universal).
  - no-speech **sintético** del nativo (parte de B14 asociada a Web Speech) — el
    no-audio ahora viene solo del motor Groq (`no-audio` → `noSpeech`), que el
    nuevo test cubre.
  Se **conservan** (portados al motor Groq): contador 0/15, interpolación
  `counterTemplate`, escribir propaga a onChange, `maxLength=15`, clamp de la
  transcripción a 15, dictado rellena el mismo estado, placeholder de marca,
  aria-label de marca, errores→texto de marca en `role="status"`, y white-label
  con otra marca.
- **`NameField.fallback.test.tsx`** N1/N2/N3 (elegir motor) se retiran; N4-N7
  (clamp del recorder, transcribing/aria-busy, errores del recorder, input manual)
  se **portan** al nuevo test como comportamiento del motor único.

---

## 5. Plan de tests (RED primero) — todo mockeado, cero red/API real

### 5.1 `useVoiceRecorder.test.ts` (portado de `useVoiceFallback.test.ts`)

Mismo enfoque: mockear el borde (`navigator.mediaDevices.getUserMedia`,
`MediaRecorder`), inyectar `transcribe`, timers falsos para el auto-stop. Casos:

- **R1** `start()` en idle → `getUserMedia` + `MediaRecorder.start`, `status` pasa a
  `recording` (`isRecording === true`).
- **R2** `stop()` en recording → dispara `onstop` → `status` pasa a `transcribing`,
  llama `transcribe(blob)`; al resolver con texto no vacío → `onResult(texto)` y
  vuelve a `idle`.
- **R3** permiso denegado: `getUserMedia` rechaza → `status='error'`,
  `errorCode='permission-denied'`; no queda micrófono abierto.
- **R4** red caída: `transcribe` rechaza con `ApiError(status 0)` → `status='error'`,
  `errorCode='network'`.
- **R5** silencio: `transcribe` resuelve `''` → `status='error'`,
  `errorCode='no-audio'`, `onResult` NO llamado (no ensucia el nombre).
- **R6** auto-stop: pasado el tope (~10 s con timers falsos) para solo y transcribe.
- **R7** libera el micrófono (track.stop) en stop y en unmount.

(Estos ya existen para `useVoiceFallback`; el tester los porta con el nuevo nombre
y confirma que siguen en verde tras el rename — es refactor de nombre, no de lógica.
El RED puro es solo por "módulo `./useVoiceRecorder` no existe" hasta el rename.)

### 5.2 `NameField.test.tsx` (motor único, flujo grabar→enviar) — RED

Mockea **solo** `useVoiceRecorder` (`vi.hoisted` con `status`, `isRecording`,
`isTranscribing`, `errorCode`, `start`, `stop`, y captura de `onResult`). Todo se
observa por rol/aria/texto de marca — nunca por clase CSS ni literal.

- **F1 (clic 1: graba)** idle: pulsar el botón (aria-label `startLabel`) llama
  `recorder.start()` una vez, no `stop()`.
- **F2 (icono cambia a enviar)** con `status='recording'`/`isRecording=true`: el
  botón expone aria-label `listeningLabel` (el icono enviar se afirma indirectamente
  por el cambio de aria-label; el SVG en sí se valida visualmente, §3.4).
- **F3 (clic 2: para + envía)** recording: pulsar el botón (aria-label
  `listeningLabel`) llama `recorder.stop()` una vez, no `start()`.
- **F4 (transcribing)** `status='transcribing'`/`isTranscribing=true`: se muestra
  `voice.transcribingLabel` en pantalla, el botón tiene `aria-busy="true"` y está
  `disabled`; pulsar no llama `start()` ni `stop()`.
- **F5 (error visible)** `status='error'` + cada `errorCode`:
  `permission-denied→permissionDenied`, `no-audio→noSpeech`,
  `network→genericError`, `unknown→genericError`, en `role="status"`.
- **F6 (idle sin error)** ningún texto de error de voz presente; el botón vuelve al
  aria-label `startLabel`.
- **F7 (clamp 15)** `recorder.onResult('NombreLarguisimoDeMas...')` (>15) →
  `onChange` recibe exactamente 15 chars; `onResult('Lucía')` → `onChange('Lucía')`.
- **F8 (input manual intacto)** escribir 'A' → `onChange('A')`; `maxLength=15` en el
  DOM; funciona en cualquier estado del recorder.
- **F9 (contador)** inicial `0/15 caracteres` desde `counterTemplate`; con valor
  'Ana' → `3/15 caracteres`.
- **F10 (white-label)** con OTRA marca (textos de voz distintos): aria-label,
  etiqueta de estado y texto de error se observan por los textos de ESA marca; no se
  filtran los de shopinbaz.
- **F11 (mic siempre presente)** el botón de mic (aria-label `startLabel`) se
  renderiza en idle en cualquier navegador (ya no se oculta por soporte).

### 5.3 Sin dependencia de red/API real

`transcribeVoice`/`fetch` se inyectan o mockean; `getUserMedia`/`MediaRecorder` son
dobles; el backend Groq nunca se toca en tests. Igual que hoy.

---

## 6. Seguridad

- **Sin cambios respecto al commit 1808940:** `GROQ_API_KEY` vive solo en el
  backend (Parameter Store en prod, Zod opcional al boot), nunca en el bundle ni el
  repo. El front sube audio multipart a `POST /voice/transcribe`; no ve la key.
- **Cambio de superficie a auditar:** ahora **todo** dictado pasa por el backend
  (antes solo Firefox/Brave). Consecuencias que el **security-auditor** debe revisar:
  - El **rate-limit** del endpoint (ya existente) y el **coste** del free tier Groq
    (2.000 req/día) aplican ahora a **todos** los usuarios/navegadores → más tráfico.
    Verificar que el límite por IP sigue siendo razonable y que no abre un vector de
    abuso nuevo (subida masiva de audio). El límite de tamaño de multer y el
    auto-stop de 10 s ya acotan el tamaño por request.
  - Confirmar que un 500 (p.ej. key ausente en el server) **no filtra** detalle
    sensible al front (el front solo mapea a `voice.genericError`).
- **Input manual** sigue siendo el camino garantizado si el backend/Groq caen: la
  captura por voz nunca es requisito para completar el formulario.

---

## 7. Puntos de gate de aprobación humana (resumen)

1. **ADR 23** — revierte una decisión previa (ADR 22, arquitectura de fallback).
   El leader lo presenta antes de arrancar el RED.
2. **Borrado de trabajo `done`** — eliminar `useVoiceInput.ts` + `useVoiceInput.test.ts`
   y retirar los tests de `voice_ux`/`voice_reliability` sobre isListening/
   voiceUnavailable/aria-pressed/ocultar-mic/no-speech-sintético (§4.5).
3. **Clave de texto nueva** — el diseño base **no** añade ninguna; si review de a11y
   exige un aria-label "enviar", `voice.sendLabel` con `.default()` es decisión de
   gate, no supuesto del implementer (§3.3).

---

## 8. Alternativas consideradas

- **(A) Mantener dos motores y arreglar solo el "baile"** (probar Groq en
  background la 1ª vez). Descartada: no se puede saber a priori si un Chromium tiene
  el servicio de Google; cualquier heurística sigue siendo probabilística y mantiene
  dos caminos de código. El usuario ya decidió motor único.
- **(B) Botón toggle de 1 clic con Groq** (grabar/parar como el nativo, subir al
  parar). Descartada frente a grabar→enviar explícito: el flujo de 2 clics con icono
  que anticipa la acción comunica mejor "ahora grabo / ahora envío" y evita subir
  audio por un parón accidental; además el estado `transcribing` necesita de todos
  modos su propio icono/ocupado.
- **(C, elegida) Motor único Groq + grabar→enviar en 2 clics**, icono por estado
  (micrófono → avión de papel), `transcribing` con `aria-busy`. Coherente con la
  decisión del usuario y con el motor `useVoiceRecorder` ya existente (solo renombre).

## 9. Recomendación

Implementar la opción **C**: renombrar `useVoiceFallback` → `useVoiceRecorder` (sin
tocar su lógica), reescribir `NameField` a un solo motor con flujo grabar→enviar +
icono avión de papel inline, eliminar `useVoiceInput` y su test, limpiar los mocks
en App/WelcomeScreen, y retirar los tests nativos con la justificación del ADR 23.
Sin clave de texto nueva salvo que a11y lo exija (gate). Backend intacto.

## 10. Criterios de aceptación traducibles a tests

1. `NameField` importa **solo** `useVoiceRecorder`; no queda referencia a
   `useVoiceInput` en `frontend/src` (grep vacío).
2. Botón en **idle**: aria-label = `voice.startLabel`, icono micrófono; clic →
   `recorder.start()`.
3. Botón en **recording**: aria-label = `voice.listeningLabel`; clic →
   `recorder.stop()` (sube el audio).
4. Botón en **transcribing**: `aria-busy="true"`, `disabled`, muestra
   `voice.transcribingLabel`; clic no dispara start/stop.
5. Botón **sin** `aria-pressed` (ya no es toggle).
6. Errores del motor → texto de marca en `role="status"`:
   `permission-denied→permissionDenied`, `no-audio→noSpeech`,
   `network→genericError`, `unknown→genericError`.
7. La transcripción (`recorder.onResult`) se recorta a 15 antes de `onChange`;
   rellena el mismo estado que el input manual.
8. Input manual: `maxLength=15` en el DOM, escribir propaga a `onChange`, funciona
   en cualquier estado del recorder.
9. Contador `0/15 caracteres` desde `counterTemplate`; `3/15` con 'Ana'.
10. White-label: con otra marca, aria-label/estado/error salen de ESA marca; cero
    literales/hex en el componente.
11. El botón de mic se renderiza siempre en idle (no se oculta por soporte).
12. `useVoiceRecorder` (renombrado): start→recording, stop→transcribing→onResult;
    permiso denegado→error/permission-denied; red→error/network;
    silencio→error/no-audio (sin onResult); libera micrófono en stop/unmount.
13. Icono "enviar" = SVG inline (avión de papel, `currentColor`, tokens de marca),
    sin librería de iconos — **verificado visualmente con `qlmanage -t`**.
14. Backend `POST /voice/transcribe` sin cambios; `GROQ_API_KEY` solo en el
    servidor; el front nunca la ve.
15. Tests retirados (`useVoiceInput.test.ts` entero; casos nativos de
    NameField/fallback) documentados con la justificación del ADR 23; la suite
    restante pasa en verde tras el rework.
