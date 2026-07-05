# Design — voice_ux

## Objetivo

Cablear la UX completa del dictado por voz dentro de `NameField`, consumiendo el
resto de la API del hook `useVoiceInput` (`status`/`isListening`/`errorCode`/`stop`)
que hoy se ignora. Cierra el gap observado: sin toggle para parar, sin feedback de
"escuchando", sin comunicar errores/no-soporte. **Sin tocar el hook** (cumple ya su
acceptance) y **sin literales ni hex** en el componente.

## Contrato / arquitectura

Feature de **integración** en un componente ya existente. Nada de piezas nuevas:
el hook, los textos de marca (`voice.*`) y el patrón de tokens ya existen. El
minimalismo aplica — no se crea util nueva, no se añade dependencia, no se toca el
schema (los 6 textos + `lang` cubren todos los estados).

Archivos en alcance:
- `frontend/src/features/welcome/NameField/NameField.tsx` — se amplía.
- `frontend/src/features/welcome/NameField/NameField.test.tsx` — el tester añade casos.
- `WelcomeScreen.tsx` — **NO cambia** (verificado: es dueño del estado del nombre y
  compone `NameField`; toda la UX de voz vive dentro de `NameField`, que ya recibe el
  hook). Confirmado leyendo el archivo.

El hook mock del test ya expone `status/isSupported/isListening/errorCode/stop`
(ver `NameField.test.tsx` líneas 43-68): el tester controla los estados sin
infraestructura nueva.

### 1. Máquina de estados del botón (toggle)

El botón lee `isListening` del hook (que es `status === 'listening'`).

| Estado del hook | onClick | Apariencia del botón | aria-pressed |
|---|---|---|---|
| `idle` (o `error`) | `start()` | icono micrófono, `text-brand-primary` | `false` |
| `listening` | `stop()` | icono micrófono + feedback de pulso (ver §3), color acentuado | `true` |
| `unsupported` | (deshabilitado) | icono atenuado, `disabled` | `false` |

Handler único:
```
onClick = () => { isListening ? stop() : start(); }
```
`start()` y `stop()` ya son idempotentes/no-op seguros en el hook, así que no hace
falta guardas extra. Tras un error, `status` vuelve a `idle` en la siguiente sesión
(el hook limpia `errorCode` en `start()`), por eso `error` se trata como `idle` para
el onClick.

### 2. aria-label dinámico y semántica del botón

- `role="button"` implícito (elemento `<button type="button">`).
- `aria-label`: `isListening ? voice.listeningLabel : voice.startLabel`.
- `aria-pressed={isListening}` — comunica el estado toggle a lectores de pantalla.
- El icono `<svg>` mantiene `aria-hidden="true"` (el texto accesible vive en el
  aria-label de marca, cero literal en el SVG).
- Sin soporte: además del `disabled`, `aria-label={voice.unsupported}` y `title`
  (tooltip) con el mismo texto de marca, para que quede claro por qué está inerte.

### 3. Feedback visual de "escuchando"

Dos señales, ambas desde marca y ambas respetando `prefers-reduced-motion`:

1. **Pulso en el botón** mientras `isListening`: clase Tailwind
   `motion-safe:animate-pulse` (animación estándar de Tailwind v4, sin CSS nuevo).
   Con `motion-reduce` la clase no aplica y el botón queda estático — el cambio de
   color/estado sigue siendo la señal no-animada.
2. **Etiqueta textual** `voice.listeningLabel` ("Escuchando…") visible mientras
   `isListening`, renderizada junto al contador o bajo el input, en
   `text-brand-primary`/`text-brand-accent` (token, cero hex). Esta etiqueta es la
   señal accesible y no-dependiente-de-color/movimiento (cubre daltonismo y
   reduced-motion a la vez).

El color acentuado del botón en listening usa `text-brand-accent` (token existente).
Cero literal: el único texto es `voice.listeningLabel`.

