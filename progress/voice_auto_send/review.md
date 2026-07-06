# Review — voice_auto_send

**Veredicto:** APPROVED

Fase REFACTOR (TDD) de la detección de silencio local (Web Audio API) + auto-envío
del dictado (ADR 24). `./init.sh full` VERDE: lint + typecheck + test (frontend 223/223,
backend 53/53) + build + smoke. No se aplicó limpieza: el GREEN ya llega limpio.

## Checklist

- **TDD:** [x] — Los tests existían y fallaban en RED por símbolo/comportamiento ausente
  (`silenceDetector.test.ts` no resolvía el import; T2.a/b/c rojos por Web Audio no cableado),
  y ahora pasan. El implementer NO relajó los tests: `silenceDetector.test.ts`,
  `useVoiceRecorder.test.ts` (T2.a–e) y `NameField.test.tsx` (T3.a–e) coinciden 1:1 con
  `tests.md` y con los criterios de aceptación del `design.md`. El único cambio de test
  post-GREEN (T2.a: `waitFor`→aserción síncrona bajo fake timers) está justificado y
  documentado en `tests.md`; era defecto del test, no relajación del contrato (sigue
  verificando `transcribe` 1 vez + `onResult('Ana')` + vuelta a `idle`). Implementación
  mínima: detector puro ~35 LOC, meter ~25 LOC, cableado acotado; sin código muerto.

- **White-label:** [x] — Cero hex/literales nuevos en JSX (`NameField.tsx` no se tocó;
  reusa `voice.noSpeech`/`voice.listeningLabel`/`voice.transcribingLabel` de la config de
  marca). Cero texto nuevo en el schema. Las 4 constantes (SPEECH_THRESHOLD, SILENCE_HANG_MS,
  NO_SPEECH_TIMEOUT_MS, SAMPLE_MS) son comportamiento común y NO van al brand schema
  (correcto, como el límite de 15). Cero deps nuevas (package.json / pnpm-lock sin cambios).

- **Backend:** [x] — No aplica; la feature es UX pura de frontend. Backend intacto
  (53/53, smoke OK). `transcribeVoice.ts` y el endpoint `POST /voice/transcribe` no se tocan.

- **Calidad:** [x] — lint limpio, typecheck sin errores, test verde, build OK, smoke OK.
  Sin `any` ni `console.*` en los tres archivos de producción. Sin abstracción prematura:
  detector puro extraído (testeable sin DOM) + meter fino de borde + orquestación en el
  motor; separación de responsabilidades correcta. Web Crypto/APIs nativas (Web Audio,
  `getByteTimeDomainData`) frente a librería VAD (descartada por minimalismo en ADR 24).

## Verificación del punto crítico (teardown — privacidad)

Las CINCO salidas de `recording` liberan mic + AudioContext + bucle:

1. **auto-envío ('send')** (`useVoiceRecorder.ts:232-234`): `recorder.stop()` → `onstop`
   (`:181-206`) ejecuta `clearTimer()` + `teardownMeter()` + `releaseStream()`.
2. **no-speech** (`:235-247`): `clearTimer()` + `teardownMeter()` + `chunksRef=[]` +
   `recorder.onstop=null` + `recorder.stop()` (si no inactive) + `releaseStream()`. No dispara
   `onstop` (evita subir audio vacío) pero libera todo a mano. Correcto.
3. **stop manual** (`:258-261`): `clearTimer()` + `recorder.stop()` → `onstop` → teardown completo.
4. **auto-stop por tiempo (10 s)** (`:252-254`): `recorder.stop()` → `onstop` → teardown completo.
5. **unmount** (`:148-154`): `clearTimer()` + `teardownMeter()` + `releaseStream()`.

`teardownMeter()` (`:129-138`) siempre: `clearInterval(sampleTimer)` + `meter.close()`
(AudioContext.close) + anula refs. `releaseStream()` (`:141-145`) para todos los tracks
(`track.stop()`). No hay camino de salida que deje el intervalo vivo, el AudioContext abierto
ni el mic activo. Los tests T2.b/c cubren no-speech, stop manual y unmount con
`MockAudioContext.close` + `MockTrack.stop` aserados. `teardownMeter` es idempotente
(null-guards), así que la doble invocación (send→onstop, o unmount tras onstop) es segura.

## Otros puntos verificados
- **Separación:** `silenceDetector.ts` es puro (sin AudioContext/DOM; tiempo inyectado por
  `nowMs`); `audioLevelMeter.ts` encapsula el borde Web Audio (RMS + close). Sin fuga de
  Web Audio al detector.
- **Constantes:** nombradas, juntas (`:44-51`), con comentario de calibración runtime;
  invariante 1.5s < 3s < 10s respetado.
- **Cero regresión voice_groq_default:** el auto-envío reusa el MISMO `onstop` que el stop
  manual (mismo camino de subida); T2.d (voz continua → auto-stop por tiempo) y T2.e
  (stop manual) verdes; NameField y clamp de 15 intactos (T3).
