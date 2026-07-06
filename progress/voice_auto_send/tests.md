# Tests (RED) — voice_auto_send

Fase RED del ciclo TDD. Tests que FALLAN antes de que exista el código de
producción, derivados de los criterios de aceptación de `feature_list.json` y
del plan de `design.md` (§"Plan de tests" T1/T2/T3) y ADR 24.

Todo mockeado: **cero red, cero audio real**. Se mockea el borde del sistema
(`getUserMedia`, `MediaRecorder`, `AudioContext`/`AnalyserNode`, `transcribeVoice`);
la lógica bajo prueba (detector puro, máquina del motor, orquestación de NameField)
NO se mockea.

## Archivos

| Archivo | Nivel | Estado |
|---|---|---|
| `frontend/src/voice/silenceDetector.test.ts` | T1 — detector PURO (sin DOM) | **NUEVO, RED** (módulo `./silenceDetector` no existe) |
| `frontend/src/voice/useVoiceRecorder.test.ts` | T2 — motor con Web Audio mockeado | **EXTENDIDO, RED** (motor no cablea Web Audio) |
| `frontend/src/features/welcome/NameField/NameField.test.tsx` | T3 — integración (motor mockeado) | **EXTENDIDO, verde** (regresión: NameField no cambia por diseño) |

## T1 — `silenceDetector.test.ts` (lógica pura, el grueso del valor)

Prueba `createSilenceDetector({ speechThreshold, silenceHangMs, noSpeechTimeoutMs })`,
una máquina temporal alimentada con secuencias `(level, nowMs)` que devuelve
`'send' | 'no-speech' | null`. El **tiempo se inyecta** por parámetro (`nowMs`),
no se lee de `Date.now`/`performance.now` → determinista sin fake timers.

Constantes de prueba fijadas en el test (THRESHOLD=0.06, HANG=1500, NO_SPEECH=3000):
se prueba la SEMÁNTICA, no acoplado a las constantes reales del motor.

- **auto-envío (T1.a):** silencio→voz→silencio sostenido ≥ `silenceHangMs` → `'send'`
  en el push que cruza la ventana; y `'send'` no aparece antes de completarla.
- **no-speech (T1.b):** niveles siempre `< speechThreshold` durante ≥ `noSpeechTimeoutMs`
  → `'no-speech'`; nunca `'send'`.
- **la voz recarga la ventana (T1.c):** voz → pausa CORTA (< hang) → voz → silencio ≥ hang
  → `'send'` (no corta a mitad de frase en la primera pausa breve).
- **hasSpoken separa (a)/(b) (T1.e):** con voz previa NUNCA emite `'no-speech'` (emite
  `'send'` por hang); sin voz previa NUNCA emite `'send'` (emite `'no-speech'`).
- **reset():** tras `reset()` trata el flujo como sesión nueva (olvida `hasSpoken` y
  `startedAt`) → solo silencio dispara `'no-speech'`, no `'send'`.

**Evidencia RED:** `Failed to resolve import "./silenceDetector"` → suite entera en
rojo por módulo ausente. RED puro por símbolo inexistente, no por sintaxis del test.

## T2 — `useVoiceRecorder.test.ts` (motor con Web Audio mockeado)

Reutiliza el andamiaje existente (`MockMediaRecorder`, `MockStream`, `MockTrack`,
`getUserMediaMock`, `transcribe` inyectable, fake timers). Los tests previos
(R1–R7) siguen **verdes** (no se tocan).

### Receta de mock de `AudioContext` (jsdom no lo trae)

jsdom NO define `AudioContext`/`AnalyserNode`: sin el doble, el motor petaría por
`AudioContext is not defined` en vez de por la lógica. Se instala en `globalThis`:

```ts
let nextLevelByte = 128;         // 128 = silencio (RMS 0); lejos de 128 = "voz"
const VOICE_BYTE = 150;          // RMS ~0.17 > SPEECH_THRESHOLD (0.06)
const SILENCE_BYTE = 128;        // RMS 0 (< umbral)

class MockAnalyser {
  fftSize = 512; frequencyBinCount = 256; connect = vi.fn();
  getByteTimeDomainData = vi.fn((arr) => arr.fill(nextLevelByte));
}
class MockAudioContext {
  static lastInstance = null;              // para spiar close()
  createAnalyser = () => new MockAnalyser();
  createMediaStreamSource = () => ({ connect: vi.fn() });
  close = vi.fn(() => Promise.resolve());
}
(globalThis as any).AudioContext = MockAudioContext;
```

