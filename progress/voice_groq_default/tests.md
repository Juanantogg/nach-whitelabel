# tests.md — voice_groq_default (fase RED)

REWORK de voz (ADR 23): Groq pasa a ser el **motor de voz único**; se elimina el
motor nativo (Web Speech / `useVoiceInput`) y la orquestación nativo↔fallback. El
hook `useVoiceFallback` se renombra a `useVoiceRecorder` (misma lógica). El botón
de `NameField` cambia a un flujo **grabar → enviar en 2 clics**, sin `aria-pressed`.

Fuente de verdad: `design.md` §2 (máquina de estados), §4 (reorganización de
archivos), §5 (plan de tests), §10 (criterios de aceptación).

## Archivos de test — nuevo estado

### Nuevos / renombrados

- **`frontend/src/voice/useVoiceRecorder.test.ts`** (NUEVO — renombrado de
  `useVoiceFallback.test.ts`). Portada 1:1 de la suite del motor con símbolos
  actualizados (`useVoiceFallback`→`useVoiceRecorder`; `H1-H7`→`R1-R7`). Mockea el
  borde (`getUserMedia`, `MediaRecorder`), inyecta `transcribe`, timers falsos.
  Cubre (design §5.1):
  - **R1** `start()` en idle → `getUserMedia({audio:true})` + `MediaRecorder.start`;
    `status='recording'`, `isRecording=true`.
  - **R2** `stop()` → `onstop` → `status='transcribing'`, llama `transcribe(blob)`;
    al resolver texto no vacío → `onResult('Ana')` y vuelve a `idle`.
  - **R3** permiso denegado (`getUserMedia` rechaza) → `status='error'`,
    `errorCode='permission-denied'`; `transcribe` no se llama.
  - **R4** red caída (`transcribe` rechaza `ApiError(0)`) → `errorCode='network'`;
    `onResult` no se llama.
  - **R5** silencio (`transcribe` resuelve `''`) → `errorCode='no-audio'`;
    `onResult` NO se llama (no ensucia el nombre con vacío).
  - **R6** auto-stop tras `MAX_RECORDING_MS` → para solo y transcribe.
  - **R7** cleanup en unmount libera los tracks del stream.

- **`frontend/src/features/welcome/NameField/NameField.test.tsx`** (REESCRITO).
  Mockea **solo** `useVoiceRecorder` (un motor). Cubre el flujo grabar→enviar
  (design §5.2, F1-F11):
  - **F1** idle: clic → `recorder.start()` ×1, no `stop()`.
  - **F2** recording: el botón expone `aria-label=listeningLabel` (icono "enviar"),
    NO `startLabel`; y muestra `listeningLabel` bajo el input.
  - **F3** recording: clic → `recorder.stop()` ×1, no `start()`.
  - **F4** transcribing: muestra `voice.transcribingLabel`, botón `aria-busy="true"`
    + `disabled`; clic no dispara `start`/`stop`.
  - **F5** errores en `role="status"`: `permission-denied→permissionDenied`,
    `no-audio→noSpeech`, `network→genericError`, `unknown→genericError`; en error el
    botón vuelve a `startLabel` (reintento).
  - **F6** idle sin error: ningún texto de error de voz; botón en `startLabel`;
    `listeningLabel` no visible.
  - **F7** clamp 15: `onResult('NombreLarguísimoDeMás')` → `onChange` con 15 chars;
    `onResult('Lucía')` → `onChange('Lucía')`.
  - **F8** input manual: escribir propaga a `onChange`; `maxLength=15` en el DOM;
    funciona también con el recorder en `transcribing`.
  - **F9** contador `0/15 caracteres` inicial; `3/15 caracteres` con 'Ana'.
  - **F10** white-label: con OTRA marca, aria-label / etiqueta de estado /
    transcribingLabel / texto de error salen de ESA marca; no filtra shopinbaz.
  - **F11** el botón de mic (idle, `startLabel`) se renderiza siempre (no se oculta
    por soporte).
  - **Sin `aria-pressed`**: se afirma explícitamente que el botón no expone
    `aria-pressed` ni en idle ni en recording (design §2, criterio #5).

  El icono "enviar" es SVG `aria-hidden` → se afirma por el **aria-label/estado del
  botón**, nunca por su `path` (design §3.4; se valida visualmente en GREEN con
  `qlmanage -t`).

### Ajustados para seguir compilando (solo cambia el mock de voz)

- **`frontend/src/App.test.tsx`** — el mock pasa de `./voice/useVoiceInput` a
  `./voice/useVoiceRecorder` con la forma del recorder (`status/isRecording/
  isTranscribing/errorCode/start/stop`). Aserciones intactas. **Verde.**
- **`frontend/src/features/welcome/WelcomeScreen/WelcomeScreen.test.tsx`** — mismo
  cambio de mock (`useVoiceInput`→`useVoiceRecorder`). El resto (flujo/textos de
  marca, multi-marca, fallback de assets) no toca voz → intacto. **Verde.**

### Retirados (con justificación — GATE de borrado de trabajo `done`)

- **`frontend/src/voice/useVoiceInput.test.ts` — borrado entero.** El motor nativo
  Web Speech se elimina (ADR 23: motor único Groq). Su suite (soporte/no-soporte,
  parciales, no-speech sintético, latch `voiceUnavailable`) describe comportamiento
  que ya no existe.
- **`frontend/src/voice/useVoiceFallback.test.ts` — borrado (renombrado).** Su
  contenido se reencarna en `useVoiceRecorder.test.ts` con los símbolos nuevos.
- **`frontend/src/features/welcome/NameField/NameField.fallback.test.tsx` —
  borrado.** Su razón de ser era la **orquestación nativo↔fallback** (N1-N3: elegir
  fuente), que desaparece con el motor único. Sus casos válidos se **reencarnan** en
  el nuevo `NameField.test.tsx`: N4 (clamp del recorder) → F7; N5 (transcribing +
  aria-busy) → F4; N6 (errores del recorder en `role="status"`) → F5; N7 (input
  manual intacto) → F8.
- **Dentro del viejo `NameField.test.tsx`** (reescrito), se retiraron las
  aserciones sobre comportamiento eliminado: `aria-pressed` como toggle,
  `isSupported`/`voiceUnavailable` como ejes de decisión, "ocultar/degradar mic por
  no-soporte", y el no-speech **sintético** del nativo. Se conservaron (portados al
  motor único): contador, `maxLength=15`, input manual, clamp de la transcripción,
  placeholder de marca, aria-label de marca, errores→texto de marca, white-label.

