# Tests (RED) — backend_hardening

Fase **RED** del TDD. Tests de Vitest + Supertest sobre `createApp()` y sobre el
`errorHandler` exportado, derivados de la acceptance de `feature_list.json` y del
`design.md` (§7) / ADR 15. **Todos fallan hoy** porque los middlewares aún no
existen — es el rojo esperado, no un fallo de setup.

## Archivos

- `backend/src/app.middleware.test.ts` — CORS (allowlist), helmet y rate-limit
  sobre `createApp()`.
- `backend/src/middleware/error-handler.test.ts` — contrato del `errorHandler`
  (JSON `{ error, message }`, stack según entorno) y `notFoundHandler` (404 JSON).

Ambos archivos pasan `eslint` (incluida `no-console`) hoy: el rojo es de aserción
/ módulo ausente, no de lint ni de import roto del test.

## Estrategia común

- **Carga de app/middleware tras fijar env:** `env.ts` lee `NODE_ENV`,
  `CORS_ORIGINS`, `RATE_LIMIT_MAX` y `CRYPTO_PRIVATE_KEY` **al importarse**. Por
  eso se usa `vi.resetModules()` + `vi.stubEnv(...)` + `import()` dinámico
  **después** de fijar las variables — mismo patrón que `config/env.validate.test.ts`
  y `crypto.routes.test.ts`. Se limpia con `vi.unstubAllEnvs()` en `afterEach`.
- **Mock del borde, no de la lógica:** `services/counter.service.js` se mockea
  (`createRecord → 1`) para que `POST /names` no arranque Mongo. No se mockea
  cors/helmet/errorHandler: se ejercitan reales.
- **Provocar un error para el errorHandler sin tocar producción:** se monta una
  app Express **mínima dentro del test** con una ruta `/boom` que hace `throw` y
  el `errorHandler` importado como último `use()`. Express 5 reenvía el throw
  síncrono al error handler. **No** se añade ninguna ruta de prueba a `app.ts`.

## Casos y mapeo a acceptance

### `app.middleware.test.ts`

| Test | Acceptance / ADR 15 | Qué verifica |
|---|---|---|
| CORS: refleja `access-control-allow-origin` con Origin permitido | "cors (allowlist) activo" / 15.1 | Origin en allowlist → cabecera = ese origen |
| CORS: NO incluye la cabecera para Origin fuera de allowlist (y no 500) | 15.2 | Origin no listado → sin cabecera CORS, status 200 (falla-cerrado del navegador, no 5xx server) |
| CORS: preflight `OPTIONS /names` anuncia POST y GET | 15.1 / design §7.3 | `access-control-allow-methods` incluye POST y GET; status 200/204 |
| CORS: request sin `Origin` se procesa normal | 15.2 | curl/same-origin → 200, no rompe |
| helmet: `x-content-type-options: nosniff` | "helmet activo" / 15.3 | cabecera estable de helmet presente (se evita HSTS, que exige HTTPS) |
| rate-limit: 3ª petición a `POST /names` con `RATE_LIMIT_MAX=2` → 429 JSON `{ error, message }` | "express-rate-limit en POST /names" / 15.7 | 1ª y 2ª ≠ 429, 3ª = 429; y el 429 sale con `content-type: application/json` y claves `error`+`message` (mismo contrato que el resto de la API, no el HTML por defecto del limitador) |

**Camino feliz + borde cubiertos:** origen permitido (feliz) vs origen denegado y
sin-origin (bordes); helmet presente; rate-limit dentro-del-límite vs superado.

### `error-handler.test.ts`

| Test | Acceptance / ADR 15.4 | Qué verifica |
|---|---|---|
| Responde `application/json` con `{ error, message }` | "JSON consistente" | forma y content-type |
| Respeta `err.status` (400) | 15.4 | status del error propagado |
| Error sin status → 500 | 15.4 | default 500 |
| **Prod**: 5xx sin `stack`, `message` genérico | "no filtra stack en prod" | `NODE_ENV=production` → sin stack; el texto interno del Error NO se filtra |
| **Dev**: error CON `stack` | 15.4 | `NODE_ENV=development` → stack presente |
| 404 ruta inexistente → JSON `{ error }` (opcional) | design §7.10 (notFoundHandler) | 404 JSON, no HTML de Express |

**Camino feliz + borde cubiertos:** error con status vs sin status; prod (oculta)
vs dev (revela); el caso de seguridad (prod no filtra el detalle interno del Error)
es el borde crítico de la acceptance.

## Evidencia del ROJO

