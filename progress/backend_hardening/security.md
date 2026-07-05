# Security audit — backend_hardening

**Veredicto:** PASS (con recomendaciones para `deploy`, ninguna bloqueante de commit)

Auditoría del endurecimiento del backend (CORS, helmet, error handler, rate
limiting y migración de logging a pino). Referencias: `docs/seguridad.md` §3-4,
`docs/decisiones.md` ADR 15. Ningún hallazgo crítico ni ALTO. Los puntos abiertos
son de despliegue (`deploy`) o defensa en profundidad, no defectos de esta feature.

## Hallazgos

### Bloqueantes de commit
- Ninguno.

### MEDIA — recomendaciones para `deploy` (no bloquean el commit de la feature)
- [MEDIA] `backend/src/app.ts:39-63` (`createApp`) + `server.ts` — **falta
  `app.set('trust proxy', …)`**. En App Runner (y tras CloudFront) hay un proxy
  delante: `express-rate-limit` identifica al cliente por `req.ip`, que sin
  `trust proxy` resuelve a la IP del proxy, no a la del cliente real. Efecto: en
  producción **todos los clientes cuentan como una sola IP** y comparten el cubo
  del rate-limit — o se abre falso (spoofing de `X-Forwarded-For`) si se confía a
  ciegas. Remediación en `deploy`: configurar `trust proxy` de forma acotada
  (p.ej. `app.set('trust proxy', 1)` para un único hop, NO `true`), coherente con
  la topología real. No es defecto del código actual (correcto en dev/same-host),
  pero debe cerrarse antes de exponer el rate-limit en producción. Señalado ya
  aquí por petición explícita.

### BAJA
- [BAJA] `backend/src/config/logger.ts:10-19` — **pino-http sin `redact` ni
  serializers de cabeceras**. Por defecto pino-http NO loguea `req.body` (el
  nombre cifrado nunca llega al log; verificado: el controller `/names` no loguea
  nada — `crypto.controller.ts` sin `req.log`/`logger`), así que **hoy no hay
  fuga de PII**. Pero los serializers por defecto emiten `req.headers` /
  `res.headers`. En esta app no hay cookies (`credentials:false`) ni
  `Authorization`, luego el riesgo es bajo; aun así se recomienda añadir
  `redact: ['req.headers.authorization','req.headers.cookie','req.body']` como
  defensa en profundidad antes de `deploy`, para que ninguna evolución futura
  (añadir auth, loguear body para depurar) reintroduzca el riesgo que la regla
  `no-console` evita hoy.

### Informativo
- [info] `backend/src/middleware/error-handler.ts:30` loguea `{ err, status }`
  con el objeto de error completo. Correcto: el controller de `/names` captura
  sus propios fallos y responde sin lanzar (`decryption_failed`/`invalid_payload`
  /`internal_error`), así que el nombre en claro **nunca** llega al errorHandler.
  El errorHandler es la red para excepciones no capturadas, cuyo `err` no arrastra
  el nombre. Sin acción; se documenta para que futuros throws no adjunten PII al
  error.
- [info] `backend/src/config/env.ts:53-58` — `CORS_ORIGINS` y `RATE_LIMIT_MAX`
  son parámetros de operador, **no secretos**; correcto que no se validen como
  tales ni se traten con gitleaks. `CRYPTO_PRIVATE_KEY` y `MONGODB_URI` siguen
  leyéndose solo de entorno y no se han tocado en esta feature. Verificado.

## Checklist

### Claves / secretos
- [x] Clave privada solo de entorno, nunca en repo — `git grep "BEGIN PRIVATE KEY"`
  solo devuelve el placeholder `...` de `.env.example` (en allowlist gitleaks),
  el patrón de `.gitleaks.toml`, tests que ASERTAN su ausencia y docs. Cero claves
  reales. `CRYPTO_PRIVATE_KEY`/`MONGODB_URI` intactas en esta feature.
- [x] Ningún secreto en el bundle del front — `VITE_*` solo aparece en un test que
  verifica su ausencia; `.env.example` documenta explícitamente "el front NO lleva
  ninguna clave".
- [x] `CORS_ORIGINS` / `RATE_LIMIT_MAX` no son secretos — correcto no tratarlos como tales.

### CORS
- [x] Allowlist leída de config (`env.corsOrigins`), **nunca `'*'`** — ni por
  default ni con `CORS_ORIGINS` vacía. `app.ts:19-29`, `env.ts:12-13,32`.
- [x] Default de dev seguro — `http://localhost:5173`, no comodín (`env.ts:13`).
- [x] `credentials: false` (no hay cookies) — `app.ts:28`.
- [x] Métodos acotados a `['GET','POST']` — `app.ts:27`.
- [x] Falla cerrado — allowlist vacía = nadie cross-origin; `parseOrigins` hace
  `trim` y descarta vacíos (`env.ts:18-23`), así que una entrada vacía o
  malformada NO abre agujero (no se convierte en comodín). Origen no permitido →
  `callback(null,false)` (sin cabeceras CORS, sin 5xx ni ruido de logs).

### Cabeceras (helmet)
- [x] `helmet()` montado antes de las rutas — aporta `nosniff`, HSTS (bajo HTTPS),
  `X-Frame-Options`, etc. (`app.ts:42`). CSP no aplica a un backend JSON puro.

### Error handler
- [x] En producción los 5xx dan `message` genérico y **nunca** `stack` —
  `error-handler.ts:35,38` (guardado por `isProd`). Contrato `{ error, message }`
  consistente; 404 JSON en `notFoundHandler`.
- [x] No se filtra detalle criptográfico ni PII al cliente — códigos genéricos.

### Rate limiting
- [x] Protege el endpoint de escritura `/names` (`app.ts:51-57`), ventana 60 s,
  `max` configurable (default 100, `env.ts:15`), cabeceras estándar.
- [ ] Identificación de cliente por IP **no fiable tras proxy** — ver hallazgo
  MEDIA (`trust proxy`), a resolver en `deploy`.

### Fugas por logs (migración a pino)
- [x] La migración `console.*` → pino NO reintroduce el riesgo de PII: el
  controller no loguea el nombre ni el payload; pino-http no loguea `req.body`
  por defecto. Recomendación BAJA de `redact` para blindar a futuro.

### Higiene del repo
- [x] `.env` no trackeado (verificado con `git ls-files`).
- [x] `.env.example` sin valores reales (placeholders `<user>`/`...`).
- [x] gitleaks cubre clave privada (reglas por defecto) y `MONGODB_URI` (regla
  propia), con allowlist para los placeholders. Sin patrones nuevos requeridos:
  las vars de esta feature no son secretos.
