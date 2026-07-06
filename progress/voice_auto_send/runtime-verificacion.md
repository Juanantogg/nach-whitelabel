# Verificación en runtime — voice_auto_send (dictado por voz)

Evidencia de que el dictado por voz (Groq motor único, ADR 23 + auto-envío por
silencio, ADR 24) funciona **en los 4 navegadores objetivo**, capturada con
micrófono real contra el backend local (`POST /voice/transcribe` → Groq) el
2026-07-05.

## Matriz de navegadores (dictado real → HTTP 200)

Los 4 navegadores graban audio con `MediaRecorder`, lo suben por multipart y
reciben la transcripción de Groq. Confirmado por los logs de `pino-http` del
backend (`user-agent` + `statusCode` + `responseTime`):

| Navegador | Motor        | user-agent (resumen)              | Status | responseTime |
|-----------|--------------|-----------------------------------|--------|--------------|
| Chrome    | Blink        | `Chrome/150`                      | 200    | ~0.3–0.4 s   |
| Brave     | Blink        | `Chrome/150 … Brave";v="150"`     | 200    | ~0.59 s      |
| Safari    | WebKit       | `Version/26.5.2 Safari/605`       | 200    | ~0.61 s      |
| Firefox   | Gecko        | `Firefox/152.0`                   | 200    | ~0.42 s      |

**Los 3 motores de navegador distintos (Blink, WebKit, Gecko) funcionan.** Esto
valida en runtime la decisión del ADR 23 (Groq como motor único): comportamiento
idéntico en los 4, sin depender de la Web Speech API que fallaba en Firefox (no la
implementa) y Brave (bloquea el servicio de Google). El `content-length` de cada
petición varía (41 KB Brave, 80 KB Safari, 42 KB Firefox) → cada uno captura audio
real de distinta duración y todos transcriben correctamente.

## Auto-envío por silencio (ADR 24) — verificado

- **Habló y calló:** el dictado se envía solo tras ~1.5 s de silencio, sin 2º clic.
  Confirmado por el usuario en runtime; el tiempo (`SILENCE_HANG_MS = 1500`) se
  sintió natural (no corta a media palabra, no tarda de más).
- **Nunca habló:** arrancar sin hablar corta a ~3 s con aviso `voice.noSpeech`,
  sin subir audio.
- Constantes finales sin recalibrar (los valores iniciales funcionaron): 
  `SPEECH_THRESHOLD = 0.06`, `SILENCE_HANG_MS = 1500`, `NO_SPEECH_TIMEOUT_MS = 3000`,
  `SAMPLE_MS = 100`.

## Sanitización de puntuación del dictado — verificado

Whisper/Groq añade puntuación automática ("Juan" → "Juan."). `sanitizeDictatedName`
recorta la puntuación de borde solo en el texto dictado (no en el teclado).
Verificado en runtime: dictar un nombre devuelve el nombre limpio, sin el punto
final.

## CORS / rate-limit / seguridad en runtime

- `access-control-allow-origin: http://localhost:5173` correcto en los 4.
- `ratelimit-*` presente (limiter activo en `/voice`).
- Sin errores de CORS ni mixed-content en la consola del navegador.
