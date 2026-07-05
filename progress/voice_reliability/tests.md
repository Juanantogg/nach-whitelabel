# Tests (RED) — voice_reliability

Fase RED del ciclo TDD. Los tests derivan de
`progress/voice_reliability/design.md` → sección "Contrato de tests para el
tester (RED antes de GREEN)" y "Criterios de aceptación traducibles a tests".

Se mockea SOLO el borde del sistema: la SpeechRecognition API (via
`MockSpeechRecognition`) en el hook, y el hook `useVoiceInput` (via `voiceMock`
hoisted) en `NameField`. Nunca se mockea la lógica bajo prueba. Todo se observa
por rol/aria/texto de marca (`brand.voice.*`), jamás por clase CSS ni literal.

## Archivos tocados (solo tests)

- `frontend/src/voice/useVoiceInput.test.ts` — bloque A (hook).
- `frontend/src/features/welcome/NameField/NameField.test.tsx` — bloque B
  (NameField) + regresiones de no-soporte.

Ninguna línea de código de producción se tocó por el tester. `NameField.tsx`
tiene cambios sin commitear, pero son el GREEN de la feature previa `voice_ux`
(toggle, región `role="status"`, mapeo de errores), NO de voice_reliability.

---

## (A) Tests del HOOK — `useVoiceInput.test.ts`

Helpers añadidos al mock (reutilizando el patrón existente):
`emitInterimResult(text)` (isFinal:false), y `emitResults(chunks, resultIndex)`
array-like indexable con `.length` para el caso multi-segmento. El campo nuevo
`voiceUnavailable` del retorno se lee con el accesor tipado
`readVoiceUnavailable()` (cast por `unknown`) para no romper el typecheck
mientras el campo aún no existe en `UseVoiceInputResult`.

| Caso | Acceptance | Qué verifica | Estado esperado en RED |
|---|---|---|---|
| A1 | interimResults:true (y continuous:false, maxAlternatives:1) | Tras `start()`, `lastInstance.interimResults===true` | **FALLA** (regresión: código viejo fija `false`) |
| A2 | interino emite onResult(parcial), final refina; onResult siempre string | `emitInterimResult(' Ju')`→`onResult('Ju')` (trim), `transcript='Ju'`; `emitFinalResult('Juan')`→`onResult('Juan')`; 2 llamadas | **FALLA** (código viejo no hace trim del parcial de Chrome) |
| A3 | onresult multi-segmento desde resultIndex concatena | `emitResults(['Hola ','mundo'],0)`→`onResult('Hola mundo')` (1 llamada) | **FALLA** (código viejo lee un solo índice, no itera) |
| A4 | onend sin emisión ni error → error/no-speech sintético | `start()`+`emitEnd()`→`status='error'`, `errorCode='no-speech'` | **FALLA** (código viejo pasa a idle) |
| A5 | onend con captura previa → idle sin no-speech | `emitFinalResult('Ana')`+`emitEnd()`→`idle`, `errorCode=null` | VERDE (guarda invariante; se preserva) |
| A6 | no-speech real (onerror)+onend no colisiona | `emitError('no-speech')`+`emitEnd()`→sigue error/no-speech | VERDE (guard `prev==='error'` ya existe) |
| A7 | latch voiceUnavailable arranca false, se activa al 1er network | inicial `false`; `emitError('network')`→`true`, `errorCode='network'` | **FALLA** (campo inexistente → `undefined`) |
| A8 | latch persiste tras reintento | tras network, `start()`→`errorCode=null` pero `voiceUnavailable` sigue `true` | **FALLA** (campo inexistente) |
| A9 | otros errores NO activan el latch | `not-allowed`/`no-speech`/`audio-capture`→`voiceUnavailable` sigue `false` | **FALLA** (`undefined!==false`) ×3 |
| A10 | `hadResult` se resetea por sesión | sesión 1 con captura (idle); sesión 2 sin captura → error/no-speech | **FALLA** (código viejo no sintetiza) |

Hook: **10 casos FALLAN** (A1, A2, A3, A4, A7, A8, A9×3, A10), **2 VERDES**
guardas de invariante (A5, A6).

### Nota sobre A2 y el "RED que pasa por accidente"

La redacción original de A2 (`emitInterimResult('Ju')`) **pasaba con el código
viejo**: el lector de índice único ya emitía en cualquier evento sin distinguir
`isFinal`, así que `onResult('Ju')` se cumplía. Un RED que pasa por accidente
rompe la garantía TDD. Se reforzó A2 usando `emitInterimResult(' Ju')` con
espacio antepuesto — exactamente el comportamiento de Chrome que el design cita
("Chrome antepone espacios en los parciales") y que el nuevo `onresult` resuelve
con `.trim()`. El código viejo (sin trim) emitiría `' Ju'` y falla la aserción
`onResult('Ju')`: ahora A2 es un RED real que exige la iteración+trim nueva.

---

## (B) Tests de `NameField` — `NameField.test.tsx`