El test manipula `nextLevelByte` con `setLevel(byte)` entre ticks de muestreo y
avanza `vi.advanceTimersByTime(...)` para simular voz (byte alto) / silencio (byte 128).
El motor calcula el RMS normalizado sobre esa forma de onda con la fórmula del design
(`sqrt(mean(((v-128)/128)^2))`). Se asume muestreo por `setInterval(SAMPLE_MS)`
(recomendación del design §5, más controlable con fake timers que rAF); si el
implementer usa rAF, además debe mockear rAF — este andamiaje cubre `setInterval`.

### Casos

- **T2.a "habló y calló"** (voz alta → silencio sostenido > `SILENCE_HANG_MS`): el motor
  llama a `stop()` SOLO (sin 2º clic), `transcribe` se llama 1 vez, `onResult('Ana')`,
  `status` vuelve a `idle`.
- **T2.b "nunca habló"** (silencio > `NO_SPEECH_TIMEOUT_MS`): `transcribe` **NO** se llama
  (no se sube audio vacío), `errorCode 'no-audio'`, `status 'error'`, mic liberado
  (`MockTrack.stop`). *(Assert directo del status, sin `waitFor`, para RED rápido bajo
  fake timers.)*
- **T2.c teardown / AudioContext cerrado** (3 tests): tras ruta (b) no-speech, tras
  `stop()` manual y tras `unmount`, `MockAudioContext.close()` fue llamado (y en unmount
  el mic también se libera).
- **T2.d red de seguridad por tiempo** (voz CONTINUA, nunca cae bajo umbral): el detector
  NO corta antes; el auto-stop por tiempo (~10 s) sí dispara `onstop`→`transcribe`
  (comportamiento de `voice_groq_default` preservado). **VERDE** (ya funciona hoy).
- **T2.e stop() manual antes del hang:** sigue subiendo el audio (`transcribe` llamado).
  **VERDE** (el detector no rompe el camino manual existente).

**Evidencia RED:** T2.a falla en `expect(transcribe).toHaveBeenCalledTimes(1)` (el
envío por silencio no está cableado). T2.b falla en `expect(status).toBe('error')`
(sigue en `recording`). T2.c falla con `Cannot read properties of null (reading 'close')`
porque el motor aún no crea ningún `AudioContext` → `lastInstance` es null. Las tres
razones son "comportamiento nuevo ausente", no error de setup.

### Arreglo post-GREEN de T2.a (waitFor → síncrono bajo fake timers)

Tras el GREEN del implementer, 222/223 pasaban y el único rojo era T2.a — un
**defecto del test, no del código**. T2.a corre bajo `vi.useFakeTimers()` pero
terminaba con `await waitFor(() => expect(onResult)...)` / `...status).toBe('idle')`.
`waitFor` de Testing Library hace polling con **timers reales** → bajo fake timers
nunca resuelve y cae al timeout de 5 s (falso rojo). El comportamiento sí estaba:
tras el último `act(() => vi.advanceTimersByTime(2_500))` el hook ya está en `idle`
con `onResult('Ana')`. Se sustituyeron los dos `waitFor` por **aserciones síncronas**
precedidas de un `await act(async () => { await flush(); })` que drena la microtarea
de la promesa de `transcribe` — mismo patrón que T2.b (que ya evitaba `waitFor` bajo
fake timers a propósito). No cambia QUÉ verifica T2.a (auto-envío sin 2º clic →
`transcribe` + `onResult('Ana')` + vuelta a `idle`). `waitFor` sigue importado y en
uso por las suites de timers reales (R2–R5).

## T3 — `NameField.test.tsx` (integración, motor mockeado)

Reusa el mock de `useVoiceRecorder` ya presente (`recorderMock` con `onResult`
capturado). Por diseño, **`NameField` no cambia** (el auto-envío se manifiesta como
transiciones de estado que el componente ya renderiza), así que estos tests son
**guardas de regresión verdes**:

- auto-envío (`onResult('Ana')`) rellena el campo **sin** un 2º clic (no se llama a `stop()`).
- el auto-envío respeta el **clamp de 15** (texto largo se trunca).
- el **2º clic manual** en recording sigue llamando a `stop()`.
- el **input manual** sigue intacto tras un auto-envío.
- el caso **no-speech** muestra `voice.noSpeech` en `role="status"`.

Cero literales/hex: todo se observa por rol/aria/texto de marca.

## Resultado de la corrida

### RED inicial (antes del GREEN)

`pnpm --filter @nach/frontend test -- --run`:

