# Security audit — voice_auto_send

**Veredicto:** PASS

Auditoría de privacidad del micrófono y de datos para la detección de silencio
local (Web Audio API) con auto-envío. Feature 100% frontend; no toca cifrado,
claves, `.env`, backend ni `transcribeVoice`. Foco central: que el micrófono y
el `AudioContext` NO queden vivos tras terminar la grabación.

## Alcance revisado
- `frontend/src/voice/useVoiceRecorder.ts` (cableado + teardown)
- `frontend/src/voice/audioLevelMeter.ts` (borde Web Audio, RMS local)
- `frontend/src/voice/silenceDetector.ts` (máquina temporal pura)
- `frontend/src/voice/useVoiceRecorder.test.ts` (cobertura de teardown)

## Punto 1 (central) — el micrófono NO queda vivo tras terminar

Trazados los seis caminos de salida de `recording`. En todos se (a) paran los
tracks del `MediaStream` (`releaseStream`, `useVoiceRecorder.ts:141-145`),
(b) se cierra el `AudioContext` y (c) se cancela el `setInterval` (ambos en
`teardownMeter`, `useVoiceRecorder.ts:129-138`):

| Salida | Ruta en código | tracks.stop() | AudioContext.close() | clearInterval |
|---|---|---|---|---|
| Auto-envío (ruta a, `'send'`) | `:232-234` → `recorder.stop()` → `onstop` `:181-206` | ✅ `:185` | ✅ `:183` | ✅ `:183` |
| No-speech (ruta b, `'no-speech'`) | `:235-246` | ✅ `:244` | ✅ `:241` | ✅ `:241` |
| Stop manual (2º clic) | `:258-261` → `onstop` `:181-206` | ✅ | ✅ | ✅ |
| Auto-stop por tiempo (10 s) | `:252-254` → `onstop` `:181-206` | ✅ | ✅ | ✅ |
| Unmount del componente | `:148-154` | ✅ | ✅ | ✅ |
| permission-denied | `:163-168` (sale antes de crear stream/meter) | n/a | n/a | n/a |

Detalles verificados:
- El bucle `setInterval` guarda su id en `sampleTimerRef` y `teardownMeter`
  siempre hace `clearInterval` antes de nulear la ref (`:130-133`): ningún tick
  queda leyendo el mic tras terminar.
- `teardownMeter` invoca `meterRef.current?.close()` → `context.close()`
  (`audioLevelMeter.ts:56-58`): el grafo de audio se libera; no queda un
  `AudioContext` colgado manteniendo el mic.
- Un solo `getUserMedia` (`:162`): el meter reutiliza el MISMO `stream`
  (`:217`, `audioLevelMeter.ts:41`), así que `releaseStream` (que para TODOS los
  tracks) apaga tanto la captura del recorder como la del analyser. No hay un
  segundo stream que se escape sin liberar.
- Ruta (b) correcta contra fuga por `onstop`: anula `activeRecorder.onstop = null`
  (`:239`) ANTES de `recorder.stop()` (`:243`), evitando que el `onstop` real
  vuelva a llamar `teardown`/`transcribe`; hace teardown+release explícito.
- Cobertura de tests presente para las cuatro salidas con `AudioContext`:
  ruta (b) `close()` (`test:296-309`), stop manual `close()` (`:312-325`),
  unmount `close()` + `track.stop()` (`:328-341`), no-speech mic liberado
  (`:254-280`). Ruta (a) valida el envío sin 2º clic (`:210`) y comparte el
  mismo `onstop` cubierto por unmount/stop.

No se encontró ningún camino que deje el mic, el `AudioContext` o el intervalo
vivos.

## Punto 2 — análisis local, nada nuevo sale del navegador
`audioLevelMeter.ts` computa el RMS con `getByteTimeDomainData` en un buffer
local (`:46-54`); el nivel solo alimenta `detector.push` (`:231`). grep sin
coincidencias de `fetch`/`XMLHttpRequest`/`sendBeacon`/`WebSocket`/`http(s)://`
en los tres archivos. El único envío sigue siendo el `Blob` a
`POST /voice/transcribe` vía `transcribeRef` (`:188`), sin cambios. El nivel de
audio no se transmite ni se persiste.

## Punto 3 — menos datos que antes (mejora de privacidad)
En "nunca habló" la ruta (b) descarta los chunks (`chunksRef.current = []`,
`:242`) y NO llama a `transcribe`: se anula `onstop` (`:239`) y se hace teardown
manual, de modo que ningún camino sube el audio. Confirmado por test
`expect(transcribe).not.toHaveBeenCalled()` (`test:273`). Estrictamente menos
superficie de datos que el flujo anterior (que subía un Blob vacío/ruido).

## Punto 4 — sin secretos, sin deps, sin terceros
- grep sin API keys, endpoints externos ni `VITE_*` en los tres archivos.
- Sin dependencias nuevas: no se añadió ningún paquete de audio/VAD
  (`@ricky0123/vad-web` y afines) al lockfile ni a `package.json`. Web Audio es
  API nativa del navegador (`AudioContext`/`AnalyserNode`).

## Punto 5 — robustez / degradación
- Sin Web Audio: `tryCreateMeter` captura la excepción de `resolveAudioContext`
  (`audioLevelMeter.ts:32`) y devuelve `null` (`:73-79`); el motor omite el
  bucle (`:218 if (meter)`) y sigue con auto-stop por tiempo + 2º clic. No deja
  estado inconsistente ni rompe la grabación.
- El detector es puro y determinista (`silenceDetector.ts`), sin `Date.now`/red;
  el tiempo se inyecta. No hay riesgo de fuga por él.
- Observación (bajo, no bloqueante): si `meter.sample()` lanzara dentro del tick
  del `setInterval`, la excepción no está envuelta en try/catch, por lo que ese
  tick fallaría sin cancelar el intervalo. En la práctica `getByteTimeDomainData`
  no lanza sobre un grafo válido, y el auto-stop por tiempo (10 s) más el 2º clic
  garantizan que el mic acabe liberándose igualmente; no compromete la privacidad.
  Sugerencia de robustez (opcional): envolver el cuerpo del tick en try/catch y
  hacer `teardownMeter()` ante fallo, degradando al comportamiento sin meter.

## Hallazgos
- [bajo] useVoiceRecorder.ts:226-248 — el cuerpo del tick del `setInterval` no
  está en try/catch; un fallo de `meter.sample()` dejaría el intervalo activo.
  Mitigado por auto-stop de 10 s y 2º clic; no hay fuga de datos. Remediación
  opcional: try/catch + `teardownMeter()` ante error de lectura de nivel.

## Checklist
- Claves: [x] — la feature no introduce ni toca claves/secretos; cifrado y
  `CRYPTO_PRIVATE_KEY` intactos (no en el diff). Sin `VITE_*` nuevos.
- Cifrado: [x] — no aplica; `transcribeVoice` y el contrato/endpoint sin cambios;
  el análisis RMS es local y no se transmite. Sin logs de datos sensibles
  (grep `console.*` vacío).
- Higiene del repo: [x] — sin `.env` tocado, sin deps nuevas, sin endpoints
  externos, sin secretos hardcodeados. Menos datos subidos que antes (ruta b no
  sube audio).
