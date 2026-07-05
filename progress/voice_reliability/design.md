# Design — voice_reliability

## Objetivo

Refinar (no reabrir) la UX de voz aprobada en `voice_ux` con tres mejoras de
fiabilidad descubiertas probando en runtime (Chrome/Brave/Firefox + micrófono
real):

1. **interimResults:true** en `useVoiceInput` → transcripción parcial en vivo,
   menos "varios intentos", campo que se rellena mientras se habla.
2. **Ocultar** (no renderizar) el botón de micrófono cuando NO hay forma de
   dictar: (a) navegador sin soporte (Firefox), (b) el servicio de reconocimiento
   falla por bloqueo/red (`errorCode='network'`, observado en Brave).
3. **Sesión sin captura** (`onend` limpio, sin resultado y sin error) → comunicar
   con el texto de marca EXISTENTE `voice.noSpeech` en la región `aria-live`.

Restricciones que se respetan: cero texto nuevo en el schema (se reusa
`voice.noSpeech`); el clamp de 15 sigue viviendo en `NameField`; el contrato de
`onResult` (recibe un `string`) NO cambia; `WelcomeScreen` intacto; cero
literales/hex en componentes.

---

## Contrato / arquitectura

### Cambio 1 — `interimResults:true` en el hook

Se toca solo el `start()` de `useVoiceInput.ts`.

- Config de la instancia: `recognition.interimResults = true`
  (`continuous = false` se mantiene; ver decisión abajo). `maxAlternatives = 1`.
- `onresult` deja de leer un único índice y **itera desde `event.resultIndex`
  hasta el final de `event.results`**, concatenando los `transcript` de cada
  `results[i][0]`. Emite en **cada** evento (parcial o final):

  ```
  onresult = (event) => {
    let text = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0]?.transcript ?? '';
    }
    text = text.trim();      // Chrome antepone espacios en los parciales
    if (text === '') return; // nada útil que emitir todavía
    hadResultRef.current = true;   // ← marca "hubo captura" (cambio 3)
    setTranscript(text);
    onResultRef.current(text);
  };
  ```

- **`transcript` refleja el parcial en vivo** (última cadena acumulada). Es
  coherente con el uso actual (feedback) y con el clamp aguas abajo.
- **Firma de `onResult` SIN cambios**: sigue recibiendo un `string`. No se añade
  un flag `isFinal` al callback. Justificación: `NameField` ya trata cada emisión
  igual (aplica `clampToMax` y hace `onChange`); distinguir parcial/final en el
  consumidor no aporta valor y rompería el contrato/tests estables. El estado del
  nombre queda con la **última** emisión, que en una frase corta converge al final.
- **El clamp de 15 no se rompe**: `NameField.onResult = (t) => onChange(clampToMax(t))`
  se ejecuta en cada emisión; cada parcial se recorta a 15. Con `continuous:false`
  y frases de nombre (≤15 típicamente) el recorte es idempotente.

**¿`continuous`?** Se mantiene `continuous:false` (una frase, la API cierra sola
al detectar el fin del habla). Justificación: el nombre es una frase corta;
`continuous:true` mantendría el micrófono abierto acumulando resultados y exigiría
gestionar reinicios/paradas explícitas, complejidad no pedida. La mejora de
fiabilidad la aporta `interimResults` (feedback en vivo, tolerancia a pausas), no
`continuous`. Se deja documentado como descartado.

### Cambio 3 — Señal de "sesión terminó sin captura" (mecánica en el hook)

Se necesita distinguir "onend tras haber transcrito algo" de "onend sin nada".

- Nueva ref de sesión: `const hadResultRef = useRef(false);`
- En `start()`, **antes** de arrancar, se resetea: `hadResultRef.current = false;`
- En `onresult` (ya mostrado arriba) se pone `hadResultRef.current = true` en la
  primera emisión útil.
- En `onend` se decide:

  ```
  onend = () => {
    recognitionRef.current = null;
    setStatus((prev) => {
      if (prev === 'error') return prev;           // error real ya fijado por onerror
      if (!hadResultRef.current) {                 // cerró sin captar nada
        setErrorCode('no-speech');                 // ← 'no-speech' SINTÉTICO
        return 'error';
      }
      return 'idle';                               // captó algo → cierre normal
    });
  };
  ```

