# GREEN — voice_reliability

## Estado: BLOQUEADO (conflicto de tests, no de código)

El código de producción de los 3 cambios está implementado según el design.
`pnpm --filter @nach/frontend test` → **172/174 en verde**. Los 14 tests que
estaban en RED (A1-A4, A7-A10, B11, B12, regresiones 13/15, interimResults)
**pasan todos**. Pero aparecieron **2 fallos NUEVOS** en tests VIEJOS de
`voice_capture` incompatibles con la nueva spec → feature `blocked`.

## Cambios de producción aplicados

### 1. `frontend/src/voice/useVoiceInput.ts`

- `start()`: `interimResults = true` (mantiene `continuous=false`,
  `maxAlternatives=1`).
- `onresult`: itera desde `event.resultIndex` hasta `results.length`,
  concatena `results[i]?.[0]?.transcript ?? ''`, `.trim()`; si `''` → `return`
  (no emite); si no → `hadResultRef.current=true`, `setTranscript`, `onResult`.
- Nueva `hadResultRef` (useRef(false)): reset a `false` al final de `start()`
  (junto al `setStatus('listening')`), `true` en la 1ª emisión útil.
- `onend`: `prev==='error'` → return prev; `!hadResultRef.current` →
  `setErrorCode('no-speech')` + `'error'` (no-speech sintético); si captó → `idle`.
- Nuevo estado `voiceUnavailable` (useState(false)): en `onerror`,
  `code==='network'` → `setVoiceUnavailable(true)` (LATCH, NO se resetea en
  `start()`). Añadido a `UseVoiceInputResult` y al objeto de retorno.
- Sin tocar: firma de `onResult` (string), 'aborted', idempotencia, cleanup.

### 2. `frontend/src/features/welcome/NameField/NameField.tsx`

- Consume `voiceUnavailable`; `const showMic = isSupported && !voiceUnavailable;`
- `!showMic` → no renderiza el `<button>` del mic ni la fila `listeningLabel`.
- Eliminada la rama `disabled` + `voice.unsupported` como aria-label/title.
  `voice.unsupported` ya no se usa en el componente (permanece en el schema).
- `<input>`, contador y región `role="status"` siempre presentes.

## Bloqueo: conflicto de spec en tests viejos de voice_capture

Dos tests preexistentes de `useVoiceInput.test.ts` disparan `start()` +
`emitEnd()` **sin captura previa** y afirman `status='idle'`:

- L204 `onend natural devuelve a "idle" (acceptance #6)`
- L215 `stop() detiene ordenadamente: ... tras onend queda "idle" (acceptance #6)`

El design de voice_reliability (§Cambio 3) y los RED A4/A5/A10 exigen que ese
MISMO escenario (onend sin captura) pase a `error`/`no-speech`. Ambas cosas son
incompatibles: mi GREEN cumple la fuente de verdad (design + RED) y por eso esos
dos tests viejos quedan rojos.

**El implementer no modifica tests.** El tester debe actualizarlos (capturar
antes del `emitEnd`, o afirmar el nuevo `error`/`no-speech`), como ya hizo con
los casos 13/15 de NameField. La nota de regresión de `tests.md` los omitió.
