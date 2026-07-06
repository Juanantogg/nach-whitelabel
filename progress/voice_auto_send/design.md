# Design — voice_auto_send

## Objetivo

Cerrar el hueco de UX del dictado por voz: hoy (feature `voice_groq_default`, ADR
23) el flujo es **grabar→enviar de 2 clics** con un único auto-stop **por tiempo**
(`MAX_RECORDING_MS = 10 000 ms`). Si el usuario pulsa "grabar" y no habla, a los
10 s se sube igualmente un `Blob` **vacío o de puro ruido** a Groq — coste, latencia
y ningún resultado útil.

Se añade **detección de silencio local** (Web Audio API) al motor `useVoiceRecorder`
para cubrir dos comportamientos:

- **(a) Habló y luego calló** → auto-**ENVIAR** sin necesidad del 2º clic.
- **(b) Arrancó y nunca habló** (todo el tiempo bajo umbral) → **cortar** y avisar
  `voice.noSpeech` **sin subir** audio a Groq.

El 2º clic (parar a mano) sigue existiendo como camino manual; el auto-stop por
tiempo (10 s) se conserva como **red de seguridad superior**. Cero texto nuevo en el
schema de marca. No se toca `transcribeVoice` ni el endpoint `POST /voice/transcribe`.

---

## Contrato / arquitectura

### Piezas y dónde vive cada cosa

Se introduce **un módulo puro nuevo** más el cableado dentro del motor existente:

1. **`frontend/src/voice/silenceDetector.ts` — `createSilenceDetector` (PURO, testeable
   sin DOM).** Es una **máquina temporal** sin dependencias del navegador: recibe
   muestras de nivel de audio ya normalizadas (`0..1`) con su timestamp y decide qué
   evento emitir. NO conoce `AudioContext` ni `AnalyserNode`. Esto es lo que hace la
   detección testeable como lógica pura (regla de minimalismo §5: la lógica que se puede
   extraer pura, se extrae; el borde del navegador se mockea aparte).

   ```ts
   // firma propuesta (el implementer puede ajustar nombres, no la semántica)
   interface SilenceDetectorConfig {
     speechThreshold: number;   // nivel normalizado 0..1 por encima del cual = "voz"
     silenceHangMs: number;     // ventana de silencio TRAS voz que dispara auto-envío
     noSpeechTimeoutMs: number; // sin voz nunca → dispara no-speech
   }
   type SilenceEvent = 'send' | 'no-speech' | null;
   interface SilenceDetector {
     /** Alimenta una medida de nivel; devuelve el evento a disparar (o null). */
     push(level: number, nowMs: number): SilenceEvent;
     reset(): void;
   }
   function createSilenceDetector(cfg: SilenceDetectorConfig): SilenceDetector;
   ```

   **Semántica interna (el corazón del diseño):**
   - Mantiene dos marcas de tiempo: `startedAt` (primer `push`) y `hasSpoken` (bool) +
     `silenceSince` (instante en que el nivel cayó bajo umbral **después** de haber
     hablado).
   - En cada `push(level, now)`:
     - Si `level >= speechThreshold`: `hasSpoken = true`; `silenceSince = null` (se
       resetea la ventana de silencio; la voz "recarga" el temporizador).
     - Si `level < speechThreshold`:
       - Si `hasSpoken` y `silenceSince == null`: `silenceSince = now`.
       - Si `hasSpoken` y `now - silenceSince >= silenceHangMs`: **emite `'send'`**.
       - Si `!hasSpoken` y `now - startedAt >= noSpeechTimeoutMs`: **emite `'no-speech'`**.
   - Emitir un evento **no** cambia el estado interno (el motor llama a `reset()` o
     desmonta el detector tras actuar); el detector es idempotente y determinista, lo
     cual lo hace trivial de testear con una secuencia de muestras.

   > **Distinción (a) vs (b) — clave del requisito:** el flag `hasSpoken` es lo único
   > que separa "auto-enviar" de "no-speech". `hasSpoken` solo se activa si **alguna**
   > muestra superó `speechThreshold`. Sin él, el silencio inicial dispararía `no-speech`;
   > con él, dispara `send` tras la ventana de cuelgue.