**No colisiona con el `no-speech` real de `onerror`.** Chrome, cuando detecta
silencio, suele disparar `onerror('no-speech')` y luego `onend`; en ese caso
`onerror` ya dejó `status='error'` + `errorCode='no-speech'`, y el guard
`if (prev === 'error') return prev` de `onend` no lo pisa. El caso nuevo cubre la
otra rama observada: `onend` **sin** `onerror` previo y **sin** `onresult`. Ambos
caminos convergen en el **mismo** estado observable (`error` + `no-speech`), que
`NameField` ya mapea a `voice.noSpeech`. Desde fuera del hook son
indistinguibles, y así debe ser: el usuario ve el mismo aviso.

**Reintento sigue funcionando**: `start()` desde `error` ya limpia `errorCode`
(`setErrorCode(null)`) y resetea `hadResultRef`. Sin cambios en esa rama.

**`stop()` manual sin captura también sintetiza `no-speech`** (decisión del
usuario, confirmada): parar la sesión a propósito sin haber dicho nada dispara
igualmente el aviso `voice.noSpeech`, porque `stop()` provoca un `onend` sin
captura y `onend` no distingue el origen (natural vs manual). El mensaje es veraz
(no se capturó nada) y se prefiere la simplicidad a una excepción para `stop()`.
Esto **obsoleta dos tests de `voice_capture`** en `useVoiceInput.test.ts` que
codificaban el comportamiento viejo (`idle` tras cerrar sin captura) — ver la
sección de regresión: deben actualizarse a la spec nueva.

### Cambio 2 — Ocultar el botón: cómo lo sabe `NameField`

Dos gatillos de ocultación, ambos → **no renderizar** el `<button>` del micrófono:

- **(a) `!isSupported`** (Firefox): ya expuesto por el hook. Directo.
- **(b) `network` en esta sesión**: se necesita un flag "latch" que, una vez visto
  un `errorCode='network'`, permanezca aunque el usuario reintente. Opciones
  evaluadas (ver Alternativas). **Elegida: el hook expone una señal nueva
  `voiceUnavailable: boolean`** que arranca en `false` y se hace `true` de forma
  permanente (dentro de la vida del hook) al primer `network`.

  Mecánica en el hook — nuevo estado con latch en `onerror`:

  ```
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  ...
  onerror = (event) => {
    recognitionRef.current = null;
    const code = normalizeErrorCode(event.error);
    if (code === 'network') setVoiceUnavailable(true);   // latch de sesión
    if (code === 'aborted') { setStatus('idle'); setErrorCode(null); return; }
    setStatus('error');
    setErrorCode(code);
    onErrorRef.current?.(code);
  };
  ```

  - `voiceUnavailable` **NO se resetea** en `start()` (a diferencia de `errorCode`):
    un navegador que bloquea el servicio de Google lo bloquea siempre, así que no
    se reintenta el mic esa sesión. No se persiste entre recargas (es estado del
    hook en runtime, se pierde al recargar). Esto cumple la decisión "un solo
    network basta para ocultar".
  - Se añade `voiceUnavailable` al objeto de retorno (`UseVoiceInputResult`).

**Cómo decide `NameField` (regla única de render):**

```
const showMic = isSupported && !voiceUnavailable;
```

- Si `!showMic` → el `<button>` del micrófono **no se renderiza** (ni el bloque
  `isListening` de la fila del contador, que solo tiene sentido con mic).
- El `<input>` manual, el contador y la región `role="status"` (para el aviso
  `noSpeech`) **siempre** se renderizan.
- Se elimina del botón la rama `!isSupported` que ponía `disabled` +
  `voice.unsupported` como label/title. `voice.unsupported` **deja de usarse en el
  componente** (pero NO se borra del schema).

**Por qué una señal nueva y no derivar de `errorCode`:** `errorCode` es efímero
(se limpia al reintentar y al arrancar); derivar la ocultación de él no daría el
comportamiento "latch de sesión". Un flag booleano dedicado es la opción más
limpia, con el menor cambio de contrato (solo **añade** un campo al retorno, no
altera los existentes) y trivial de mockear en los tests de `NameField`
(`voiceMock.voiceUnavailable = true`).

---

## Tokens y textos de marca (UI)

