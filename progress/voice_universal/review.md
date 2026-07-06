# Review — voice_universal (fase REFACTOR)

**Veredicto:** APPROVED

Feature EXTRA/stretch: dictado de voz FUNCIONAL en Firefox/Brave como FALLBACK
(no reemplazo) del Web Speech nativo, vía Groq `whisper-large-v3-turbo` por el
backend. Decisión en ADR 22. Todo el pipeline en verde.

## Checklist

- **TDD:** [x] — RED real registrado en `tests.md` (backend 9 fallos por 404/módulo
  ausente; frontend 10 fallos por imports/schema ausentes). El GREEN pasa los 21
  tests nuevos sin regresiones. Los 4 tests de `NameField.test.tsx` que se
  "actualizaron" NO son relajación: reflejan el cambio de spec de ADR 22 (aprobado
  por el usuario) que convierte el "ocultar mic" de voice_reliability en degradación
  funcional; la verificación fuerte de QUÉ hook dispara vive —con más fuerza— en
  N1/N2/N3 de `NameField.fallback.test.tsx` (mockean AMBOS hooks). Implementación
  mínima y sin código muerto.

- **White-label:** [x] — Cero literales de texto y cero hex/color en JSX. El estado
  `transcribing` usa `voice.transcribingLabel` (única clave nueva, con `.default()`
  → ninguna marca edita su JSON); errores reusan claves existentes
  (`permissionDenied`/`noSpeech`/`genericError`); colores solo tokens
  (`text-brand-accent`/`text-brand-primary`/`text-brand-muted`), animación con
  `motion-safe:`. N5/N6/SC1 lo cubren en test. El límite de 15 (`maxLength` +
  `clampToMax`) y el contador `{count}/{max}` se conservan.

- **Backend:** [x] — Capas `routes → controllers → services` respetadas. El service
  (`transcription.service.ts`) es la ÚNICA capa que conoce Groq (import de `groq-sdk`
  solo ahí, verificado). El controller no filtra detalle del proveedor: errores
  upstream → 502 `transcription_failed` genérico (B5 afirma que el body no contiene
  `groq`/`401`/key); falla-cerrado a 500 si falta la key ANTES de tocar el proveedor
  (B6). `app.ts` sigue testeable con Supertest; `/voice` montado con su propio limiter
  (mismo patrón que `/names`). `env.groqApiKey` es opcional y NO rompe el fail-fast de
  Mongo/clave privada. Clave solo desde env, nunca en código ni logs; ausente del
  bundle del front (grep de `frontend/dist` limpio). `smoke.ts` importa router+service
  reales (B8): cierra el hueco del import ESM roto de `groq-sdk`.

- **Calidad:** [x] — `./init.sh full` en verde: lint + typecheck OK, backend 53/53,
  frontend 248/248, build OK, smoke runtime OK. Sin `any` innecesarios, sin
  `console.log` de debug. Deps nuevas (`groq-sdk`, `multer`, `@types/multer`)
  aprobadas explícitamente en ADR 22. `transcribeVoice` reutiliza `ApiError` (status
  0 en red caída) sin duplicar la lógica de `client.ts`; no fija `Content-Type`
  manual (deja el boundary del multipart al navegador). El `useVoiceFallback` libera
  los tracks del micrófono en `stop`, en auto-stop (`MAX_RECORDING_MS`) Y en unmount
  (H7); ambos hooks se llaman siempre (sin llamadas condicionales). El clamp de 15 es
  una sola `applyName` compartida por nativo y fallback. Sin abstracción prematura.

- **Documentación:** [x] — ADR 22 en `docs/decisiones.md` con contexto/decisión/
  por-qué-fallback/alternativas descartadas (transformers.js, Transcribe, OpenAI).
  Research en `progress/voice_universal/research.md`.

## Desviación respecto al diseño (justificada y correcta)

- `transcription.service.ts` usa `new File([audio], 'voice.webm', { type })` (global
  de Node 20+; el repo corre Node 24, engines cubiertos) en lugar del helper `toFile`
  de `groq-sdk`. Justificada en comentario: evita depender de un named export del SDK
  que el mock del test no expone, y Groq acepta un `File` directo. Correcto y verificado
  por el smoke en runtime.

## Cambios requeridos

Ninguno.