```
Test Files  2 failed | 22 passed (24)
     Tests  5 failed | 210 passed (215)
```

- **RED (5 tests + 1 suite):** los 3 T2 de teardown, T2.a, T2.b, y la suite completa
  `silenceDetector.test.ts` (7 tests) que no llega a ejecutar por import ausente.
- **VERDE:** T2.d, T2.e, todos los T3 y el resto de suites (cifrado, contador, brand,
  welcome, R1–R7 del motor) — sin regresiones.

### GREEN final (tras el implementer + arreglo de T2.a)

`pnpm test`:

```
frontend  Test Files  24 passed (24)   Tests  223 passed (223)
backend   Test Files  10 passed (10)   Tests   53 passed  (53)
```

`pnpm lint` y `pnpm typecheck`: ambos verdes en front y back. El único rojo
remanente tras el GREEN era T2.a por un `waitFor` bajo fake timers (defecto del
test); corregido a aserción síncrona (ver "Arreglo post-GREEN de T2.a" en T2).

Lint limpio en los archivos de test (`eslint` sin salida): sin `.only`, sin imports
sin usar.

## Para el implementer (GREEN)

Archivos a crear/tocar para pasar de RED a GREEN:

1. **CREAR `frontend/src/voice/silenceDetector.ts`** — `createSilenceDetector(cfg)` puro
   con la semántica del design (flag `hasSpoken`, `silenceSince`, `startedAt`; `push`/`reset`).
2. **CREAR `frontend/src/voice/audioLevelMeter.ts`** — `createAudioLevelMeter(stream)`:
   `AudioContext` + `AnalyserNode`, `getByteTimeDomainData`, RMS normalizado; `sample()` +
   `close()`. (Es el borde que los tests de T2 mockean vía `globalThis.AudioContext`.)
3. **TOCAR `frontend/src/voice/useVoiceRecorder.ts`** — cablear meter + detector al entrar
   en `recording`; bucle `setInterval(SAMPLE_MS)` que hace `detector.push(meter.sample(), now)`;
   `'send'` → `stop()` interno; `'no-speech'` → cortar sin subir + `errorCode 'no-audio'`;
   teardown (cancelar intervalo + `meter.close()` + `releaseStream()`) en `stop`, `onstop`,
   rama no-speech y unmount. Constantes `SPEECH_THRESHOLD`, `SILENCE_HANG_MS`,
   `NO_SPEECH_TIMEOUT_MS`, `SAMPLE_MS`.
4. **NO tocar** `NameField.tsx`, `transcribeVoice.ts`, ni el backend (T3 ya verde por diseño).
```

---

## Sanitización de puntuación del dictado (decisión del usuario, 2026-07-05)

Añadido pequeño a `voice_auto_send` (mismo ciclo TDD, aún sin commitear).

### Motivo

Descubierto en runtime: Whisper/Groq **añade puntuación automática** al transcribir,
así que dictar "Juan" devuelve `"Juan."` con punto final. Hay que limpiarlo, pero
**SOLO en el texto que viene del DICTADO**, nunca en el input manual del teclado (si
el usuario escribe un punto a mano, es su decisión).

### Decisión (set de signos de borde)

Quitar los signos de puntuación de **borde** (inicio y final) del texto dictado —
`. , ; : ! ? ¡ ¿ …` más comillas (`" ' « » “ ” ‘ ’`) y espacios sobrantes —
**conservando** letras, tildes, ñ y los **espacios internos** (nombres compuestos
como "José María" quedan intactos). Solo se recorta desde los extremos hacia dentro.
El input manual del teclado **no se toca**.

### Archivos de test

| Archivo | Nivel | Estado |
|---|---|---|
| `frontend/src/voice/sanitizeDictatedName.test.ts` | Unitario — función PURA | **NUEVO, RED** (módulo `./sanitizeDictatedName` no existe) |
| `frontend/src/features/welcome/NameField/NameField.test.tsx` | Integración — motor mockeado | **EXTENDIDO** (4 RED de dictado + 2 regresión de teclado verdes) |

### `sanitizeDictatedName.test.ts` — función pura

Prueba `sanitizeDictatedName(raw: string): string`. Pares entrada→salida, sin jsdom
ni mocks (string puro):

- **borde:** `"Juan." → "Juan"`, `"Ana," → "Ana"`, `"¿María?" → "María"`,
  `"¡Hola!" → "Hola"`, `"Pedro…" → "Pedro"`, `";Luis:" → "Luis"`, `'"Sara"' → "Sara"`.