Sin campos nuevos. Se reutiliza lo existente en `brand/core/schema.ts` objeto
`voice`:

| Uso | Token/texto de marca |
|---|---|
| Aviso "sesión sin captura" | `voice.noSpeech` (ya mapeado en `voiceErrorText('no-speech')`) |
| Label/estado de escucha | `voice.listeningLabel`, `voice.startLabel` (sin cambios) |
| Errores permiso/genérico | `voice.permissionDenied`, `voice.genericError` (sin cambios) |
| `voice.unsupported` | **Deja de renderizarse** (mic oculto); permanece en el schema |
| Colores | tokens `text-brand-*` / `bg-brand-*` existentes; cero hex |

---

## Archivos en alcance

| Archivo | Cambio |
|---|---|
| `frontend/src/voice/useVoiceInput.ts` | `interimResults:true`; `onresult` itera desde `resultIndex`; `hadResultRef` (cambio 3); `onend` sintetiza `no-speech` sin captura; estado+retorno `voiceUnavailable` con latch `network` (cambio 2b) |
| `frontend/src/voice/useVoiceInput.test.ts` | Añadir casos (interim, onend-sin-captura, latch network) y **actualizar** la aserción `interimResults===false` → `true` |
| `frontend/src/features/welcome/NameField/NameField.tsx` | `showMic = isSupported && !voiceUnavailable`; ocultar `<button>` mic y fila `listeningLabel` cuando `!showMic`; eliminar rama `disabled`/`voice.unsupported` |
| `frontend/src/features/welcome/NameField/NameField.test.tsx` | Añadir `voiceUnavailable` al `voiceMock`; **actualizar** casos 13/14 de no-soporte (ver Regresión); añadir casos de ocultar-network, aviso-sin-captura, interim-con-clamp |

**`WelcomeScreen` INTACTO** (verificado leyendo `WelcomeScreen.tsx`): no consume
nada de `useVoiceInput` ni pasa props de voz; solo compone `<NameField value onChange>`.
Toda la lógica de voz vive en el hook + `NameField`. Su test tampoco cambia.

---

## Contrato de tests para el tester (RED antes de GREEN)

### (A) Tests del HOOK — `useVoiceInput.test.ts`

Se mockea SpeechRecognition (patrón `MockSpeechRecognition` ya existente). Añadir a
la clase mock un helper `emitInterimResult(text)` análogo a `emitFinalResult` pero
con `isFinal:false`, y un `emitResults(chunks)` que permita `resultIndex>0` para el
caso multi-segmento. La estructura de `results` debe ser array-like indexable con
`.length` (como ya lo hace `emitFinalResult`).

1. **Config interim** — tras `start()`, `lastInstance.interimResults === true`
   (y sigue `continuous === false`, `maxAlternatives === 1`). *(Actualiza el caso
   existente que hoy afirma `interimResults===false`.)*
2. **Emite parciales** — `start()`, luego `emitInterimResult('Ju')` →
   `onResult` llamado con `'Ju'` y `result.current.transcript === 'Ju'`; después
   `emitFinalResult('Juan')` → `onResult` con `'Juan'`, `transcript === 'Juan'`.
   (`onResult` llamado 2 veces en total.)
3. **Iteración desde resultIndex** — un evento con `resultIndex:0` y dos segmentos
   `['Hola ', 'mundo']` → `onResult` con `'Hola mundo'` (concatenación + trim).
4. **onend SIN captura → error/no-speech** — `start()`, luego `emitEnd()` **sin**
   ningún `onresult` ni `onerror` previo → `status === 'error'` y
   `errorCode === 'no-speech'`.
5. **onend CON captura → idle** — `start()`, `emitFinalResult('Ana')`, `emitEnd()`
   → `status === 'idle'`, `errorCode === null` (no se sintetiza no-speech).
6. **no-speech real (onerror) no colisiona** — `start()`, `emitError('no-speech')`
   (→ `error`/`no-speech`), luego `emitEnd()` → sigue `error`/`no-speech`
   (el guard `prev==='error'` no lo pisa).
7. **latch network: `voiceUnavailable`** — inicial `voiceUnavailable === false`;
   `start()`, `emitError('network')` → `voiceUnavailable === true` y
   `errorCode === 'network'`.