### 4. Mapeo errorCode → texto de marca

`errorCode` es `VoiceErrorCode | null`. `'aborted'` nunca llega como error (el hook
lo normaliza a `idle` con `errorCode=null`), así que no se mapea.

| VoiceErrorCode | Texto de marca | Razón |
|---|---|---|
| `not-allowed` | `voice.permissionDenied` | permiso de micrófono denegado |
| `no-speech` | `voice.noSpeech` | no se captó voz |
| `audio-capture` | `voice.genericError` | fallo de hardware/captura |
| `network` | `voice.genericError` | fallo de red del reconocedor |
| `unknown` | `voice.genericError` | cualquier otro |
| `aborted` | (no aplica) | el hook lo trata como idle, `errorCode` queda null |

Presentación: región **`aria-live="polite"`** (no `assertive`, no interrumpe) con
`role="status"`, visible solo cuando `status === 'error'` y `errorCode !== null`.
Texto en `text-brand-accent`. Se rinde dentro de `NameField`, debajo del input
(coherente con el contador), para que la asistencia técnica lo anuncie sin robar
foco. El `unsupported` NO va aquí (no es un error de sesión, se comunica en el botón
según §5).

Helper local puro (dentro del componente, no util exportada) que mapea
`VoiceErrorCode -> string` leyendo `voice`. No entra al schema.

### 5. No-soporte (isSupported === false)

**Decisión: botón visible pero `disabled`** (no ocultarlo).

