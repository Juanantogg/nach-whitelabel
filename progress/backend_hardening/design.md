# Design — backend_hardening

## Objetivo

Endurecer `@nach/backend` para producción sin cambiar la lógica de negocio ni el
contrato de los endpoints: `cors` (allowlist) + `helmet` antes de las rutas,
manejador de errores centralizado (JSON consistente, sin stack en prod), graceful
shutdown en `server.ts`, y logging estructurado con `pino`/`pino-http` en vez de
`console.*`. Rate limiting queda opcional. Menores: quitar `@types/express` y
añadir `.nvmrc`/`.node-version`.

Restricción rectora (ADR 7): lo testeable con Supertest vive sobre `createApp()`
(cors, helmet, errorHandler); lo que requiere ciclo de vida del proceso
(shutdown, arranque de pino-http, `app.listen`) vive en `server.ts` y se verifica
por smoke/runtime, no por Supertest.

## Contrato / arquitectura

### 1. Middlewares: dónde y en qué orden

**`app.ts` (`createApp`) — testeable con Supertest.** Orden exacto (en Express 5
el orden de `app.use` es el orden de ejecución; cors/helmet DEBEN ir antes de las
rutas para cubrir también las respuestas de error y los preflight):

```
1. helmet()                 → cabeceras de seguridad en toda respuesta
2. cors(corsOptions)        → allowlist; responde preflight OPTIONS
3. express.json()           → parseo body (ya existe)
4. pinoHttp(...)  (ver §5)  → log por request (inyecta req.log)
5. /health, /crypto, /names → routers (ya existen)
6. notFoundHandler (404)    → opcional: JSON 404 consistente para rutas no montadas
7. errorHandler(4 args)     → SIEMPRE el último use()
```

- `helmet` antes que `cors` es indiferente funcionalmente, pero se fija este orden
  para que las cabeceras de seguridad apliquen incluso a la respuesta del preflight.
- `express.json()` se mantiene donde está (tras cors, para no parsear cuerpos de
  orígenes rechazados innecesariamente; cors no bloquea la request server-side pero
  sí evita que el navegador lea la respuesta — ver §2).
- El `errorHandler` es el último middleware, con firma de 4 args, para que Express 5
  lo reconozca como error handler. Express 5 reenvía automáticamente los rechazos de
  handlers `async` a este middleware (mejora sobre Express 4); los controllers
  actuales pueden apoyarse en ello.
- `createApp()` no recibe parámetros nuevos: lee la config de `env.ts` (allowlist,
  `isProd`) directamente, igual que hoy. Así los tests de Supertest siguen llamando
  `createApp()` sin argumentos.

**`server.ts` — no testeable con Supertest, se verifica por smoke/runtime.**
Aloja: `validateEnv()` (ya existe), `connectDb()` (ya existe), `app.listen()`, el
**graceful shutdown** (§4) y el logger raíz de pino para los mensajes de arranque
(§5). El `httpServer` que devuelve `app.listen()` se captura en una variable para
poder cerrarlo en el shutdown.

### 2. Config CORS (nueva var de entorno en `env.ts`)

Nueva variable **`CORS_ORIGINS`**: lista de orígenes separada por comas, p.ej.
`https://elektra.garcia3apps.com,https://shopinbaz.garcia3apps.com`.

Añadir al `env` runtime object y al `envSchema` de Zod, siguiendo el patrón
existente. Se expone además una allowlist ya parseada (array) para que `app.ts` no
re-parsee.

Forma propuesta en `env.ts`:

```ts
// helper de parseo (comas → array, trim, descarta vacíos)
function parseOrigins(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// en el env object:
corsOrigins: parseOrigins(process.env.CORS_ORIGINS ?? 'http://localhost:5173'),
```

- **Default seguro en dev:** si `CORS_ORIGINS` no está, cae a
  `http://localhost:5173` (el dev server de Vite). NUNCA cae a `'*'`.
- **En el schema Zod:** `CORS_ORIGINS: z.string().optional().default('http://localhost:5173')`
  (string crudo; el parseo a array lo hace `parseOrigins`). No se valida formato de
  URL con Zod para no complicar; el valor es de operador de despliegue, no de usuario.
- **Allowlist vacía:** si tras el parseo el array queda vacío (p.ej. `CORS_ORIGINS=""`
  explícito), la política CORS **no permite ningún origen cross-origin** (falla
  cerrado). Se documenta como comportamiento intencional: en prod hay que fijar la
  allowlist; una allowlist vacía = nadie cross-origin, no todos.

**Comportamiento de `cors` ante un origen:**

```ts
const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    // Peticiones sin Origin (curl, same-origin, health checks) → permitidas.
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false); // origen no permitido: sin cabeceras CORS
    }
  },
  methods: ['GET', 'POST'],   // acotado a lo que usa la API
  credentials: false,          // no hay cookies
};
```