8. **latch persiste tras reintento** — tras el network, `start()` de nuevo →
   `errorCode` se limpia a `null` pero `voiceUnavailable` **sigue `true`**.
9. **otros errores NO activan el latch** — `emitError('not-allowed')` (o
   `no-speech`, `audio-capture`) → `voiceUnavailable === false`.
10. **reset de sesión de `hadResult`** — `start()`, `emitFinalResult('Ana')`,
    `emitEnd()` (idle); `start()` otra vez, `emitEnd()` sin captura →
    `error`/`no-speech` (la ref se reseteó por sesión, no arrastra el true anterior).

### (B) Tests de `NameField` — `NameField.test.tsx`

El `voiceMock` (hoisted) gana el campo `voiceUnavailable: false` (default) en su
forma y en el objeto que retorna el mock; se resetea en cada `beforeEach`.

11. **mic NO renderizado si `!isSupported`** — `voiceMock.isSupported = false`
    (`status='unsupported'`) → `screen.queryByRole('button', { name: brand.voice.startLabel })`
    es `null` **y** `queryByRole('button', { name: brand.voice.unsupported })` es
    `null` (ningún botón de mic). El `textbox` sigue presente.
12. **mic oculto tras `network`** — `voiceMock.voiceUnavailable = true`
    (con `isSupported=true`) → `queryByRole('button', { name: brand.voice.startLabel })`
    es `null`. El `textbox` sigue presente y el contador se muestra.
13. **mic visible en caso normal** — defaults (`isSupported=true`,
    `voiceUnavailable=false`) → `getByRole('button', { name: brand.voice.startLabel })`
    presente (regresión de que no se oculta de más).
14. **aviso noSpeech en aria-live tras sin-captura** — `voiceMock.status='error'`,
    `voiceMock.errorCode='no-speech'` → `getByRole('status')` tiene
    `textContent` = `brand.voice.noSpeech`. (Reusa el mapeo existente; confirma que
    el estado sintético del hook se comunica igual que el real.)
15. **interim rellena con clamp** — `voiceMock.onResult?.('Ju')` →
    `onChange` con `'Ju'`; luego `voiceMock.onResult?.('JuanNombreLarguísimoDeMás')`
    → `onChange` con exactamente 15 chars. (Cada emisión, parcial o final, se
    recorta; el contrato de onResult sigue siendo string.)

**Qué se observa (preciso):** ocultación → `queryByRole('button', {name})` → `null`;
presencia → `getByRole('button', {name})`; aviso → `getByRole('status')` +
`toHaveTextContent`; input siempre → `getByRole('textbox')`. Nunca se observa por
clase CSS de color ni string hardcodeado; siempre por `brand.voice.*`.

---

## Nota de regresión (tests EXISTENTES que cambian)

El comportamiento de no-soporte cambió de "deshabilitar" a "ocultar", así que los
casos 13/14 del bloque `NameField — UX de voz: no-soporte (voice_ux casos 13-14)`
de `NameField.test.tsx` y el caso análogo del bloque white-label (caso 15,
"el aria-label de no-soporte proviene de la marca activa") **quedan obsoletos** y
el tester debe **actualizarlos**. Esto es legítimo: la spec cambió (no es
"modificar tests para pasar").

Concretamente:

- **Caso 13** (`sin soporte: el botón de voz está disabled y su aria-label es
  voice.unsupported`): pasa a esperar botón **AUSENTE** →
  `queryByRole('button', { name: brand.voice.unsupported })` es `null` y también
  `queryByRole('button', { name: brand.voice.startLabel })` es `null`.
- **Caso 14** (`sin soporte: el textbox sigue presente`): **se mantiene tal cual**
  (el formulario no se rompe; el input sigue). No cambia.
- **Caso 15 white-label** (`el aria-label de no-soporte proviene de la marca
  activa`): **se elimina o se reconvierte**. Ya no hay botón de no-soporte con
  `voice.unsupported`; el white-label del resto (startLabel/listeningLabel/error)
  sigue cubierto por los otros sub-casos del bloque 15, que no cambian.

Igualmente en `useVoiceInput.test.ts`, la aserción existente
`expect(inst.interimResults).toBe(false)` (bloque "arranque y escucha") pasa a
`toBe(true)`. El resto de tests del hook (mapeo de errores, idempotencia, cleanup,
aborted→idle) **no cambian**: el guard de `onend` respeta `prev==='error'` y el
latch solo añade estado.