2. **`frontend/src/voice/audioLevelMeter.ts` — helper del BORDE del navegador
   (fino, casi sin lógica).** Envuelve la Web Audio API: dado el `MediaStream` de
   `getUserMedia`, crea `AudioContext` + `AnalyserNode`, conecta la fuente, y expone
   un `sample(): number` que devuelve el **nivel normalizado 0..1** del frame actual,
   más un `close()` que cierra el `AudioContext`. Aísla lo no-testeable-en-jsdom en la
   capa más delgada posible.

   ```ts
   interface AudioLevelMeter {
     sample(): number;   // RMS normalizado 0..1 del frame actual
     close(): Promise<void> | void; // audioContext.close()
   }
   function createAudioLevelMeter(stream: MediaStream): AudioLevelMeter;
   ```

   **Cómo mide el nivel:** `AnalyserNode` con `fftSize` pequeño (p.ej. 512),
   `getByteTimeDomainData(Uint8Array)` sobre el dominio **temporal** (no frecuencia:
   para "¿hay voz o silencio?" el RMS de la forma de onda es más directo y barato que
   la FFT). RMS = `sqrt(mean((v-128)/128)^2))` → ya normalizado a `0..1`. Se prefiere
   `getByteTimeDomainData` (RMS) frente a `getByteFrequencyData` porque medimos energía,
   no espectro; menos ambigüedad de umbral.

3. **`frontend/src/voice/useVoiceRecorder.ts` — CABLEADO (motor existente).** El motor
   ya posee el `MediaStream`, el `MediaRecorder`, el auto-stop por tiempo, `releaseStream`
   y la máquina `idle/recording/transcribing/error`. Se le añade:
   - Al entrar en `recording` (tras `getUserMedia`): crear el `AudioLevelMeter` sobre el
     mismo `stream` y un `createSilenceDetector` con las constantes.
   - Un bucle de muestreo con `requestAnimationFrame` (o `setInterval` a `SAMPLE_MS`) que
     en cada tick hace `detector.push(meter.sample(), performance.now())`:
     - evento `'send'` → equivale al 2º clic: llama a `stop()` (el `onstop` de
       `MediaRecorder` ya ensambla el Blob, sube a Groq y emite `onResult`). **Ruta (a).**
     - evento `'no-speech'` → **corta sin subir**: para el bucle, para el recorder
       **descartando** los chunks (no llamar a `transcribe`), libera stream + meter, y
       fija `errorCode = 'no-audio'` + `status = 'error'`. **Ruta (b).**
   - **Teardown obligatorio** en `stop()`, en `onstop`, en la rama no-speech y en unmount:
     cancelar el rAF/interval, `meter.close()` (cierra el `AudioContext`), y el ya
     existente `releaseStream()`. El `AudioContext` NO puede quedar abierto ni el mic vivo.

   > **Por qué la ruta (b) descarta chunks en vez de reusar el `onstop`→`transcribe`→`''`
   > actual:** hoy el silencio se detecta *server-side* (Groq devuelve `''` → `'no-audio'`).
   > Con detección local **ya sabemos** que no hubo voz antes de subir, así que evitamos
   > la subida entera (menos datos, menos coste, más rápido). El camino Groq-`''` queda
   > como **segunda red** para el silencio que sí pasó el umbral local pero no era habla.

### Constantes (nombradas, en el motor; se calibran probando)