El `voiceMock` hoisted ganó `voiceUnavailable: boolean` en su tipo `VoiceMock`,
en el objeto inicial (`false`), en el retorno de `vi.mock`, y su reset en cada
`beforeEach` de todos los bloques. Sin esto los casos nuevos no pueden simular
el gatillo del latch.

| Caso | Acceptance | Qué verifica | Estado esperado en RED |
|---|---|---|---|
| B11 | mic NO renderizado si !isSupported; textbox sigue | `isSupported=false`→`queryByRole('button',{startLabel})` y `{unsupported}` son `null`; `getByRole('textbox')` presente | **FALLA** (código viejo renderiza botón disabled) |
| B12 | mic oculto tras network (voiceUnavailable); textbox y contador siguen | `voiceUnavailable=true`, `isSupported=true`→`queryByRole('button',{startLabel})` `null`; textbox y `'3/15 caracteres'` presentes | **FALLA** (código viejo no consume voiceUnavailable) |
| B13 | mic visible en caso normal (no ocultar de más) | defaults→`getByRole('button',{startLabel})` presente | VERDE (regresión: guarda que no se oculta de más) |
| B14 | no-speech (real o sintético) → role="status" con voice.noSpeech | `status='error'`, `errorCode='no-speech'`→`getByRole('status')` con `brand.voice.noSpeech` | VERDE (guarda que el estado sintético se comunica igual que el real; el mapeo de voice_ux ya existe) |
| B15 | cada emisión (parcial/final) se recorta a 15 antes de onChange | `onResult('Ju')`→`onChange('Ju')`; `onResult('JuanNombreLarguísimoDeMás')`→`onChange` con exactamente 15 chars | VERDE (el clamp de NameField ya se aplica en cada onResult) |

NameField (bloque B): **2 casos FALLAN** (B11, B12), **3 VERDES** guardas de
invariante/regresión (B13, B14, B15). B13/B14/B15 se quedan verdes porque
verifican comportamiento que debe **preservarse** (mic visible en el caso
normal, no-speech comunicado por `role="status"`, clamp a 15 en cada emisión) —
protegen contra ocultar de más o romper el clamp en el GREEN.

---

## Regresiones (tests EXISTENTES actualizados — cambio de spec, no relajación)

El comportamiento de no-soporte cambió de **deshabilitar** a **ocultar** el
botón de mic (design §"Cambio 2"). Esto obsoletó tres aserciones existentes de
`voice_ux`; se actualizaron para reflejar la spec nueva. NO es "modificar tests
para pasar": es reflejar un cambio de comportamiento aprobado en el design.

### Caso 13 (bloque "UX de voz: no-soporte") — ANTES → DESPUÉS

- **Antes:** el botón de voz existía `disabled` con `aria-label=voice.unsupported`
  (`getByRole('button',{name: voice.unsupported})` + `toBeDisabled()`).
- **Después:** botón de mic **AUSENTE** —
  `queryByRole('button',{name: brand.voice.unsupported})` es `null` **y**
  `queryByRole('button',{name: brand.voice.startLabel})` es `null`.
- Estado en RED: **FALLA** (código viejo aún renderiza el botón disabled).

### Caso 14 (bloque "UX de voz: no-soporte") — SIN CAMBIOS

- Se mantiene tal cual: `sin soporte: el textbox sigue presente` (el formulario
  no se rompe). Verde, invariante preservada.

### Caso 15 white-label (bloque "cero literal / white-label") — RECONVERTIDO

- **Antes:** `el aria-label de no-soporte proviene de la marca activa`
  (afirmaba un botón con `otherBrand.voice.unsupported`).
- **Después:** `sin soporte: no se renderiza botón de mic con textos de la marca
  activa (ocultación white-label)` — con otra marca sin soporte, ni
  `queryByRole('button',{name: otherBrand.voice.unsupported})` ni
  `{name: otherBrand.voice.startLabel}` están en el documento. La ocultación es
  agnóstica de marca y no filtra literales.
- Estado en RED: **FALLA** (código viejo renderiza el botón).
- Los otros sub-casos del bloque 15 (startLabel/listeningLabel/error white-label)
  no cambian y siguen verdes.

### `useVoiceInput.test.ts` — aserción interimResults

- La aserción existente `expect(inst.interimResults).toBe(false)` (bloque
  "arranque y escucha") pasó a `toBe(true)` (integrada en el caso A1). El resto
  de tests del hook (mapeo de errores, idempotencia, cleanup, aborted→idle) NO
  cambian.

### `useVoiceInput.test.ts` — dos tests de `voice_capture` obsoletos por §Cambio 3

El §Cambio 3 del design (no-speech sintético en `onend` sin captura, incluido el
`stop()` manual —decisión del usuario confirmada) obsoletó dos tests de
`voice_capture` que codificaban el comportamiento viejo (`idle` tras cerrar sin
captura). El implementer (correctamente) NO los tocó y paró; el tester los
actualizó a la spec nueva.