`pnpm --filter @nach/backend exec vitest run src/app.middleware.test.ts src/middleware/error-handler.test.ts`:

```
 ❯ src/middleware/error-handler.test.ts (6 tests | 6 failed)
     × responde JSON application/json con forma { error, message }
     × respeta el status del error cuando trae uno (p.ej. 400)
     × un error sin status devuelve 500
     × en producción un 5xx NO incluye stack y el message es genérico
     × fuera de producción el error SÍ incluye stack (para depurar)
     × una ruta inexistente responde 404 con JSON { error } (no el HTML de Express)
 ❯ src/app.middleware.test.ts (6 tests | 4 failed)
     × refleja access-control-allow-origin cuando el Origin está en la allowlist
     × preflight OPTIONS /names desde un Origin permitido anuncia POST y GET
     × añade x-content-type-options: nosniff a las respuestas
     × devuelve 429 cuando se supera el límite de peticiones (RATE_LIMIT_MAX=2)
 Test Files  2 failed (2)
      Tests  10 failed | 2 passed (12)
```

**Rojo por la razón correcta (código ausente), no por typo/import:**

- `error-handler.test.ts` (6/6): `Cannot find module '.../middleware/error-handler.js'`
  — el módulo de producción no existe todavía.
- CORS allowlist: `expected undefined to be 'https://elektra.garcia3apps.com'` —
  no hay `cors` que refleje la cabecera.
- CORS preflight: `expected '' to contain 'POST'` — Express 5 sin cors no anuncia
  métodos (OPTIONS cae al 404 por defecto).
- helmet: `expected undefined to be 'nosniff'` — no hay `helmet`.
- rate-limit: `expected 200 to be 429` — no hay limitador.

**Los 2 tests "en verde" son intencionales y no invalidan el RED:** el de "Origin
denegado NO incluye cabecera" y el de "sin Origin → 200" ya pasan hoy porque aún
no hay cabecera CORS que filtrar; actúan como **guardas anti-regresión** que deben
seguir verdes tras montar cors. El RED real de esos criterios lo aporta el test de
Origin permitido (que hoy falla).

## Contrato pendiente con el implementer (para que el GREEN sea posible)

1. **`errorHandler` (y `notFoundHandler` opcional)** exportados desde
   `backend/src/middleware/error-handler.ts` (nombres exactos). Firma de 4 args;
   consume `isProd` de `config/env.ts`.
2. **`RATE_LIMIT_MAX`** leído en `env.ts` para configurar el techo de
   `express-rate-limit` en `POST /names`. El test fija `RATE_LIMIT_MAX=2` para ser
   determinista y rápido (no dispara miles de requests). Si el implementer usa otro
   nombre de var o un límite fijo no configurable, este test no podrá pasar sin
   ajustar el contrato — coordinar con el leader. El limitador debe contar por IP y
   devolver **429**. **El body del 429 debe ser JSON `{ error, message }`** (mismo
   contrato que el `errorHandler`), no el HTML por defecto de `express-rate-limit`:
   configurar un `handler` (o `message`) del limitador que emita ese JSON. Reapertura
   RED (decisión del usuario, 2026-07-04): el reviewer detectó que el 429 salía con
   HTML por defecto; el assert de `content-type: application/json` + claves lo fuerza.
3. **`CORS_ORIGINS`** (lista por comas) leído en `env.ts`; allowlist parseada
   consumida por `cors` en `createApp()`. Origen no permitido → `callback(null,
   false)` (sin cabeceras, sin 500), conforme a ADR 15.2.
4. Orden en `createApp()`: `helmet` → `cors` → `express.json()` → `pino-http` →
   routers → `notFoundHandler` → `errorHandler` (ADR 15.3).

## Fuera de Supertest — se verifica por smoke/runtime (NO se testea aquí)

Conforme al design §7 y a AGENTS.md:

- **Logging pino / pino-http (migrar `console.*`):** pino/pino-http no son
  testeables de forma útil ni estable con Supertest (asertar sobre stdout/formato
  es frágil). Se verifica que emiten en `pnpm dev` y que **`app.ts` carga en
  runtime** con los nuevos middlewares vía `pnpm --filter @nach/backend smoke`.
  Clave porque un import ESM roto de `cors`/`helmet`/`pino-http` (default vs named)
  pasa lint + typecheck + vitest y solo revienta en runtime.
- **Graceful shutdown (SIGTERM/SIGINT):** vive en `server.ts` (depende de
  `httpServer` + Mongoose), no en `createApp()`. Un test de proceso hijo sería
  frágil y no se exige; se valida por diseño/manual.