También: el mock hoisted de `NameField.test.tsx` gana `voiceUnavailable: false` en
su tipo `VoiceMock`, en el objeto inicial y en el retorno de `vi.mock`. Sin esto,
los tests nuevos no pueden simular el gatillo.

---

## Alternativas consideradas

### Cómo señalizar "ocultar por network" (cambio 2b)

- **A. Flag nuevo `voiceUnavailable` (RECOMENDADA).** Añade un campo booleano al
  retorno del hook, con latch en `onerror('network')`, no reseteado por `start()`.
  Pros: cambio aditivo (no altera contratos existentes), semántica explícita,
  trivial de mockear. Contra: un campo más en el retorno.
- **B. Reusar `isSupported` volviéndolo `false` tras network.** Pros: `NameField`
  ya oculta con una sola condición. Contras: `isSupported` hoy es feature-detection
  inmutable (`useState` sin setter, lazy init); mutarlo mezcla dos conceptos
  distintos ("el navegador no tiene la API" vs "el servicio está bloqueado") y
  ensucia su semántica y sus tests. Descartada.
- **C. Derivar en `NameField` desde `errorCode==='network'`.** Contras: `errorCode`
  es efímero (se limpia al reintentar/arrancar); no da el "latch de sesión" que la
  decisión exige ("un solo network basta el resto de la sesión"). Descartada.

### Cómo señalizar "sesión sin captura" (cambio 3)

- **A. `status='error'` + `errorCode='no-speech'` sintético (RECOMENDADA, y la
  sugerida en el backlog).** Reusa el mapeo y el texto de marca existentes; el
  usuario ve el mismo aviso que en un `no-speech` real, que es lo deseable. Cero
  contrato nuevo hacia `NameField`.
- **B. Nuevo `VoiceStatus`/campo p.ej. `endedEmpty`.** Contras: amplía el contrato
  y obliga a `NameField` a un mapeo nuevo para el MISMO mensaje visible. Sin
  beneficio. Descartada.

### `continuous`

- Mantener `continuous:false` (RECOMENDADA): una frase, la API cierra sola.
- `continuous:true`: mantiene el mic abierto; exige gestionar paradas/reinicios y
  no aporta a la captura de un nombre corto. Descartada.

---

## Recomendación

Aplicar las tres opciones A: `interimResults:true` con `onresult` que itera desde
`resultIndex` (firma de `onResult` intacta); flag `voiceUnavailable` con latch de
`network` para ocultar el mic; y `no-speech` sintético en `onend` sin captura.
`NameField` oculta el mic con `showMic = isSupported && !voiceUnavailable` y
comunica el aviso por la región `role="status"` ya existente. `WelcomeScreen`
intacto. Cero campos nuevos en el schema, cero literales/hex.

---

## Criterios de aceptación traducibles a tests

- El hook fija `interimResults:true` (y mantiene `continuous:false`,
  `maxAlternatives:1`).
- Un resultado interino emite `onResult(parcial)` y actualiza `transcript`; el
  final lo refina; `onResult` recibe siempre `string` (contrato intacto).
- `onresult` con varios segmentos desde `resultIndex` concatena correctamente.
- `onend` sin ninguna emisión ni error previo deja `status='error'`,
  `errorCode='no-speech'`; con emisión previa deja `status='idle'`.
- Un `no-speech` real vía `onerror` seguido de `onend` no se altera.
- `voiceUnavailable` arranca `false`, se activa (y queda latcheado) al primer
  `errorCode='network'`, sobrevive a `start()`, y NO se activa con otros errores.
- `NameField`: el botón de mic NO se renderiza si `!isSupported` ni si
  `voiceUnavailable`; el `textbox` y el contador siempre presentes.
- `NameField`: con `errorCode='no-speech'` (real o sintético) la región
  `role="status"` muestra `voice.noSpeech`.
- `NameField`: cada emisión de voz (parcial o final) se recorta a 15 antes de
  `onChange`.
- Todo observado por rol/aria/texto de marca; cero literales/hex; `voice.unsupported`
  permanece en el schema aunque el componente ya no lo renderice.
