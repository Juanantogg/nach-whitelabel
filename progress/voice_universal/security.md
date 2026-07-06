# Security audit — voice_universal

**Veredicto:** PASS (APROBADO)

Auditoría del fallback de dictado por voz (Firefox/Brave) vía Groq
`whisper-large-v3-turbo`. Feature que toca un SECRETO (`GROQ_API_KEY`) y DATOS
del usuario (audio con su nombre). Verificado contra el checklist de `design.md`
§4 y `docs/seguridad.md`. Sin hallazgos críticos ni altos.

## Hallazgos

- [bajo/informativo] `backend/src/controllers/voice.controller.ts:49-54` — el
  `catch {}` que traduce el fallo del proveedor a `502 transcription_failed`
  DESCARTA por completo el error de Groq: ni lo reenvía al cliente (correcto,
  no filtra status/body/key) ni lo loguea en el servidor. Es seguro por
  privacidad, pero deja al operador sin rastro para diagnosticar caídas de Groq.
  Remediación (opcional, observabilidad — NO seguridad): loguear el error por
  `logger.error({ err }, 'transcription_failed')` a nivel servidor, nunca en la
  respuesta. El SDK de Groq puede incluir la key en el objeto de error, así que
  si se añade el log hay que loguear solo `err.message`/`status`, no el objeto
  crudo. Como está hoy, no hay fuga: el error nunca se materializa.

## Verificaciones ejecutadas

- `git grep -nE "GROQ|groqApiKey|VITE_*(SECRET|PRIVATE|KEY)" -- frontend/` →
  sin rastro de la key en `frontend/**` (única coincidencia: un test que
  ASSERTA la ausencia de `VITE_CRYPTO_SECRET`).
- `grep -rniE "gsk_…|groq" frontend/dist` → el bundle ya construido NO contiene
  la key ni referencia a Groq. El front habla solo con `env.apiUrl`
  (`transcribeVoice.ts:34`), nuestro backend; nunca con `api.groq.com`.
- `git ls-files | grep .env$` → `.env` NO trackeado. `.env.example:21`
  contiene `GROQ_API_KEY=` VACÍA (placeholder, sin valor real).
- Hook `PreToolUse` (`.claude/settings.json:9`) vigente: bloquea escribir
  archivos `.env` desde un agente.
- `.gitleaks.toml` (+ `secret-scan` en CI con `fetch-depth:0`): cubre claves
  privadas PEM (reglas por defecto), `crypto_secret`/`crypto_key` hex y URIs de
  Mongo con credenciales; una `gsk_…` de Groq cae bajo el detector genérico de
  API keys de gitleaks. Allowlist solo para placeholders de `.env.example`. Una
  fuga de la key en un commit sería detectada.

## Checklist

- Claves:
  - [x] `GROQ_API_KEY` solo en backend (`env.groqApiKey`, `env.ts:41`), leída de
    `process.env` (Parameter Store en prod). Nunca hardcodeada.
  - [x] Nunca en `frontend/**` ni en el bundle `dist` (grep verificado).
  - [x] `.env` no trackeado; `.env.example:21` con placeholder vacío.
  - [x] Opcional en Zod (`env.ts:73`) SIN relajar el fail-fast de `MONGODB_URI`
    / `CRYPTO_PRIVATE_KEY` (siguen `.regex`/`.refine(loadsAsPem)`,
    `env.ts:60-65`). Sin key, `/voice/transcribe` responde 500 antes de llamar
    al proveedor (`voice.controller.ts:37-40`), no tumba el boot.

- Cifrado / datos sensibles:
  - [x] Límite 413 REAL y ANTES de Groq: `multer limits.fileSize =
    MAX_AUDIO_BYTES` (2 MB) en `voice.routes.ts:18-21`; `LIMIT_FILE_SIZE` → 413
    `audio_too_large` (`voice.routes.ts:36-38`). Multer corta en memoria; el
    service nunca se invoca en ese camino.
  - [x] MIME allowlist aplicada (`voice.controller.ts:13,31-34`):
    `audio/(webm|ogg|mp4)`; fuera → 400, sin tocar al proveedor.
  - [x] Rate-limit activo en `/voice`: `app.use('/voice', makeLimiter(),
    voiceRouter)` (`app.ts:76`), limiter por IP independiente, 429 con contrato
    `{ error, message }` genérico.
  - [x] Audio NO persiste: `multer.memoryStorage()` (`voice.routes.ts:19`), no
    toca Mongo ni disco; buffer efímero solo durante la petición. El texto
    transcrito no se persiste ni se loguea (sin `console.*`/`logger.*` en la
    ruta voice). `language:'es'` lo fija el backend, no el cliente.
  - [x] Sin fuga de detalle upstream: errores de Groq → `502
    transcription_failed` genérico (`voice.controller.ts:49-54`), sin
    status/body/key del proveedor en la respuesta. `errorHandler` central da
    mensaje genérico en 5xx de prod (`error-handler.ts:35`). La key nunca
    aparece en mensajes de error al cliente.

- Higiene del repo:
  - [x] CORS bajo allowlist `env.corsOrigins`, NUNCA `'*'` (`app.ts:21-31`);
    `POST` ya permitido; `/voice` hereda `corsOptions` sin ampliar la allowlist.
  - [x] CSP: el `POST` va a NUESTRO backend (host ya permitido para
    `/names`/`/crypto`), NO al CDN de HuggingFace. Sin CSP nueva ni conexión a
    terceros desde el front (a diferencia de la alternativa B descartada).
  - [x] gitleaks + `secret-scan` en CI cubren una fuga de la key; hook
    `PreToolUse` bloquea escribir `.env`.