## Evidencia del RED

`pnpm --filter @nach/frontend test --run`:

```
❯ src/features/welcome/NameField/NameField.test.tsx (28 tests | 16 failed)
 FAIL  src/voice/useVoiceRecorder.test.ts [ src/voice/useVoiceRecorder.test.ts ]

 Test Files  2 failed | 21 passed (23)
      Tests  16 failed | 180 passed (196)
```

### Por qué fallan (razón correcta, no error de setup del test)

1. **`useVoiceRecorder.test.ts` (suite entera en rojo)** — falla al resolver el
   import:
   ```
   Error: Failed to resolve import "./useVoiceRecorder" from
   "src/voice/useVoiceRecorder.test.ts". Does the file exist?
   ```
   El módulo `useVoiceRecorder.ts` aún no existe; el implementer lo crea renombrando
   `useVoiceFallback.ts` en el GREEN. RED puro por módulo ausente.

2. **`NameField.test.tsx` (16 de 28 en rojo)** — el componente actual todavía
   importa `useVoiceInput`/`useVoiceFallback` y mantiene el flujo viejo (toggle +
   `aria-pressed` + ocultar mic). Los 16 tests nuevos mockean `useVoiceRecorder`
   —que el componente aún no consume— y afirman el flujo grabar→enviar. Ejemplo:
   ```
   AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
     idle: pulsar el botón (startLabel) llama recorder.start() una vez y no stop()
   ```
   `recorderMock.start` recibe 0 llamadas porque el componente aún cablea el motor
   viejo. RED **behavioral** (comportamiento nuevo ausente), no error de sintaxis.
   Los 12 tests verdes de esta suite son las conductas ya presentes en el
   componente viejo (contador, `maxLength`, input manual, placeholder, botón idle
   `startLabel`, mic presente, idle-sin-error) — los casos **portados** que siguen
   pasando por diseño (§4.5).

3. **Suites NO-voz siguen VERDES** (21 archivos passed): cifrado, contador
   consecutivo, brand/theming, welcome flujo (`WelcomeScreen.test.tsx`), `App`
   (cableado). El cambio de mock (`useVoiceInput`→`useVoiceRecorder`) mantiene App y
   WelcomeScreen en verde.

### Typecheck (RED esperado, coherente con el punto 1)

`pnpm --filter @nach/frontend typecheck`:
```
src/voice/useVoiceRecorder.test.ts(34,34): error TS2307: Cannot find module
'./useVoiceRecorder' or its corresponding type declarations.
```
Es el **mismo** RED por módulo ausente. Se resuelve automáticamente cuando el
implementer renombra `useVoiceFallback.ts`→`useVoiceRecorder.ts` en el GREEN. No
hay forma de tener un test rojo-por-módulo-inexistente que a la vez typecheque
verde; es inherente a este RED de renombre.

## Para el implementer (GREEN)

Archivos de **producción** a crear / renombrar / borrar:

- **RENOMBRAR** `frontend/src/voice/useVoiceFallback.ts` →
  `frontend/src/voice/useVoiceRecorder.ts`, con símbolos:
  `useVoiceFallback`→`useVoiceRecorder`; `FallbackStatus`→`RecorderStatus`;
  `FallbackErrorCode`→`RecorderErrorCode`; `UseVoiceFallbackOptions/Result`→
  `UseVoiceRecorderOptions/Result`. **Lógica interna sin cambios** (design §4.2).
- **BORRAR** `frontend/src/voice/useVoiceInput.ts` (motor nativo). Revisar si
  `speech-recognition.d.ts` queda huérfano (ya no lo usa nadie) → candidato a borrar.
- **REESCRIBIR** `frontend/src/features/welcome/NameField/NameField.tsx` a un solo
  motor con flujo grabar→enviar (design §4.3): importar solo `useVoiceRecorder`,
  icono por estado (micrófono ⇄ avión de papel SVG inline nuevo, `currentColor`,
  tokens de marca), aria-label por estado, `disabled`/`aria-busy` en transcribing,
  **sin** `aria-pressed`, mic siempre presente. Verificar el SVG "enviar"
  visualmente con `qlmanage -t` (memoria "Verificar SVG visualmente").
- Confirmar `grep -rn useVoiceInput frontend/src` vacío tras el rework
  (criterio #1).

Backend intacto (`POST /voice/transcribe`); `transcribeVoice.ts` intacto.
