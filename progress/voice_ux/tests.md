# Tests (RED) — voice_ux

Fase **RED** del TDD. Se amplía
`frontend/src/features/welcome/NameField/NameField.test.tsx` con los 15 casos del
contrato del design ("Criterios de aceptación traducibles a tests"). **No se toca
código de producción** — `NameField.tsx` lo cablea el implementer en GREEN.

Todo se observa por **rol/aria/texto de marca** (`getByRole`, `aria-pressed`,
`role="status"`, `getByText(brand.voice.*)`), nunca por clase CSS de color ni por
strings hardcodeados en el test. El botón se localiza por su `aria-label` de marca,
que conmuta entre estados (`startLabel` ↔ `listeningLabel` ↔ `unsupported`).

El borde mockeado es `useVoiceInput` (patrón ya presente): el test controla
`status`/`isListening`/`isSupported`/`errorCode`/`stop` desde `voiceMock`. La
lógica bajo prueba (el cableado de la UX en el componente) NO se mockea.

## Casos añadidos y mapeo caso → acceptance del design

| Caso design | Test | Qué verifica | ¿RED ahora? |
|---|---|---|---|
| 1 | idle: pulsar llama `start()` 1× y no `stop()` | toggle en idle | verde (ya existía el `start`) |
| 2 | listening: pulsar llama `stop()` 1× y no `start()` | toggle en listening | **falla** — sin toggle a stop |
| 3 | listening: `aria-label=listeningLabel` + `aria-pressed="true"` | semántica toggle | **falla** — botón no conmuta label ni expone aria-pressed |
| 4 | idle: `aria-label=startLabel` + `aria-pressed="false"` | semántica toggle | **falla** — sin `aria-pressed` |
| 5 | listening: `getByText(voice.listeningLabel)` visible | indicación de escucha | **falla** — no se rinde la etiqueta |
| 6 | idle: `listeningLabel` NO en el documento | ausencia de etiqueta | verde (no se rinde en idle) |
| 7 | error `not-allowed` → `voice.permissionDenied` en `role="status"` | error→texto marca | **falla** — sin región aria-live |
| 8 | error `no-speech` → `voice.noSpeech` en `role="status"` | error→texto marca | **falla** — sin región aria-live |
| 9 | error `audio-capture` → `voice.genericError` en `role="status"` | error→texto marca | **falla** — sin región aria-live |
| 10 | error `network` → `voice.genericError` en `role="status"` | error→texto marca | **falla** — sin región aria-live |
| 11 | error `unknown` → `voice.genericError` en `role="status"` | error→texto marca | **falla** — sin región aria-live |
| 12 | idle sin errorCode: ningún texto de error presente | ausencia de error | verde (no se rinde error) |
| 13 | no-soporte: botón `disabled` + `aria-label=voice.unsupported` | degradación elegante | **falla** — botón no conmuta a unsupported ni se deshabilita |
| 14 | no-soporte: `textbox` sigue presente | formulario no roto | verde (ya cubierto, se conserva) |
| 15 | white-label: aria-label/etiqueta/error/unsupported salen de la **marca activa** | cero literal | 1 de 4 verde (startLabel ya de marca), 3 fallan por lo mismo que 5/7/13 |

El caso 15 se blinda renderizando con **otra marca** (defaults del schema con textos
de voz distintos al seed shopinbaz): si el componente hardcodeara un literal, el test
—con textos de marca diferentes— fallaría. Los otros casos (1-14) ya afirman contra
`brand.voice.*`, cumpliendo la regla white-label del caso 15.

## Casos preexistentes conservados (siguen en verde)

Contador inicial `0/15 caracteres`, interpolación de `{count}`, `maxLength=15`,
truncado del dictado a 15, `onResult` rellena el estado, placeholder de marca,
`voice.startLabel` en el botón, no-soporte no rompe el formulario. Ninguno se
modifica.

## Evidencia del RED

Comando: `pnpm --filter @nach/frontend test -- run src/features/welcome/NameField/NameField.test.tsx`

```
❯ NameField.test.tsx (28 tests | 13 failed)
     × escuchando (isListening=true): pulsar el botón llama stop() una vez y no start()
     × escuchando: el botón expone aria-label=listeningLabel y aria-pressed="true"
     × idle: el botón expone aria-label=startLabel y aria-pressed="false"
     × status=listening: muestra en pantalla el texto de marca listeningLabel
     × error not-allowed: la región role="status" muestra voice.permissionDenied
     × error no-speech: la región role="status" muestra voice.noSpeech
     × error audio-capture: la región role="status" muestra voice.genericError
     × error network: la región role="status" muestra voice.genericError
     × error unknown: la región role="status" muestra voice.genericError
     × sin soporte: el botón de voz está disabled y su aria-label es voice.unsupported
     × la etiqueta de escucha proviene de la marca activa
     × el texto de error proviene de la marca activa
     × el aria-label de no-soporte proviene de la marca activa

 Test Files  1 failed | 19 passed (20)
      Tests  13 failed | 145 passed (158)
```

### Por qué es el fallo esperado (feature ausente, no setup/typo)

Muestras de los mensajes de error, todos por **comportamiento no implementado**:

- Caso 3: `Unable to find an accessible element with the role "button" and name
  "Escuchando…"` → el botón aún NO conmuta su `aria-label` a `listeningLabel` (no
  existe el toggle). El mock inyecta bien `isListening=true`; el botón existe con el
  aria-label de idle.
- Casos 7-11: `Unable to find an accessible element with the role "status"` → NO
  existe la región `aria-live`/`role="status"` que rinde el error mapeado.
- Casos 4/2/5/13/15: mismo origen — falta `aria-pressed`, el handler no llama
  `stop()`, no se rinde `listeningLabel`, y el botón no pasa a `disabled` +
  `voice.unsupported`.

Los 145 tests preexistentes (incluidos los 15 casos que dependen de piezas ya
presentes: 1, 6, 12, 14 y el 1er sub-caso del 15) **siguen en verde**, confirmando
que el fallo es exclusivamente la feature nueva y no una rotura de import/setup.