- **Robustez runtime:** `resolveAudioContext` con fallback `webkitAudioContext`
  (`audioLevelMeter.ts:26-34`); `tryCreateMeter`→null degrada con elegancia si no hay Web
  Audio (`useVoiceRecorder.ts:73-79`, `:217-218`) sin romper la grabación básica.
- **Documentación:** ADR 24 registrado en `docs/decisiones.md:806` con contexto/decisión/
  descartados; coherente con el diseño.

## Cambios requeridos
Ninguno.

---

# Review — voice_auto_send · Sanitización del dictado (add-on 2026-07-05)

**Veredicto:** APROBADO

Añadido pequeño a la feature: limpieza de puntuación de BORDE del texto DICTADO
(Whisper/Groq añade "." al final). Función pura nueva + cableado en `applyName`,
SIN tocar el input manual. `./init.sh full` VERDE: lint + typecheck + test
(frontend 245/245, backend 53/53) + build + smoke. No se aplicó limpieza: el
GREEN llega limpio.

## Checklist
- **TDD:** [x] — RED real: `sanitizeDictatedName.test.ts` importaba un módulo aún
  inexistente (falla por módulo ausente, no por sintaxis) y en NameField el bloque
  "sanitización del dictado" fallaba porque `applyName` hacía
  `onChange(clampToMax(transcript))` sin sanitizar. Ahora pasan. Sin relajación:
  los pares entrada→salida y el contraste dictado/teclado se mantienen 1:1 con
  `tests.md`.
- **White-label:** [x] — Cero literales/hex nuevos; `sanitizeDictatedName.ts` es
  lógica pura de string y NameField no incorpora texto/color. El set de borde es
  comportamiento común (como el clamp de 15), no config de marca — correcto.
- **Backend:** [x] — No aplica; cambio de frontend puro. Backend intacto (53/53, smoke OK).
- **Calidad:** [x] — lint limpio, typecheck OK, 245/245 verde, build+smoke OK. Sin
  `any`, sin `console.*`, sin deps nuevas. Función pura de 3 líneas efectivas con
  regex nativa (flag `u`), sin wrapper de más ni abstracción prematura. Ubicación
  coherente (`frontend/src/voice/`, junto al resto del dominio de voz).

## Verificación de los 5 puntos pedidos
1. **La regex solo recorta bordes (^ y $), nunca el interior** — Confirmado con
   probes ejecutados sobre la función real (`sanitizeDictatedName.ts:11-15`):
   - `"José María"`→`"José María"`, `"Begoña"`→`"Begoña"` (espacio interno y ñ
     intactos); `"¿José María?"`→`"José María"`.
   - `"Juan."`→`"Juan"`; `"..."`→`""`; `"   "`→`""`.
   - **Guion:** `"Ana-María"`, `"José-Luis"`, `"Jean-Pierre"`→intactos (el guion NO
     está en el set de borde, así que ni interior ni borde se recorta; `"Ana-"`
     conserva el guion final — aceptable, no es un signo que Whisper suela añadir).
   - **Apóstrofe:** `"O'Brien"`, `"D'Angelo"`→intactos (interior). El apóstrofe SÍ
     está en el set, luego en borde sí se recortaría — coherente con la decisión
     registrada en la cabecera de `sanitizeDictatedName.ts:6-8`.
   - No se detectó ningún nombre real que se rompa: la clase de caracteres solo
     contiene puntuación/comillas/espacios, nunca letras/tildes/ñ.
2. **Solo el dictado sanitiza, el teclado NO** — Confirmado: `NameField.tsx:34-35`
   `applyName` = `onChange(clampToMax(sanitizeDictatedName(transcript)))` (dictado,
   vía `useVoiceRecorder({ onResult: applyName })` en `:37`); el `onChange` del
   `<input>` (`:89`) hace solo `onChange(clampToMax(event.target.value))` — sin
   `sanitizeDictatedName`. Cubierto por los tests de regresión
   `NameField.test.tsx:294-311` ("Juan." y "." tecleados se conservan).
3. **Orden sanitize→clamp correcto** — `NameField.tsx:35`: sanitiza ANTES del
   clamp, de modo que la puntuación de borde no consume presupuesto de los 15.
   Verificado por `NameField.test.tsx:282-288` (`" NombreLarguísimoDeMás. "` → limpia
   borde → trunca a exactamente 15).
4. **Calidad** — Función pura sin deps ni efectos, testeable en aislamiento; regex
   con flag `u` (`sanitizeDictatedName.ts:12`) para tildes/ñ; sin `console.*`, sin
   `any`; ubicación y nombre coherentes con `frontend/src/voice/`; cero literales/hex.
5. **Tests** — 16 casos en la función pura (`sanitizeDictatedName.test.ts`, 16/16) +
   5 casos de contraste dictado/teclado en NameField (`:264-311`) cubren el
   comportamiento. TDD legítimo (RED por módulo/símbolo ausente).