```ts
const SPEECH_THRESHOLD = 0.06;   // nivel RMS normalizado 0..1; por encima = "voz"
const SILENCE_HANG_MS = 1_500;   // silencio tras voz que dispara auto-envío
const NO_SPEECH_TIMEOUT_MS = 3_000; // sin voz nunca → no-speech (< MAX_RECORDING_MS)
const SAMPLE_MS = 100;           // cadencia de muestreo (~10 Hz), suficiente para voz
// MAX_RECORDING_MS = 10_000 se CONSERVA como red de seguridad superior.
```

**Invariante de tiempos:** `NO_SPEECH_TIMEOUT_MS (3s) < MAX_RECORDING_MS (10s)` y
`SILENCE_HANG_MS (1.5s) < MAX_RECORDING_MS`. Así la detección de silencio siempre
actúa **antes** que el tope por tiempo; el tope solo salta si el usuario habla de
forma continua >10 s (caso legítimo de corte).

> **NOTA de calibración (como el resto de la voz):** estos valores son un punto de
> partida razonable, no verdad revelada. `SPEECH_THRESHOLD` depende de la ganancia del
> micro y del ruido ambiente; puede necesitar 0.03–0.10. Se afinan probando en runtime
> con micrófono real en los 4 navegadores. Por eso son **constantes nombradas** y no
> literales dispersos.

---

## Parámetros configurables vs hardcoded

- **NO van al schema de marca.** El umbral y los tiempos son **comportamiento común a
  todas las marcas** (como el límite de 15 caracteres): no cambian entre shopinbaz y
  elektra, y meterlos en `brand_config` sería bloat sin caso de uso (regla de
  minimalismo §1). Se quedan como constantes del motor.
- Si en el futuro se quisiera afinar sin recompilar, la puerta natural sería una
  variable de entorno `VITE_*` — pero **no se diseña ahora** (YAGNI). Constantes basta.
- Cero hex, cero literales de texto: la detección no introduce ningún texto; reusa
  `voice.noSpeech` que ya existe.

---

## Cómo cambia la máquina de estados / UX

**La máquina de estados NO gana estados nuevos.** Se reusa `idle | recording |
transcribing | error`:

- **idle → recording:** igual que hoy (clic 1). Adicionalmente arranca el meter + detector.
- **recording (auto):** el bucle de muestreo corre en background. El usuario ve el mismo
  feedback actual (`voice.listeningLabel`, icono avión, pulso). **No se añade feedback
  visual nuevo** — "escuchando si sigues hablando" ES el estado `recording` que ya se
  muestra. (Regla de minimalismo: no inventar un 5º estado "esperando silencio" si el
  usuario no lo pidió; el pulso de `recording` ya comunica "estoy escuchando".)
- **recording → transcribing (auto, ruta a):** el detector emite `'send'`, el motor llama
  a su propio `stop()` interno → mismo camino que el 2º clic. El usuario ve el paso a
  `voice.transcribingLabel` sin haber tocado nada. **Este es el auto-envío.**
- **recording → error (auto, ruta b):** el detector emite `'no-speech'` → `errorCode
  'no-audio'` → `NameField` ya mapea `'no-audio'` a `voice.noSpeech` en la región
  `aria-live`. **Sin cambios en `NameField` para este caso.**
- **El 2º clic (`stop()` manual) sigue funcionando** exactamente igual: el usuario puede
  parar antes de que salte el cuelgue de silencio.

**`NameField.tsx`:** en principio **no cambia** — ya consume `status`/`errorCode`/`stop()`
y mapea `'no-audio'`→`voice.noSpeech`. El auto-envío se manifiesta como transiciones de
estado que el componente ya renderiza. El clamp de 15 (`clampToMax`) sigue igual y sigue
aplicándose sobre `onResult`. **Punto a validar en el test de integración:** que el
auto-envío rellene el campo sin 2º clic (ver §Plan de tests).

---

## Plan de tests (RED primero)

Todo mockeado, **sin audio real, sin red**. Tres niveles:

### T1 — `silenceDetector.test.ts` (lógica pura, sin DOM — el grueso del valor)