- **espacios de borde:** `"  Ana  " → "Ana"`, `"  Ana,  " → "Ana"` (combinado).
- **conserva interno:** `"José María" → "José María"` (intacto), `"Begoña" → "Begoña"`,
  `"¿José María?" → "José María"` (limpia borde, respeta el espacio interno),
  `"Juan" → "Juan"` (ya limpio, no cambia).
- **borde / no rompe:** `"" → ""`, `"..." → ""` (todo-puntuación colapsa), `"   " → ""`.

### `NameField.test.tsx` — integración (dictado limpia, teclado no)

El motor sigue mockeado (cero red/audio): la transcripción se simula invocando el
`onResult` que el componente registra. El **corazón del cambio es el contraste**:

- **DICTADO limpia (4 RED):**
  - `onResult("Juan.")` → `onChange("Juan")`.
  - `onResult("¿María?")` → `onChange("María")`.
  - `onResult("  José María.  ")` → `onChange("José María")` (limpia borde, respeta interno).
  - `onResult(" NombreLarguísimoDeMás. ")` → sanitiza **antes** del clamp → `"NombreLarguísim"` (15).
- **TECLADO NO limpia (2 regresión, verdes):**
  - escribir `"Juan."` a mano deja `"Juan."` (con el punto).
  - escribir `"."` a mano deja `"."` (no colapsa a vacío).

**Andamiaje:** las regresiones de teclado usan un wrapper con estado REAL de React
(`renderStatefulNameField`) para que el input controlado refleje cada pulsación —
el `renderNameField` existente no re-renderiza entre teclas y solo registraría el
último carácter (falso rojo). Se afirma tanto el valor final del input
(`toHaveValue`) como el último `onChange`.

### Evidencia RED

`pnpm --filter @nach/frontend test`:

```
Test Files  2 failed | 23 passed (25)
     Tests  4 failed | 225 passed (229)
```

- **RED (4 tests + 1 suite):** los 4 tests de DICTADO de NameField fallan porque
  `applyName` hoy hace `onChange(clampToMax(transcript))` sin sanitizar → propaga
  `"Juan."` con el punto (`expected "Juan." to be called with [ 'Juan' ]`). La suite
  `sanitizeDictatedName.test.ts` no llega a ejecutar: `Failed to resolve import
  "./sanitizeDictatedName"` (módulo ausente). RED puro por comportamiento/símbolo
  inexistente, no por sintaxis del test.
- **VERDE:** las 2 regresiones de teclado (dictado limpia / teclado no) y los 223
  tests previos de `voice_auto_send` / `voice_groq_default` — sin regresiones (224 →
  225 passed: suman las 2 de teclado; ninguna previa se rompe).

### Para el implementer (GREEN)

1. **CREAR `frontend/src/voice/sanitizeDictatedName.ts`** — export `sanitizeDictatedName(raw)`
   puro: recorta desde ambos extremos los signos de borde del set decidido
   (`. , ; : ! ? ¡ ¿ …` + comillas) y los espacios, conservando letras/tildes/ñ y los
   espacios internos. `"" → ""`, todo-puntuación → `""`.
2. **TOCAR `frontend/src/features/welcome/NameField/NameField.tsx`** — en `applyName`
   (camino del DICTADO, ~línea 32) aplicar `sanitizeDictatedName` **antes** del
   `clampToMax`: `onChange(clampToMax(sanitizeDictatedName(transcript)))`. **NO tocar**
   el `onChange` del input manual (~línea 86): el teclado sigue con `clampToMax` a secas.

---

## Feedback de longitud al límite (ADR 25 — límite FIJO en 15)

**Decisión (usuario, 2026-07-05, ADR 25):** el límite del nombre se mantiene FIJO en 15
(`NAME_MAX_LENGTH`, NO configurable). Cuando `value.length >= 15` se muestra un AVISO de
longitud UNIFICADO para teclado y dictado (ambos ya recortan a 15 vía `clampToMax`). Texto
de marca NUEVO: `text.maxLengthReached`, default `'Máximo {max} caracteres'` (reusa el
placeholder `{max}` igual que `counterTemplate`).

### Tests añadidos

**Schema** (`frontend/src/brand/core/schema.test.ts`, bloque
`brandConfigSchema — text.maxLengthReached (voice_auto_send, ADR 25)`) — prueba el MECANISMO,
no el copy exacto (fuente de verdad: `parseBrandConfig({}).text.maxLengthReached`):
- `parseBrandConfig({})` produce `text.maxLengthReached` con un default no vacío.
- el default **contiene el placeholder `{max}`** (patrón de `counterTemplate`).
- un JSON que OMITE `maxLengthReached` sigue válido y rellena el default (marca nueva = un JSON);
  `counterTemplate` queda intacto.
