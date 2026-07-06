# Review — voice_groq_default

**Veredicto:** APPROVED

`./init.sh full` en verde: lint + typecheck + frontend 203/203 + backend 53/53 +
build + smoke. REFACTOR limpio, sin cambios requeridos.

## Checklist

- **TDD:** [x] — RED documentado (`tests.md`: 16/28 NameField en rojo + suite
  `useVoiceRecorder` sin módulo; GREEN restaura). Los tests portados/reescritos no
  se relajaron: siguen afirmando por rol/aria/texto de marca, nunca por clase CSS
  ni `path` del SVG. Retirada de tests nativos (`useVoiceInput.test.ts`,
  `NameField.fallback.test.tsx`) justificada por ADR 23 y con gate humano
  (`requires_approval: true`). Implementación mínima: el hook es un rename 1:1 sin
  tocar lógica; `NameField` mapea 1:1 la máquina de estados. Sin sobre-ingeniería.

- **White-label:** [x] — Cero hex y cero literales en `NameField.tsx` (grep vacío).
  Todos los textos vienen de `voice.*` (`startLabel`/`listeningLabel`/
  `transcribingLabel`/`permissionDenied`/`noSpeech`/`genericError`) y `text.*`
  (`inputPlaceholder`, `counterTemplate`). Colores por tokens
  (`text-brand-primary`/`text-brand-accent`/`text-brand-muted`/`border-brand-*`).
  Ambos SVG con `stroke="currentColor"` + `aria-hidden="true"`. CERO clave nueva:
  "grabando" reusa `listeningLabel` (design §3.3, sin gate a11y disparado).
  Contador "0/15" + límite 15 (`maxLength` + `clampToMax`) presentes. Añadir marca
  no requiere editar el componente.

- **Backend:** [x] (N/A) — Feature de frontend. `POST /voice/transcribe` y
  `transcribeVoice.ts` intactos; `GROQ_API_KEY` sigue solo en backend, el front
  nunca la ve. Smoke de runtime del backend en verde.

- **Calidad:** [x] — Sin `any`/`as any` ni `console.*` en producción (grep vacío).
  Sin dependencias nuevas (SVG inline, sin librería de iconos). No reimplementa
  nada: reutiliza `ApiError`, `transcribeVoice`, `useBrand`, `NAME_MAX_LENGTH`.
  Máquina de estados correcta (design §2): idle→micrófono/`startLabel`/`start()`;
  recording→enviar/`listeningLabel`/`stop()`; transcribing→`disabled`+
  `aria-busy="true"`+`transcribingLabel`+clic no-op; error→micrófono/`startLabel`+
  texto en `role="status"`. **Sin `aria-pressed`** (test lo afirma explícito).
  Accesibilidad: estado comunicado por `aria-label`+`aria-busy` (el icono es
  `aria-hidden`), región `role="status" aria-live="polite"` para errores, clamp de
  15 aplicado en `onResult` vía `applyName`.

## Verificaciones extra (encargo del leader)

1. **Código muerto / referencias colgantes:** grep en `frontend/src` de
   `useVoiceInput` / `SpeechRecognition` / `webkitSpeechRecognition` / `isListening`
   / `voiceUnavailable` / `aria-pressed` / `isSupported` → **sin coincidencias en
   producción**. Las únicas ocurrencias son docstrings de tests que describen el RED
   y el rename (aceptable, no es código). `useVoiceFallback` en producción: solo
   falsos positivos no-voz (`index.css`, `ErrorBoundary`, `config/env`,
   `resolveApiUrl` — la subcadena "Fallback"). `speech-recognition.d.ts` y
   `useVoiceInput.ts` borrados. No hay barrel en `voice/` → nada que reexporte
   símbolos eliminados.

2. **useVoiceRecorder (rename):** lógica conservada — libera tracks del mic en
   `stop`/`unmount` (`releaseStream` en `onstop` y en cleanup de `useEffect`),
   auto-stop a `MAX_RECORDING_MS` (10 s). Símbolos coherentes (`RecorderStatus`,
   `RecorderErrorCode`, `UseVoiceRecorderOptions/Result`). Sin restos de "fallback"
   ni "hermano del nativo" en comentarios de producción.

3. **Mocks App/WelcomeScreen:** migrados a `./voice/useVoiceRecorder` con la forma
   del recorder (`status/isRecording/isTranscribing/errorCode/start/stop`); campos
   nativos (`isSupported`/`isListening`/`transcript`) eliminados.

4. **Documentación:** ADR 23 en `docs/decisiones.md` con contexto→decisión→porqué→
   trade-off→supersede→alternativas; ADR 22 anotado como parcialmente superseded.
   `feature_list.json` coherente (features nativas con `superseded_by`/
   `superseded_note`; nueva feature con `decisions`).

## Nota informativa (no bloqueante)

- La etiqueta de estado en vivo (recording/transcribing) se rinde en un `<span>`
  sin `aria-live`; el estado sí se comunica por el `aria-label`+`aria-busy` del
  botón (design §2, criterio #4 — cumplido). El `role="status" aria-live="polite"`
  se reserva para errores, como especifica el diseño. Correcto tal cual; se anota
  solo por transparencia.