Se alimenta el detector con **secuencias de `(level, nowMs)`** y se asserta el evento.
No necesita jsdom ni mocks del navegador. Casos:

- **T1.a auto-enviar:** secuencia `silencio(bajo) → voz(alto) → silencio(bajo) sostenido
  ≥ SILENCE_HANG_MS` ⇒ el `push` que cruza la ventana devuelve `'send'`. Y `'send'`
  **no** aparece antes de completarse la ventana.
- **T1.b no-speech:** secuencia de niveles **siempre** `< speechThreshold` durante
  `≥ NO_SPEECH_TIMEOUT_MS` ⇒ devuelve `'no-speech'`; nunca `'send'`.
- **T1.c la voz recarga la ventana:** voz → silencio corto (< hang) → voz otra vez →
  silencio ≥ hang ⇒ `'send'` (no dispara en la primera pausa breve).
- **T1.d frontera:** justo por debajo de `SILENCE_HANG_MS` no emite; en el umbral exacto sí.
- **T1.e no-speech NO dispara si hubo voz temprana** aunque luego haya un silencio largo
  antes del hang completo mal medido (garantiza que `hasSpoken` gana a `no-speech`).

### T2 — `useVoiceRecorder.test.ts` (motor, con Web Audio mockeado)

Reutiliza el andamiaje existente (`MockMediaRecorder`, `MockStream`, `getUserMediaMock`,
timers falsos). **Se añade el mock de Web Audio** porque jsdom no trae `AudioContext`:

> **Cómo mockear `AudioContext` en jsdom (especificado para el tester):** jsdom no
> define `AudioContext`. Instalar en `globalThis` un doble:
> ```ts
> class MockAnalyser {
>   fftSize = 512; frequencyBinCount = 256;
>   // el test controla qué "forma de onda" devuelve → controla el nivel medido
>   getByteTimeDomainData = vi.fn((arr: Uint8Array) => arr.fill(nextLevelByte));
> }
> class MockAudioContext {
>   createAnalyser = () => new MockAnalyser();
>   createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
>   close = vi.fn(() => Promise.resolve());
> }
> (globalThis as any).AudioContext = MockAudioContext;
> ```
> El test manipula `nextLevelByte` (o una cola de valores) entre ticks de `SAMPLE_MS`
> con `vi.advanceTimersByTime` para simular voz/silencio. Si el motor usa
> `requestAnimationFrame`, mockear también `rAF`→`setTimeout(0)` o preferir `setInterval`
> con timers falsos (recomendado: `setInterval(SAMPLE_MS)`, más fácil de controlar con
> fake timers que rAF).

Casos:
- **T2.a "habló y calló" → onResult sin 2º clic:** `start()`; el meter devuelve niveles
  altos y luego bajos sostenidos; avanzar timers > `SILENCE_HANG_MS` ⇒ el motor llama a
  `stop()` solo → `MediaRecorder.onstop` → `transcribe` invocado una vez → `onResult('Ana')`
  → `status 'idle'`. **Sin que el test llame a `stop()`.**
- **T2.b "nunca habló" → no-audio SIN transcribe:** `start()`; el meter devuelve siempre
  niveles bajos; avanzar timers > `NO_SPEECH_TIMEOUT_MS` ⇒ `transcribe` **NO** se llama
  (`expect(transcribe).not.toHaveBeenCalled()`), `errorCode === 'no-audio'`, `status
  'error'`, y el mic se liberó (`MockTrack.stop` llamado).
- **T2.c teardown / AudioContext cerrado:** tras ruta (a), ruta (b), `stop()` manual y
  unmount ⇒ `MockAudioContext.close` llamado y no queda intervalo vivo (mic liberado).
- **T2.d red de seguridad por tiempo intacta:** con voz **continua** (nivel alto todo el
  rato, nunca cae bajo umbral) y sin silencio, avanzar a `MAX_RECORDING_MS` ⇒ auto-stop
  por tiempo dispara `onstop`→`transcribe` (comportamiento de `voice_groq_default`
  preservado; el detector no interfiere).