- **Origen permitido** → respuesta lleva `Access-Control-Allow-Origin: <origin>`.
- **Origen NO permitido** → `callback(null, false)`: el middleware NO añade las
  cabeceras CORS. La request se procesa server-side (200 si la ruta existe), pero el
  **navegador bloquea** la lectura de la respuesta por falta de
  `Access-Control-Allow-Origin`. Se usa `callback(null, false)` (no `callback(err)`)
  para no convertir un origen no permitido en un 500 ruidoso; simplemente no se
  autoriza. Esto es testeable con Supertest verificando **ausencia/presencia** de la
  cabecera (§7).
- **Peticiones sin `Origin`** (server-to-server, curl, same-origin) se permiten: no
  son un vector CORS.

> **Decisión de arquitectura NUEVA (para ADR):** origen no permitido responde con
> `callback(null, false)` (sin cabeceras CORS) en lugar de `callback(new Error())`
> (403/500). Razón: el modelo CORS es del navegador; devolver 500 a un origen no
> listado no aporta seguridad server-side y ensucia logs/errorHandler. Sugiero al
> leader añadir esto como matiz al ADR de CORS o como ADR breve.

### 3. Error handler centralizado

Nuevo módulo `backend/src/middleware/error-handler.ts` con firma Express 5 de 4
args (obligatoria para que Express lo trate como error handler):

```ts
import type { ErrorRequestHandler } from 'express';
import { isProd } from '../config/env.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  // Log estructurado del error (pino, no console) — ver §5.
  req.log?.error({ err, status }, 'request_failed');

  const body: Record<string, unknown> = {
    error: 'internal_error',
    message: status >= 500 ? 'Error interno del servidor' : (err?.message ?? 'Error'),
  };
  // Stack SOLO fuera de producción.
  if (!isProd && err instanceof Error) {
    body.stack = err.stack;
  }
  res.status(status).json(body);
};
```

**Forma del JSON de error (contrato consistente):**
```json
{ "error": "<codigo>", "message": "<texto>", "stack": "<solo si !isProd>" }
```

- **En prod (`isProd === true`):** nunca se incluye `stack`. Para errores 5xx el
  `message` es genérico (`"Error interno del servidor"`), no filtra detalle interno
  ni criptográfico (coherente con `seguridad.md`: códigos genéricos, sin stack).
- **En dev/test:** se añade `stack` para depurar.
- **Logging:** el error se loguea vía `req.log.error` (pino-http inyecta `req.log`).
  Nunca por `console.*` (respeta `no-console`).
- Los controllers actuales que ya devuelven códigos (`invalid_payload`,
  `decryption_failed`, `crypto_unavailable`, `internal_error`) NO se tocan: siguen
  respondiendo directamente. El errorHandler es la **red** para excepciones no
  capturadas / rechazos async que Express 5 reenvía.

### 4. Graceful shutdown (solo `server.ts`)

Tras `const httpServer = app.listen(...)`, registrar los handlers de señal:

