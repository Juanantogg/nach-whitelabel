# GREEN — backend_hardening (implementer)

Código de producción mínimo para pasar los tests RED. Todos verdes + smoke carga
en runtime. Sin tocar los tests.

## Archivos creados

- `backend/src/config/logger.ts` — `logger` (pino raíz) + `httpLogger` (pino-http),
  una sola config compartida (design §5, alternativa A).
- `backend/src/middleware/error-handler.ts` — `errorHandler` (4 args, JSON
  `{ error, message }`, `stack` solo fuera de prod, `message` genérico en 5xx de
  prod, log por pino) + `notFoundHandler` (404 JSON).
- `.nvmrc` y `.node-version` (raíz, contenido `20`, acorde a `engines.node: ">=20"`).

## Archivos modificados

- `backend/src/config/env.ts` — `CORS_ORIGINS` (coma-separada → `corsOrigins`
  array, default dev `http://localhost:5173`, nunca `'*'`) y `RATE_LIMIT_MAX`
  (número, default 100). Añadidos a `env`, `envSchema`, `ValidatedEnv` y `validateEnv`.
- `backend/src/app.ts` — orden helmet → cors(allowlist) → express.json → pino-http
  → routers → notFoundHandler → errorHandler. Origen no permitido → `callback(null,
  false)` (sin cabeceras, sin 500). Rate-limit por IP en `POST /names` con
  `env.rateLimitMax`. `createApp()` sin cambio de firma.
- `backend/src/server.ts` — captura `httpServer`, graceful shutdown SIGTERM/SIGINT
  (close → disconnectDb → exit(0), timeout 10s `.unref()` → exit(1)), `console.*`
  migrados a pino.
- `config/db.ts` — sin cambios: no tenía `console.*` (lanza Error), conforme al design §5.

## Dependencias

- **Añadidas (deps):** `cors`, `helmet`, `pino`, `pino-http`, `express-rate-limit`.
- **Añadidas (dev):** `@types/cors`.

## DESVIACIONES respecto al design (para leader/reviewer)

1. **`@types/express` NO se eliminó** (el design §6 y el acceptance pedían quitarlo).
   Motivo técnico: Express 5.2.1 **no incluye tipos propios** (`types: NONE` en su
   package.json). Quitarlo rompe `tsc --noEmit` en todos los `import ... from
   'express'` (TS7016). El design asumió, incorrectamente, que Express 5 trae sus
   tipos. Ningún test RED exige quitarlo (es un "menor" del acceptance, no cubierto
   por test). Se restauró `@types/express` como devDependency. **Requiere decisión
   del leader**: ¿ajustar el acceptance/ADR 15 para no exigir la eliminación, o
   fijar `express` a una versión que sí traiga tipos?

2. **Rate-limit implementado (no opcional).** El design lo marcaba opcional, pero el
   tester dejó un test RED que lo exige (`RATE_LIMIT_MAX=2` → 3ª petición 429). Se
   implementó para cerrar ese RED (alcance confirmado por el leader).

## Ajustes post-review + auditoría (decididos por el usuario)

1. **429 en JSON** (RED nuevo del tester): el `rateLimit` de `POST /names` usa un
   `handler` que responde `{ error: 'too_many_requests', message: '...' }` con status
   429 — mismo contrato JSON que el resto de la API, texto genérico (no de marca, no
   sensible). `app.ts`.
2. **`trust proxy`** (hallazgo MEDIA): `if (isProd) app.set('trust proxy', 1)` en
   `createApp()` — UN hop (App Runner/CloudFront), nunca `true` (spoofeable). Solo en
   prod. `app.ts`.
3. **`redact` de pino** (hallazgo BAJA, defensa en profundidad):
   `redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body']` en la
   instancia `pino({...})` raíz de `config/logger.ts`. `httpLogger` la reutiliza y
   hereda el redact. Verificado empíricamente: censura esas rutas a `[Redacted]` (no
   es un no-op); hoy pino-http no filtra nada (su serializer `req` por defecto no
   incluye headers/body), el redact es preventivo.

## Verificación

- `pnpm --filter @nach/backend test` → 8 archivos, 44 tests, todos verdes (incluido
  el nuevo assert del 429 en JSON).
- `pnpm --filter @nach/backend lint` → OK.
- `pnpm --filter @nach/backend typecheck` → OK.
- `pnpm --filter @nach/backend smoke` → `SMOKE_OK` (app + modelos cargan en runtime).
- `./init.sh` → OK (deps + lint + typecheck).

