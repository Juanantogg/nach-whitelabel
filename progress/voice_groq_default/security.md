# Security audit — voice_groq_default

**Veredicto:** PASS (con recomendaciones no bloqueantes)

Rework que convierte Groq en el motor de voz ÚNICO (ADR 23): TODO dictado en los
4 navegadores pasa ahora por `POST /voice/transcribe` (antes solo Firefox/Brave,
como fallback). El cambio es puramente de FRONTEND (working tree, sobre commit
base 1808940); el backend (voice.controller, transcription.service, voice.routes,
app.ts, env.ts) NO cambia y ya está auditado PASS en
`progress/voice_universal/security.md`. Esta auditoría se centra en lo que el
salto de "fallback" a "motor único" altera en la superficie de ataque/coste. Sin
hallazgos críticos ni altos; ninguna regresión de seguridad introducida por el
rework.

## Hallazgos

- [medio/coste — NO seguridad] `backend/src/config/env.ts:15` (`DEFAULT_RATE_LIMIT_MAX=100`)
  + `backend/src/app.ts:61-76` (`makeLimiter`, `windowMs=60_000`, cubo propio en
  `/voice`) — El rate-limit se dimensionó cuando solo Firefox/Brave pegaban al
  endpoint; ahora pega el 100% del tráfico de voz de los 4 navegadores. El límite
  (100 req/IP/60s) NO se queda corto para un usuario legítimo: un humano dictando
  varias veces está muy lejos de 100/min, así que Chrome/Safari NO chocarán con el
  límite en uso normal. El riesgo desplazado es de COSTE, no de abuso: con Groq
  como motor único, muchas IPs legítimas concurrentes pueden acumular llamadas
  contra la `GROQ_API_KEY`. Recomendación (no implementar aquí): para la
  demo/evaluación, bajar `RATE_LIMIT_MAX` de `/voice` a un valor más ajustado al
  uso real de voz (p.ej. 10-20/min) vía env, dejando `/names` en 100. Es defensa
  en profundidad de coste, no un fallo de seguridad. El contrato 429 ya es
  genérico (`too_many_requests`), sin fuga.

- [bajo/coste — informativo] Free tier de Groq (~2.000 req/día en
  `whisper-large-v3-turbo`) — Con el motor único, cada clic de "enviar" en
  cualquier navegador consume 1 req. En una demo/evaluación normal aguanta de
  sobra; el riesgo de gasto inesperado solo aparece bajo tráfico anómalo o
  scripting contra el endpoint (mitigado por el rate-limit por IP y el límite de
  2 MB de multer, ya presentes en el backend base). Es un extra de prueba
  técnica, no producción masiva: solo se señala. Sin acción requerida.

- [bajo/informativo] `backend/src/controllers/voice.controller.ts:49-54`
  (heredado, ya reportado en voice_universal) — el error de Groq se traduce a
  `502 transcription_failed` sin loguearse; sigue siendo seguro por privacidad
  (no filtra key/status upstream) pero deja al operador sin rastro para
  diagnosticar caídas — más relevante ahora que TODO el dictado depende de Groq.
  Observabilidad, no seguridad: si se añade log, solo `err.message`/`status`,
  nunca el objeto crudo del SDK (puede portar la key).

## Verificaciones ejecutadas

- **Key solo en backend (grep frontend/src):**
  `git grep -niE "GROQ|gsk_|api\.groq|groqApiKey|VITE_[A-Z_]*(SECRET|PRIVATE|KEY)" -- frontend/src`
  → todas las coincidencias son COMENTARIOS/nombres ("motor único Groq") o el
  test `noSecretInBundle.test.ts` que ASERTA la ausencia de `VITE_CRYPTO_SECRET`.
  CERO referencias a la key real, a `gsk_…`, a `api.groq.com` o a un `VITE_*KEY`.
- **El front no se salta el backend:** `frontend/src/api/transcribeVoice.ts:34`
  sigue apuntando a `${base}/voice/transcribe` (base = `env.apiUrl`, nuestro
  backend). El rework NO tocó `transcribeVoice.ts`. `useVoiceRecorder.ts` es la
  renombrada de `useVoiceFallback.ts` (git `similarity 82%`, solo renombres de
  tipos/comentarios `Fallback→Recorder`); NO añade fetch a terceros ni referencia
  a la key. `NameField.tsx` solo consume el hook (`useVoiceRecorder`), sin red
  directa.
- **Audio efímero / privacidad del mic:** `useVoiceRecorder.ts:86-90`
  (`releaseStream` → `getTracks().forEach(track.stop())`) se invoca en `onstop`
  (`:128`) y en el cleanup de unmount (`:93-98`) → el micrófono se libera al parar
  y al desmontar; no queda un stream abierto. El audio vive solo como `Blob` en
  memoria durante la subida (`:127`); no se persiste ni cachea en el cliente
  (sin localStorage/IndexedDB/disco). El backend base ya usa `memoryStorage` y no
  persiste audio.
- **CSP/CORS / terceros:** el front sigue llamando SOLO a `env.apiUrl` (mismo
  host que `/names` y `/crypto`, ya en la allowlist CORS del backend). No hay
  Content-Security-Policy definida en `frontend/` (no la había antes: no es una
  regresión del rework). Ninguna conexión nueva a terceros ni ampliación de
  superficie de red desde el cliente.
- **Higiene de secretos:** `.env` NO trackeado (`git ls-files | grep .env$` vacío).
  `backend/.env.example:21` con `GROQ_API_KEY=` VACÍA (placeholder). No hay bundle
  `dist` construido para este rework, pero como el front nunca porta la key, no hay
  vector nuevo. gitleaks + `secret-scan` (CI) + hook `PreToolUse` siguen vigentes.

## Checklist

- Claves:
  - [x] `GROQ_API_KEY` sigue solo en backend (`env.ts`, leída de `process.env`);
    el rework de frontend NO introduce ninguna referencia a la key ni llamada
    directa a Groq (grep verificado en `frontend/src`).
  - [x] El front sigue hablando solo con `POST /voice/transcribe` de NUESTRO
    backend (`transcribeVoice.ts:34`, sin cambios); no se salta el backend.
  - [x] `.env` no trackeado; `.env.example` con placeholder vacío.

- Cifrado / datos sensibles (audio + PII):
  - [x] Micrófono liberado en stop y unmount (`releaseStream`,
    `useVoiceRecorder.ts:86-98,128`): sin stream colgando (privacidad).
  - [x] Audio efímero en memoria; NO se persiste ni cachea en el cliente; el
    backend base no lo persiste (`memoryStorage`). Texto transcrito no se loguea.
  - [~] Rate-limit del backend (`/voice`, 100/IP/60s) NO cambia con el rework:
    suficiente para no bloquear a usuarios legítimos; recomendación de AJUSTAR a
    la baja para acotar coste de Groq ahora que es motor único (hallazgo medio de
    coste, no bloqueante — es del backend, fuera del alcance de este rework FE).

- Higiene del repo / superficie de red:
  - [x] CORS bajo allowlist (backend base, sin cambios); `/voice` no amplía la
    allowlist.
  - [x] El front no introduce conexión a terceros ni amplía superficie de red;
    sin CSP nueva (no había CSP previa: no es regresión).
  - [x] gitleaks + secret-scan en CI + hook `PreToolUse` cubren una fuga de la
    key. El rework no añade patrones de secreto nuevos.