```ts
const SHUTDOWN_TIMEOUT_MS = 10_000;

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutdown_start');
  // 1. Dejar de aceptar conexiones nuevas; espera a que drenen las en curso.
  httpServer.close(() => {
    // 2. Cerrar Mongoose (disconnectDb ya existe en config/db.ts).
    disconnectDb()
      .then(() => { logger.info('shutdown_complete'); process.exit(0); })
      .catch((err) => { logger.error({ err }, 'shutdown_error'); process.exit(1); });
  });
  // 3. Red de seguridad: si algo se cuelga, salir por las malas.
  setTimeout(() => {
    logger.error('shutdown_timeout'); process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

**Secuencia exacta:** señal → `httpServer.close()` (deja de aceptar, drena en
curso) → `disconnectDb()` (Mongoose) → `process.exit(0)`. Timeout de seguridad de
10 s con `.unref()` (no mantiene vivo el proceso) que fuerza `exit(1)` si el cierre
se cuelga. Señales cubiertas: **SIGTERM** (orquestador/App Runner) y **SIGINT**
(Ctrl-C en dev). Vive en `server.ts` porque depende de `httpServer` y de la
conexión Mongo, ninguno de los cuales existe en `createApp()`.

### 5. Logging estructurado (pino / pino-http)

- **`pino-http`** se monta como middleware en `createApp()` (paso 4 del orden):
  inyecta `req.log` (logger con `req.id`) que usan controllers y el errorHandler.
- **`pino`** raíz se usa en `server.ts` para los mensajes de ciclo de vida
  (arranque, shutdown) y en `db.ts` si se migra su `console`.
- **`no-console` (eslint):** la regla actual permite `warn`/`error`/`info`, así que
  los `console.*` de hoy NO fallan lint. Aun así se **migran a pino** por el
  acceptance ("logging estructurado en lugar de `console.*`"):
  - `server.ts`: `console.error/info` → `logger.error/info`.
  - `db.ts`: no tiene `console` (lanza Error); sin cambios de logging.
  - No introducir `console.log` nuevo (ese sí lo bloquea la regla).
- **Nivel/formato:** pino emite JSON por defecto (bueno para prod/CloudWatch). En dev
  puede usarse `pino-pretty` como dep opcional, pero NO es necesario para el
  acceptance; se deja fuera para minimizar deps (decisión del leader si lo quiere).
- **Config de pino:** nivel desde env (`LOG_LEVEL`, opcional, default `info`).
  Opcional; no bloquea. Si se añade, va en `env.ts` con el mismo patrón.

Un logger compartido: `backend/src/config/logger.ts` que exporta `logger` (pino) y
la instancia de `pino-http` (o su factory), para no crear dos configuraciones.

### 6. Dependencias

**Añadir (dependencies):**
- `cors`
- `helmet`
- `pino`
- `pino-http`

**Añadir (devDependencies):**
- `@types/cors` (cors no trae tipos propios). helmet, pino y pino-http SÍ traen
  tipos propios → no añadir `@types/*` para ellos.

**Opcional (NO en el alcance base):**
- `express-rate-limit` — solo si es trivial montarlo en `/names`. Ver §7.

**Quitar (devDependencies):**
- `@types/express` — Express 5 incluye sus propios tipos; es redundante y puede
  chocar de versión.

**Menores (archivos nuevos, sin código):**
- `.nvmrc` y `.node-version` en la raíz con una versión LTS acorde a
  `engines.node: ">=20"`. Propuesta: `20` (o `20.x`) para no fijar patch. Ambos
  archivos con el mismo contenido (nvm lee `.nvmrc`, fnm/otros leen `.node-version`).

### 7. Contrato de tests (para el tester — RED antes de implementar)

Nuevo archivo de tests de middleware sobre `createApp()`, p.ej.
`backend/src/app.middleware.test.ts` (Supertest). El graceful shutdown y pino NO se
testean con Supertest; se verifican por smoke/runtime.

**CORS (allowlist desde config):**
1. `GET /health` con header `Origin` **permitido** (uno de `env.corsOrigins`)
   → respuesta incluye `access-control-allow-origin` igual a ese origen.
2. `GET /health` con header `Origin` **NO permitido** (`https://evil.example`)
   → respuesta NO incluye `access-control-allow-origin` (o no lo refleja).
3. Preflight `OPTIONS /names` con `Origin` permitido y
   `Access-Control-Request-Method: POST` → responde con
   `access-control-allow-methods` que incluye `POST` (y `GET`), status 204/200.
4. (Opcional) request sin header `Origin` → se procesa normal (200), sin romper.
   > Nota para el tester: para (1)-(3) hace falta un origen permitido conocido. Fijar
   > `process.env.CORS_ORIGINS` en el setup del test (o usar el default de dev
   > `http://localhost:5173`) para tener un origen determinista.

**Helmet (cabeceras presentes):**
5. `GET /health` incluye `x-content-type-options: nosniff`.
6. `GET /health` incluye `x-dns-prefetch-control` (o la cabecera representativa de
   helmet que se elija) — el tester elige 1-2 cabeceras estables de helmet como
   prueba de que está activo. Evitar aserciones sobre HSTS (`strict-transport-security`),
   que helmet solo emite bajo HTTPS y puede no aparecer en test sobre http.

**Error handler (JSON consistente, sin stack en prod):**
7. Con una ruta de prueba que lanza (o forzando un handler que hace `next(err)`),
   la respuesta tiene forma `{ error, message }` y `content-type: application/json`.
   > Para provocar el error sin ensuciar producción, el tester puede montar una ruta
   > temporal en una app de test o disparar un error real conocido (p.ej. body
   > inválido). Recomendado: helper que crea una app con una ruta que lanza,
   > reutilizando el `errorHandler` exportado.
8. Con `NODE_ENV=production` (o mockeando `isProd=true`), la respuesta de error 5xx
   **NO** incluye `stack` y el `message` es genérico.
9. Con `NODE_ENV` distinto de production, la respuesta de error incluye `stack`.
   > `isProd` se resuelve al importar `env.ts`; el tester debe fijar `NODE_ENV`
   > **antes** de importar el módulo (o usar `vi.resetModules()` + import dinámico).

**404 (si se añade notFoundHandler):**
10. `GET /ruta-inexistente` → 404 con JSON `{ error: ... }` (no el HTML por defecto
    de Express). Opcional, solo si se implementa el notFoundHandler.

**Verificado por smoke/runtime, NO por Supertest (indicar en `tests.md`):**
- Graceful shutdown (SIGTERM/SIGINT cierran HTTP + Mongoose): se comprueba
  manualmente / por el diseño; opcionalmente un test de proceso hijo, pero es frágil
  y NO se exige. El `pnpm --filter @nach/backend smoke` confirma que `app.ts` (con
  cors/helmet/pino-http/errorHandler nuevos) **carga en runtime** — clave porque un
  import ESM roto (p.ej. default vs named de pino-http/cors) pasa lint+typecheck+
  vitest y solo revienta en runtime (ver AGENTS.md). Añadir `server.ts` al smoke NO
  es viable (llama a `app.listen`); basta con que `app.ts` cargue.
- pino/pino-http emitiendo: se observa en `pnpm dev`, no se asegura por test.

**express-rate-limit (opcional):** si se implementa, test 11: N+1 requests a `POST
/names` desde la misma IP → la que excede el límite responde `429`. Marcar como
opcional; no bloquea el GREEN de la feature.

## Alternativas consideradas

### CORS: cómo rechazar un origen no permitido
- **A — `callback(null, false)` (recomendada):** no añade cabeceras CORS; la request
  se procesa server-side y el navegador la bloquea al leer. Sin 500 ruidoso, sin
  ensuciar el errorHandler ni los logs con "orígenes no listados". Testeable por
  ausencia de cabecera.
- **B — `callback(new Error('CORS'))`:** convierte el origen no listado en un error
  que cae al errorHandler → 500. Genera ruido y confunde "origen no autorizado" con
  "fallo del servidor". Descartada.
- **Recomendación: A.**

### Logging: dónde configurar pino
- **A — un `config/logger.ts` compartido (recomendada):** una sola config; `app.ts`
  usa `pino-http`, `server.ts`/`db.ts` usan el `logger` raíz. Evita dos setups.
- **B — pino-http inline en app.ts + otro pino inline en server.ts:** duplica config
  y nivel; fácil que diverjan. Descartada.
- **Recomendación: A.**

### Error handler: propagación async
- Express 5 ya reenvía rechazos de handlers `async` al errorHandler → **no hace falta**
  un wrapper `asyncHandler` ni `express-async-errors`. Aplico minimalismo: no se añade
  utilidad ni dependencia; se confía en el comportamiento nativo de Express 5.

## Recomendación

Implementar en este orden (facilita el RED→GREEN):
1. `env.ts`: `CORS_ORIGINS` + `corsOrigins` parseado + schema Zod (default dev seguro).
2. `config/logger.ts`: `logger` (pino) + `pino-http`.
3. `middleware/error-handler.ts`: `errorHandler` (+ opcional `notFoundHandler`).
4. `app.ts`: montar helmet → cors → json → pino-http → routers → 404 → errorHandler.
5. `server.ts`: capturar `httpServer`, graceful shutdown, migrar `console.*` a pino.
6. Deps: +cors +helmet +pino +pino-http +@types/cors; −@types/express;
   `.nvmrc`/`.node-version`.
7. (Opcional) express-rate-limit en `/names`.

Confirmar el GREEN de backend con `pnpm --filter @nach/backend smoke` además de los
tests (import ESM de cors/helmet/pino-http puede romper solo en runtime).

## Criterios de aceptación traducibles a tests

- [ ] `Origin` permitido → respuesta con `access-control-allow-origin` = ese origen.
- [ ] `Origin` no permitido → respuesta SIN `access-control-allow-origin`.
- [ ] Preflight `OPTIONS` de `/names` con origen permitido → `access-control-allow-methods` incluye `POST` y `GET`.
- [ ] `GET /health` incluye `x-content-type-options: nosniff` (helmet activo).
- [ ] Respuesta de error tiene forma `{ error, message }` en JSON.
- [ ] En producción (`isProd`) la respuesta de error 5xx NO incluye `stack` y el `message` es genérico.
- [ ] Fuera de producción la respuesta de error incluye `stack`.
- [ ] (Opcional) ruta inexistente → 404 JSON `{ error }`.
- [ ] (Opcional) exceso de requests a `POST /names` → 429.
- [ ] `app.ts` con los middlewares nuevos CARGA en runtime (`pnpm ... smoke`).
- [ ] `@types/express` eliminado de devDependencies; `.nvmrc` y `.node-version` presentes.
- [ ] Ningún `console.log` nuevo; mensajes de arranque/shutdown vía pino.

### Nota para el leader (ADR nuevo)
El diseño introduce una decisión no cubierta en `docs/decisiones.md`: **el rechazo
CORS usa `callback(null, false)` (sin cabeceras) en vez de responder error/403**.
Si se acepta, conviene registrarla como ADR breve (o matiz al punto de CORS de
`seguridad.md §3`).