- **T2.e stop() manual antes del hang** sigue subiendo el audio (no lo rompe el detector).

### T3 — `NameField` (integración, motor mockeado)

- **T3.a auto-envío rellena el campo sin 2º clic:** con `useVoiceRecorder` mockeado para
  emitir `onResult('Ana')` tras `start()` (simulando la ruta a), el input muestra `Ana`
  con el clamp de 15 aplicado, sin haber disparado un segundo click.
- **T3.b no-speech muestra `voice.noSpeech`:** motor mockeado en `status 'error'` +
  `errorCode 'no-audio'` ⇒ la región `aria-live` muestra `voice.noSpeech` (ya cubierto
  por tests previos; se conserva como regresión).

> **Orden RED:** T1 falla porque `silenceDetector.ts` no existe. T2 falla porque el motor
> aún no crea meter/detector (las nuevas asserts de auto-send/no-speech-sin-transcribe
> quedan rojas). T3.a falla si el auto-envío no está cableado. RED puro antes del GREEN.

---

## Seguridad / privacidad (nota para el security-auditor)

- **Nada nuevo sale del navegador.** El `AnalyserNode` analiza la energía del audio
  **localmente** en tiempo real; no se transmite ni se persiste. El único dato que sale
  sigue siendo el `Blob` de audio a `POST /voice/transcribe`, **igual que hoy**.
- **Menos datos que antes:** en el caso (b) "nunca habló" **ya no se sube** audio a Groq
  (antes se subía un Blob vacío/ruido). Estrictamente menos superficie de datos.
- **Puntos a auditar (confirmar en el review/security):**
  1. `AudioContext.close()` se llama en **todas** las salidas de `recording` (ruta a,
     ruta b, stop manual, auto-stop por tiempo, unmount). Un `AudioContext` sin cerrar
     mantiene el grafo de audio y puede dejar el **micrófono activo** aunque el
     `MediaRecorder` pare.
  2. El bucle de muestreo (`setInterval`/rAF) se cancela en esas mismas salidas (no queda
     un timer leyendo el mic tras terminar).
  3. `releaseStream()` (ya existente) sigue parando todas las tracks; el meter comparte el
     **mismo** `MediaStream`, así que no se abre un segundo `getUserMedia` (una sola
     solicitud de permiso, un solo stream).
- No toca cifrado, claves, ni `CRYPTO_PRIVATE_KEY`. No añade dependencias ni endpoints.

---

## Alternativas consideradas

Feature media (lógica temporal nueva + borde de navegador) → se documentan.

1. **Detección server-side (subir siempre y que Groq/el backend decidan "vacío").**
   Es lo que hay hoy parcialmente (Groq `''`→`no-audio`). Descartada como *única*
   solución: no resuelve el auto-envío (seguiría exigiendo 2º clic) y **sí sube** audio
   vacío (coste/latencia). Se **conserva** como segunda red, no como mecanismo primario.

2. **Librería VAD (voice-activity-detection, p.ej. `@ricky0123/vad-web` o similar).**
   Descartada por minimalismo (§4): añade una dependencia nueva (decisión de
   leader/usuario, no un supuesto), a menudo arrastra un modelo WASM/ONNX (peso en el
   bundle) para un problema que un umbral RMS + ventana temporal resuelve con ~40 líneas.
   Sobredimensionado para "¿el usuario dejó de hablar?".

3. **Web Audio API + umbral RMS local (RECOMENDADA).** Soportada en los 4 navegadores
   (Chrome/Firefox/Safari/Brave), **local**, misma familia que `getUserMedia`/
   `MediaRecorder` que ya funciona en el repo, **no depende del servicio de Google** que
   causó el problema de Brave con Web Speech (ADR 22/23). Sin dependencias nuevas, sin
   modelo, lógica testeable como función pura.

