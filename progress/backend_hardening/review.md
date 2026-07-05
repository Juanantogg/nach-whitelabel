# Review — backend_hardening

**Veredicto:** APPROVED

## Resultado de `./init.sh full`
Verde completo: deps + lint + typecheck + test + build + smoke.
- Backend: 8 archivos, **44/44 tests** verdes. `smoke` → `SMOKE_OK` (app + modelos cargan en runtime).
- Frontend (sin cambios en esta feature): 20 archivos, 175/175 verdes. Build OK.

## Checklist
- TDD: [x] — Tests RED nuevos (`app.middleware.test.ts`, `middleware/error-handler.test.ts`), archivos untracked, sin versión previa que relajar. Cubren exactamente lo que `tests.md` describe (CORS allowlist origen permitido/denegado/preflight/sin-Origin, helmet `nosniff`, rate-limit 429 con `RATE_LIMIT_MAX=2`, errorHandler forma/status/stack por entorno, notFound 404 JSON). Implementación mínima y sin código muerto. El implementer NO tocó los tests.
- Backend: [x] — Capas intactas (`routes → controllers → services`); `createApp()` sin cambio de firma, testeable con Supertest; `server.ts` separado con arranque/señales. Clave privada solo desde env (`CRYPTO_PRIVATE_KEY`), no aparece en código ni en logs (validateEnv en server.ts loguea solo `path`+`message`, nunca el valor).
- White-label: [x] N/A — feature de backend, sin JSX ni textos de marca.
- Calidad: [x] — lint/typecheck/test/build/smoke verdes; sin `any` en los archivos tocados; sin `console.*` en runtime de producción (el único `console.info` está en `smoke.ts`, script de diagnóstico, preexistente); deps nuevas ya acordadas en ADR 15 (`cors`, `helmet`, `pino`, `pino-http`, `express-rate-limit`, `@types/cors`); usa API nativa (Web Crypto en cripto, `process.on` para señales) sin wrappers de más; sin `asyncHandler` (Express 5 reenvía async solo, coherente con el design).
- Documentación: [x] — ADR 15 en `docs/decisiones.md` registra contexto/decisión/por qué/descartado, incluida la **corrección verificada en runtime** de mantener `@types/express` (Express 5.2.1 sin tipos propios) y la promoción de rate-limit a incluido. El acceptance de `feature_list.json` está alineado con esa corrección. Coherente.

## Validación de los 7 puntos del encargo
1. **Orden middlewares** (`app.ts`): helmet → cors → `express.json` → pino-http → routers → notFoundHandler → errorHandler. Correcto y coherente con ADR 15.3. CORS usa la allowlist de `env.corsOrigins`; origen no permitido → `callback(null, false)` (sin cabeceras, sin 500), verificado por el test de "Origin denegado → 200 sin cabecera". Rate-limit montado **solo** en `POST /names` (`app.use('/names', namesLimiter, namesRouter)`), no global.
2. **error-handler.ts**: no filtra stack en prod (`if (!isProd && err instanceof Error && err.stack)`); en 5xx de prod da mensaje genérico; respeta `err.status` vía `statusOf` (default 500); JSON `{ error, message }` consistente; loguea por `req.log ?? logger` (pino), nunca por console.
3. **env.ts**: `parseOrigins` (split coma + trim + filter Boolean); default seguro `http://localhost:5173`, nunca `'*'`; `RATE_LIMIT_MAX` numérico con `z.coerce.number().int().positive().default(100)`. Coherencia `env` / `ValidatedEnv` / `validateEnv`: las 3 incluyen `corsOrigins` y `rateLimitMax`, y `validateEnv` re-parsea con `parseOrigins`. Correcto.
4. **server.ts graceful shutdown**: secuencia `httpServer.close()` → `disconnectDb()` → `exit(0)`; timeout de 10s con `.unref()` → `exit(1)`; señales SIGTERM + SIGINT. `console.*` migrado por completo a pino (arranque, shutdown, bootstrap_error). db.ts sin console (lanza Error), conforme al design.
5. **Convenciones**: imports ESM con `.js`; sin `any`; regla `no-console` respetada; comentarios en español; white-label N/A. `createApp()` conserva firma sin argumentos.
6. **Honestidad de tests**: `git diff --stat` no muestra modificación de tests existentes; los dos test files son nuevos (untracked). `pnpm --filter @nach/backend test/lint/typecheck` verdes ejecutados por el reviewer. Confirmado.
7. **@types/express**: mantenido, justificado en ADR 15 (corrección verificada: Express 5.2.1 sin campo `types`, quitarlo rompe `tsc` TS7016) y reflejado en el acceptance de `feature_list.json`. Coherente.

## Notas (no bloqueantes)
1. `app.ts:57` — la respuesta **429** de `express-rate-limit` usa el body por defecto de la librería (`content-type: text/html`, "Too many requests..."), a diferencia del resto de errores que responden JSON `{ error, message }`. El test solo asegura el status 429, así que no bloquea; pero si se quiere coherencia total con el "JSON consistente" del ADR 15.4, se puede pasar `message`/`handler` al `rateLimit({...})` para devolver `{ error: 'too_many_requests', ... }`. Sugerencia menor, opcional.
2. `logger.ts:19` — `pinoHttp({ logger })` emite el request completo también para respuestas de error (se ve el volumen de logs en la suite). En prod es correcto (JSON a CloudWatch); si se quisiera bajar ruido se puede ajustar `customLogLevel`. No es un problema de esta feature.

Ambas notas son puramente cosméticas; ninguna afecta al acceptance, al contrato ni a la seguridad.