- **`onend natural devuelve a "idle"` (era L204).**
  - **Antes:** `start()` + `emitEnd()` SIN captura → esperaba `status==='idle'`.
  - **Después:** renombrado a `onend natural TRAS captura devuelve a "idle"`:
    emite `emitFinalResult('Ana')` antes de `emitEnd()` → sigue esperando
    `idle`. Preserva su intención original (el cierre natural ORDENADO cierra en
    idle) sin solapar A4/A5/A10, que ya cubren el cierre SIN captura →
    error/no-speech. Estado final: **VERDE**.

- **`stop() detiene ordenadamente ... tras onend queda "idle"` (era L215).**
  - **Antes:** `start()` + `stop()` + `emitEnd()` SIN captura → esperaba
    `status==='idle'`.
  - **Después:** dividido en dos, conservando el invariante `inst.stop()`
    llamado 1 vez:
    - `stop() sin captura ... tras onend sintetiza error/no-speech`: tras
      `emitEnd()` sin captura, `status==='error'` + `errorCode==='no-speech'`
      (decisión del usuario: `stop()` manual sin captura también sintetiza
      no-speech).
    - `stop() tras captura ... tras onend queda "idle"` (test NUEVO añadido):
      emite `emitFinalResult('Ana')` antes del `stop()` → cierra en `idle`.
      Conserva explícito el camino "parar con captura previa → idle".
  - Estado final: ambos **VERDES**.

Ninguna aserción queda afirmando el viejo `idle`-sin-captura. Total de tests del
hook: 28 → 30 (se dividió un test de stop en dos).

---

## Evidencia del RED

`pnpm --filter @nach/frontend typecheck` → **limpio** (el accesor tipado y el
mock no requieren el campo `voiceUnavailable` en el tipo real del hook todavía).

`pnpm --filter @nach/frontend test`:

```
 Test Files  2 failed | 18 passed (20)
      Tests  14 failed | 160 passed (174)
```

Las 14 fallas son EXACTAMENTE del alcance voice_reliability, todas por
comportamiento ausente o por spec vieja (no por typo/setup):

```
FAIL useVoiceInput.test.ts > ... interimResults=true ... (A1)
FAIL useVoiceInput.test.ts > ... emite parciales con trim ... (A2)
FAIL useVoiceInput.test.ts > ... itera desde resultIndex ... (A3)
FAIL useVoiceInput.test.ts > ... onend SIN ... no-speech (A4)
FAIL useVoiceInput.test.ts > ... "hubo captura" se resetea por sesión (A10)
FAIL useVoiceInput.test.ts > ... voiceUnavailable ... primer network (A7)
FAIL useVoiceInput.test.ts > ... latch persiste tras reintentar (A8)
FAIL useVoiceInput.test.ts > ... "not-allowed" NO activa el latch (A9)
FAIL useVoiceInput.test.ts > ... "no-speech" NO activa el latch (A9)
FAIL useVoiceInput.test.ts > ... "audio-capture" NO activa el latch (A9)
FAIL NameField.test.tsx > ... no-soporte ... NO se renderiza botón (regresión caso 13)
FAIL NameField.test.tsx > ... white-label ... no se renderiza botón (regresión caso 15)
FAIL NameField.test.tsx > ... !isSupported: no hay botón de mic (B11)
FAIL NameField.test.tsx > ... voiceUnavailable=true ... se oculta (B12)
```

El resto de la suite (160 tests, incluidos A5/A6/B13/B14/B15 y todo backend/
frontend no relacionado) sigue en **verde**: el RED está aislado al alcance de
la feature.

## Estado final tras el GREEN (implementer) + regresiones de §Cambio 3

El GREEN ya está implementado en producción (`useVoiceInput.ts` +
`NameField.tsx`). Tras actualizar los dos tests obsoletos de `voice_capture`
(§Cambio 3, arriba), la suite completa queda coherente con la spec nueva y en
verde. No queda ningún test afirmando el comportamiento viejo.

`pnpm --filter @nach/frontend typecheck` → **limpio**.

`pnpm --filter @nach/frontend test`:

```
 Test Files  20 passed (20)
      Tests  175 passed (175)
```

(174 → 175: el test de `stop()` sin captura se dividió en dos —`stop() sin
captura → error/no-speech` y `stop() tras captura → idle`— para conservar ambos
caminos.)

## Handoff al implementer (GREEN)

Para poner en verde estas 14 fallas sin tocar los tests:

1. `useVoiceInput.ts` `start()`: `interimResults=true`; `onresult` itera desde
   `event.resultIndex` concatenando `results[i][0].transcript` y `.trim()` antes
   de emitir; `hadResultRef` (reset en `start()`, `true` en la 1ª emisión útil);
   `onend` sintetiza `error`/`no-speech` si `prev!=='error'` y `!hadResultRef`.
2. `useVoiceInput.ts`: estado `voiceUnavailable` con latch en `onerror('network')`,
   NO reseteado por `start()`; añadirlo a `UseVoiceInputResult` y al retorno.
3. `NameField.tsx`: consumir `voiceUnavailable`; `showMic = isSupported &&
   !voiceUnavailable`; si `!showMic` no renderizar el `<button>` de mic ni la
   fila de `listeningLabel`; eliminar la rama `disabled`/`voice.unsupported`.
   `<input>`, contador y región `role="status"` siempre presentes.