4. **Estructura: todo dentro de `useVoiceRecorder` vs detector puro extraído.**
   Se elige **extraer `createSilenceDetector` puro** (+ `audioLevelMeter` fino de borde)
   frente a incrustar toda la lógica temporal en el hook: hace el corazón de la feature
   testeable sin mockear el DOM y aísla lo no-testeable-en-jsdom en la capa más delgada.

---

## Recomendación

Implementar la **alternativa 3+4**: Web Audio API con umbral RMS, partido en
`createSilenceDetector` (puro) + `createAudioLevelMeter` (borde) + cableado en
`useVoiceRecorder`. Sin nuevos estados de máquina, sin texto nuevo de marca, sin
dependencias, sin tocar backend ni `transcribeVoice`. Conservar el auto-stop por tiempo
(10 s) como red superior y el silencio server-side (Groq `''`) como segunda red.

### ¿requires_approval?

**Propuesta: `requires_approval: false`.** Razonamiento: la feature es **UX pura del
frontend**. **No toca** cifrado, claves, `CRYPTO_PRIVATE_KEY`, el contrato con el
backend, ni el endpoint; **no añade dependencias** ni datos que salgan del navegador
(de hecho reduce lo que se sube). El riesgo es de calibración (umbral/tiempos), acotado
y afinable en runtime, no de seguridad ni de arquitectura irreversible. Encaja con el
criterio del repo (las features de UX de voz previas — `voice_ux`, `voice_reliability` —
fueron `requires_approval: false`; las que tocaban proveedor/red/arquitectura — Groq,
universal — sí lo requerían).

> **Gate humano recomendado (no bloqueante del diseño):** validar los **valores iniciales
> de las 3 constantes** al probar en runtime con micrófono real, y el ADR 24 abajo antes
> de mergear. La calibración es donde el humano aporta señal que el test mockeado no puede.

---

## ADR 24 (borrador para `docs/decisiones.md`)

> ## 24. Detección de silencio local (Web Audio API) + auto-envío del dictado — feature `voice_auto_send`
>
> - **Contexto (2026-07-05):** tras `voice_groq_default` (ADR 23), el dictado es
>   grabar→enviar de 2 clics con un único auto-stop **por tiempo** (`MAX_RECORDING_MS
>   = 10 s`). Probando en runtime, el usuario detecta el hueco: si pulsas "grabar" y no
>   hablas, a los 10 s se sube un `Blob` vacío/ruido a Groq igualmente (coste, latencia,
>   cero resultado). Y el envío normal exige un 2º clic manual.
> - **Decisión (con el usuario, 2026-07-05):** añadir **detección de silencio local** con
>   la **Web Audio API** (`AudioContext` + `AnalyserNode` sobre el mismo `MediaStream` de
>   `getUserMedia`) al motor `useVoiceRecorder`, con dos efectos: (a) **auto-envío** cuando
>   el usuario habló y luego calló (silencio sostenido `SILENCE_HANG_MS = 1.5 s` tras haber
>   superado el umbral); (b) **corte con aviso `voice.noSpeech` sin subir audio** cuando
>   nunca se habló (`NO_SPEECH_TIMEOUT_MS = 3 s` siempre bajo umbral). El auto-stop por
>   tiempo (10 s) se conserva como red superior; el silencio server-side (Groq `''`→
>   `no-audio`) como segunda red. La detección se parte en `createSilenceDetector` (lógica
>   temporal pura y testeable) + `createAudioLevelMeter` (borde Web Audio, mide RMS
>   normalizado con `getByteTimeDomainData`) + cableado en el motor.
> - **Distinción (a)/(b):** un flag `hasSpoken` (alguna muestra superó `SPEECH_THRESHOLD
>   ≈ 0.06`) separa "auto-enviar" de "no-speech". Sin voz previa el silencio dispara
>   `no-speech`; con voz previa dispara `send` tras la ventana de cuelgue.
> - **Por qué Web Audio API:** soportada en los 4 navegadores (Chrome/Firefox/Safari/
>   Brave), **100% local**, misma familia que `getUserMedia`/`MediaRecorder` que ya
>   funciona; **no depende del servicio de reconocimiento de Google** que rompió el
>   dictado en Brave con Web Speech (ADR 22/23) — no reintroduce ese problema.
> - **Parámetros:** `SPEECH_THRESHOLD`, `SILENCE_HANG_MS`, `NO_SPEECH_TIMEOUT_MS`,
>   `SAMPLE_MS` como **constantes nombradas del motor**, NO en el schema de marca (son
>   comportamiento común a todas las marcas, como el límite de 15). Valores iniciales
>   razonables; se **calibran probando** con micrófono real (como el resto de la voz).
>   Invariante: `SILENCE_HANG_MS < NO_SPEECH_TIMEOUT_MS < MAX_RECORDING_MS`.
> - **Privacidad:** el análisis de nivel es local; **nada nuevo** sale del navegador y en
>   el caso "nunca habló" **ya no se sube** audio (menos datos que antes). Exigencia:
>   `AudioContext.close()` y cancelación del bucle de muestreo en toda salida de
>   `recording` (auto-envío, no-speech, stop manual, auto-stop por tiempo, unmount) para
>   no dejar el micrófono vivo.
> - **Descartado:** (1) detección **server-side** como mecanismo primario — no da
>   auto-envío y sube audio vacío; se conserva solo como segunda red. (2) **Librería VAD**
>   (`vad-web` y afines) — dependencia nueva + modelo WASM/ONNX para un problema que un
>   umbral RMS + ventana temporal resuelve sin dependencias; sobredimensionado.
> - **`requires_approval`: false** — UX del frontend; no toca cifrado/claves/contrato/
>   backend, no añade dependencias, reduce datos subidos. Gate humano recomendado solo
>   para calibrar las constantes en runtime.