Justificación: ocultar el botón deja al usuario sin saber que la voz existió y sin
pista de por qué; un botón deshabilitado con `aria-label`/`title = voice.unsupported`
comunica la degradación elegante que pide el acceptance ("no-soporte se comunica con
los textos de marca"). El input manual sigue siendo el camino principal, así que el
formulario nunca se rompe (el test actual ya lo verifica). Visualmente el botón va
atenuado con `disabled:opacity-50` (patrón ya usado en el botón submit de
`WelcomeScreen`), sin animación de pulso.

### 6. Punto opcional del backlog (interimResults / continuous)

**Recomendación: NO tocar el hook en esta feature.** El hook actual
(`interimResults: false`, `continuous: false`) entrega la transcripción **final** vía
`onResult`, y `NameField` ya la vuelca al estado con el tope de 15. El acceptance #3
("la transcripción es perceptible") se cumple con: la señal de "escuchando" (§3) + el
input rellenándose al terminar la frase. Añadir `interimResults` daría feedback en
vivo palabra-a-palabra pero: (a) obliga a distinguir resultados interinos vs finales
en el hook (cambio de su contrato y su acceptance ya cerrada), (b) complica el tope
de 15 con texto volátil, (c) es "nice to have" no exigido por el enunciado. Por
minimalismo, queda **fuera de alcance**.

Si el leader/usuario lo quisiera después, sería una feature aparte con su propio RED
sobre el hook (no sobre `NameField`): test que dispare `onresult` con
`results[i].isFinal === false` y afirme que `onResult`/un nuevo callback interino
emite el parcial. No se decide aquí.

## Tokens y textos de marca

- Colores: `text-brand-primary` (botón idle), `text-brand-accent` (listening + error),
  `text-brand-muted` (contador), `disabled:opacity-50` (no-soporte). Cero hex.
- Textos: `voice.startLabel`, `voice.listeningLabel`, `voice.permissionDenied`,
  `voice.noSpeech`, `voice.genericError`, `voice.unsupported`, `text.inputPlaceholder`,
  `text.counterTemplate`. Todos ya en el schema. **Cero texto nuevo, cero literal.**
- Movimiento: `motion-safe:animate-pulse` (respeta `prefers-reduced-motion`).

## Alternativas consideradas

**Dónde vive la UX de voz.**
- (A) Toda en `NameField` — **recomendada**. El hook ya se instancia ahí; el estado
  del nombre lo pasa el padre. Mínima superficie, `WelcomeScreen` intacto.
- (B) Subir el hook a `WelcomeScreen` y bajar props a `NameField`. Rechazada: mueve
  responsabilidad sin beneficio, ensancha el diff y toca un componente estable.

**Señal de "escuchando".**
- (A) Pulso animado **+ etiqueta textual** — recomendada. Redundante por diseño:
  cubre reduced-motion y daltonismo (la etiqueta no depende de color ni movimiento).
- (B) Solo animación de color/pulso. Rechazada: falla accesibilidad con
  reduced-motion y con visión monocroma.

**No-soporte.** Deshabilitar (recomendada, §5) vs ocultar (rechazada: pierde la
comunicación de marca `voice.unsupported`).

## Recomendación

Ampliar solo `NameField.tsx`: botón toggle por `isListening` (start/stop),
`aria-label` conmutado + `aria-pressed`, pulso `motion-safe` + etiqueta
`voice.listeningLabel`, región `aria-live="polite"`/`role="status"` con el texto de
error mapeado desde `errorCode`, y botón `disabled` + `voice.unsupported` cuando
`!isSupported`. No tocar el hook ni el schema ni `WelcomeScreen`.

## Criterios de aceptación traducibles a tests (contrato para el tester — RED)

Mockeando `useVoiceInput` (patrón ya presente en `NameField.test.tsx`: controlar
`status`/`isListening`/`isSupported`/`errorCode` desde `voiceMock`). Todo se observa
por rol/aria/texto, nunca por clase CSS de color.

**Toggle start↔stop**
1. `isListening=false` (idle): pulsar el botón llama `start()` 1 vez y NO `stop()`.
   (El test actual "arranca el reconocimiento" ya cubre parte; ampliarlo.)
2. `isListening=true`: el botón llama `stop()` 1 vez y NO `start()` al pulsarlo.
3. `isListening=true`: `aria-label === voice.listeningLabel` y `aria-pressed==="true"`.
4. `isListening=false`: `aria-label === voice.startLabel` y `aria-pressed==="false"`.
   (Localizar el botón por su aria-label de marca en cada caso.)

**Indicación de escucha**
5. `status='listening'`: se muestra en pantalla el texto `voice.listeningLabel`
   (`getByText(brand.voice.listeningLabel)`).
6. `status='idle'`: `voice.listeningLabel` NO está en el documento
   (`queryByText(...)` → null).

**Errores → texto de marca (aria-live)**
7. `status='error'`, `errorCode='not-allowed'`: aparece `voice.permissionDenied` en
   una región con `role="status"` (o `getByRole('status')` conteniendo el texto).
8. `status='error'`, `errorCode='no-speech'`: aparece `voice.noSpeech`.
9. `status='error'`, `errorCode='audio-capture'`: aparece `voice.genericError`.
10. `status='error'`, `errorCode='network'`: aparece `voice.genericError`.
11. `status='error'`, `errorCode='unknown'`: aparece `voice.genericError`.
12. `status='idle'`, `errorCode=null`: NINGÚN texto de error de voz presente
    (queryByText de los tres → null).

**No-soporte**
13. `isSupported=false`, `status='unsupported'`: el botón está `disabled`
    (`toBeDisabled()`) y su `aria-label`/`title === voice.unsupported`.
14. Mismo estado: el `textbox` sigue presente (formulario no roto — ya existe, mantener).

**Cero literal (regresión white-label)**
15. Los textos observados en los casos anteriores provienen de `brand.voice.*`
    (afirmar contra `brand.voice.X`, nunca contra strings hardcoded en el test).

Casos ya cubiertos por el test actual que se mantienen: contador inicial/interpolado,
`maxLength=15`, truncado del dictado a 15, `onResult` rellena el estado, placeholder
de marca. El tester los conserva y añade 1-15 arriba.