- conserva un `maxLengthReached` provisto por la marca (white-label).

**NameField** (`frontend/src/features/welcome/NameField/NameField.test.tsx`, bloque
`NameField — feedback de longitud al límite (voice_auto_send, ADR 25)`) — el aviso se observa
por el texto de marca resuelto (`text.maxLengthReached` con `{max}`→15), nunca por literal:
- **camino feliz:** con `value` de 15 chars muestra el aviso; con `value` < 15 NO lo muestra.
- **unificado (teclado):** escribir un nombre que supera el tope deja 15 (input controlado real,
  `renderStatefulNameField`) → muestra el aviso.
- **unificado (dictado):** `onResult` con un texto largo recorta a 15 → mismo aviso.
- **regresión (no tapa la voz):** con `value` al tope Y un `errorCode` de voz, el error sigue en
  `role="status"` y el aviso también está presente.
- **regresión (nada al reposo):** con `value` corto y sin error, no hay ni aviso ni error de voz.
- **white-label (F10):** con OTRA marca (`maxLengthReached` propio) el aviso usa ESE copy y el del
  seed shopinbaz no se filtra.

Nota: dos de estos tests (`value < 15 NO muestra` y `value corto sin error`) pasan ya en VERDE —
son ancla de regresión: deben seguir verdes cuando el implementer añada el aviso.

**Fix post-GREEN (defecto del test, no del código):** el test `unificado (dictado)` disparaba
`recorderMock.onResult?.(...)` FUERA de `act()`; como propaga `onChange → setName` en el wrapper
`renderStatefulNameField`, React no flusheaba el re-render (input `value=""`, aviso ausente) y RTL
avisaba "An update to Stateful … not wrapped in act(...)". Se envolvió esa única llamada en `act()`
síncrono (onResult→onChange es síncrono) — mismo patrón que el bloque de useVoiceRecorder. No se
cambió lo que el test verifica (dictado que excede el tope → clamp a 15 → aviso visible).
Tras el fix: `pnpm --filter @nach/frontend test` → **256/256 verde**; lint y typecheck verdes.

### Evidencia RED

`pnpm --filter @nach/frontend test`:

```
Test Files  2 failed | 23 passed (25)
     Tests  8 failed | 248 passed (256)
```

- **RED (8 tests):** 3 de schema fallan porque `text.maxLengthReached` no existe
  (`expected undefined … / toContain('{max}')`); 5 de NameField fallan por AUSENCIA del aviso
  en el DOM — `TestingLibraryElementError: Unable to find an element with the text: Máximo 15
  caracteres`. RED puro por símbolo/comportamiento inexistente, no por sintaxis del test.
- **`pnpm --filter @nach/frontend typecheck` falla** con `TS2339: Property 'maxLengthReached'
  does not exist on type ...text` — esperado en RED (el campo aún no está en el schema Zod, de
  donde se infiere el tipo). Mismo patrón que los RED de schema previos (voice/transcribingLabel).
  Se resuelve solo al añadir el campo al schema (GREEN).
- **Sin regresiones:** los 246 tests previos de `voice_auto_send` / `voice_groq_default` siguen
  verdes (248 passed = 246 previos + 2 anclas nuevas en verde).

### Para el implementer (GREEN)

Ficheros a tocar (con precedente en el repo):
1. **`frontend/src/brand/core/schema.ts`** — añadir al bloque `text` (junto a `counterTemplate`):
   `maxLengthReached: z.string().default('Máximo {max} caracteres')`. El default con `{max}` hace
   que **NO haga falta tocar los JSON de marca** (seeds/`data/*.json`) — el `.default()` basta.
2. **`frontend/src/features/welcome/NameField/NameField.tsx`** — cuando `value.length >=
   NAME_MAX_LENGTH`, renderizar el aviso interpolando `{max}`→`NAME_MAX_LENGTH` (mismo
   `.replace('{max}', …)` que el `counter`, ~línea 42-44). Debe **convivir con la región de error
   de voz** (`role="status"` errorText, ~línea 150) sin taparla: comparte región o va en un span
   aparte, pero el aviso debe ser observable por su texto de marca y el error de voz seguir visible
   cuando ambos coexisten. Aviso IGUAL para teclado y dictado (no discriminar por origen: solo
   depende de `value.length`).