## Cambios requeridos
Ninguno.

---

# Review — voice_auto_send · Feedback de longitud (add-on 2026-07-05)

**Veredicto:** APROBADO

Añadido pequeño: aviso de longitud cuando el nombre llega al tope de 15 (ADR 25,
límite FIJO). Nueva clave `text.maxLengthReached` en el schema + render condicional
en `NameField`. `./init.sh full` VERDE: lint + typecheck + test (frontend 256/256,
backend 53/53) + build + smoke. No se aplicó limpieza: el GREEN llega limpio.

## Checklist
- **TDD:** [x] — RED real por AUSENCIA de símbolo/comportamiento, no por sintaxis:
  `schema.test.ts:224-253` fallaba porque `text.maxLengthReached` no existía en el
  schema (`config.text.maxLengthReached` era `undefined`); `NameField.test.tsx:572-660`
  fallaba porque NameField no rendía ningún aviso al tope. Ahora pasan. Sin relajación:
  los casos coinciden 1:1 con el contrato descrito en las cabeceras de los tests. El
  helper `maxReachedText` (`NameField.test.tsx:583-586`) usa fallback al default del ADR
  para que el RED de la capa NameField sea por ausencia del aviso en el DOM, no por
  TypeError — andamiaje legítimo. El único ajuste post-GREEN citado (onResult en `act()`,
  `:616-618`) es flush de re-render de React, no cambia lo verificado (clamp a 15 + aviso).
- **White-label:** [x] — Cero literal en JSX: el aviso sale de `text.maxLengthReached`
  (`NameField.tsx:49`), interpolando `{max}` desde `NAME_MAX_LENGTH` (`:49`), nunca "15"
  hardcodeado. Colores por token (`text-brand-accent`, `NameField.tsx:162`). El `.default()`
  del schema (`schema.ts:44`) cubre TODAS las marcas: ni `default.json` ni `elektra.json`
  ni `shopinbaz.json` definen la clave (verificado por grep) → marca nueva = un JSON, sin
  tocar componentes. Test white-label con otra marca (`NameField.test.tsx:645-659`) confirma
  que el copy es de la marca activa y no se filtra el seed.
- **Backend:** [x] — No aplica: cambio de UX puro de frontend. El límite sigue FIJO en 15
  (`NAME_MAX_LENGTH`, constante única, `constants.ts:6`); no se tocó `crypto.controller.ts`
  ni `record.model.ts` ni la validación 400. Backend intacto (53/53, smoke OK). Coherente
  con ADR 25 (`docs/decisiones.md:843-869`): no se hizo configurable, solo feedback UX.
- **Calidad:** [x] — lint limpio, typecheck OK, 256/256 verde, build + smoke OK. Sin `any`,
  sin `console.*`, sin deps nuevas. Sin abstracción prematura: booleano `maxLengthReached`
  (`NameField.tsx:48`) + render condicional de 4 líneas; reusa el patrón de interpolación de
  `counterTemplate`. No rompe el layout: el aviso va en su PROPIA región tras el contador y
  la región de error, sin desplazar botón de voz ni contador.

## Verificación de los 6 puntos pedidos
1. **White-label estricto** — Confirmado: aviso vía `text.maxLengthReached` (cero literal),
   `{max}` interpolado desde `NAME_MAX_LENGTH` (no "15" en JSX), color por token. El
   `.default()` con `{max}` (`schema.ts:44`) implica que ninguna marca existente edita su
   JSON — verificado por grep sobre `brand/data` y `brand/seeds`.
2. **Unificado teclado+voz** — Correcto: el aviso depende SOLO de `value.length >= NAME_MAX_LENGTH`
   (`NameField.tsx:48`), común a onChange del input (`:94`) y a `applyName` del dictado
   (`:34-35`). Tests `:599-606` (teclado) y `:609-622` (dictado) verifican el mismo aviso.
3. **Convivencia con el error de voz** — Correcto y sensato: dos regiones separadas. La de
   error de voz conserva `role="status"` + `aria-live="polite"` (`:155`); la de longitud usa
   solo `aria-live="polite"` SIN duplicar `role="status"` (`:162`), evitando dos regiones
   status ambiguas y preservando el `getByRole('status')` del test de regresión (`:625-633`),
   que confirma ambos textos visibles a la vez.
4. **Coherencia con ADR 25** — Correcto: límite FIJO en 15, constante única `NAME_MAX_LENGTH`;
   no configurable; aviso solo UX; cero cambio en backend/validación (diff no toca `backend/`).
5. **Calidad** — Sin literal/hex, sin `console.*`, sin deps; el aviso no rompe el layout
   (contador `:151` y botón de voz `:97-140` intactos).
6. **TDD legítimo** — RED real (schema sin la clave, NameField sin el aviso); el `act()` en
   onResult es andamiaje de flush, no relajación del contrato.

## Cambios requeridos
Ninguno.