---

## Criterios de aceptación traducibles a tests

1. Existe un `createSilenceDetector` **puro** (sin `AudioContext`) que, alimentado con
   una secuencia de niveles: silencio→voz→silencio sostenido `≥ SILENCE_HANG_MS` emite
   `'send'`; niveles siempre bajos durante `≥ NO_SPEECH_TIMEOUT_MS` emiten `'no-speech'`;
   una pausa breve entre voces (< hang) NO dispara `'send'`. (T1)
2. En `useVoiceRecorder`, con Web Audio mockeado, "habló y calló" (niveles altos→bajos)
   dispara el envío **sin 2º clic**: `transcribe` se llama una vez y `onResult` recibe el
   texto, `status` vuelve a `idle`. (T2.a)
3. En `useVoiceRecorder`, "nunca habló" (niveles siempre bajos) tras `NO_SPEECH_TIMEOUT_MS`
   **no llama a `transcribe`**, deja `errorCode 'no-audio'` + `status 'error'` y libera el
   micrófono. (T2.b)
4. El `AudioContext` se **cierra** (`close()`) y el bucle de muestreo se cancela en las
   cuatro salidas de `recording` (auto-envío, no-speech, stop manual, unmount). (T2.c)
5. El auto-stop **por tiempo** (`MAX_RECORDING_MS`) sigue funcionando con voz continua sin
   silencio: sube el audio a los 10 s (comportamiento de `voice_groq_default` intacto). (T2.d)
6. `stop()` manual antes del cuelgue de silencio sigue subiendo el audio. (T2.e)
7. En `NameField`, el auto-envío rellena el campo con el texto transcrito **sin un 2º clic**,
   respetando el clamp de 15; el caso no-speech muestra `voice.noSpeech` en la región
   `aria-live`. (T3)
8. Cero literales/hex y **cero texto nuevo** en el schema de marca: reusa `voice.noSpeech`,
   `voice.listeningLabel`, `voice.transcribingLabel`. (revisión estática)
