# Backend — Pendientes de mejora

Revisión de buenas prácticas del paquete `@nach/backend` (estado: fin de Fase 0).
El scaffold está limpio y bien organizado; este documento recoge las carencias
frente a las prácticas actuales y qué hacer antes de construir la lógica real
(cifrado + contador consecutivo) encima.

## Lo que ya está bien ✅

- **Separación `app.ts` / `server.ts`** — la app es testeable con Supertest sin
  tocar Mongo. Patrón correcto.
- **Config TS estricta** (`strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`) con `NodeNext` moderno.
- **`env` centralizado** — la app consume la config desde un único módulo, nunca
  `process.env` directo.
- **Extensiones `.js` en imports** — correcto para ESM con `NodeNext`.
- **Config plana de ESLint + integración con Prettier**, bien hecha.

## Hecho durante la revisión ✔️

- **ESLint subido a `recommendedTypeChecked`** (variante type-aware) con
  `projectService: true`. Antes usaba `recommended` (sin type-checking). Ahora se
  detectan bugs reales de async: `no-floating-promises` (llamada a Mongo/backend
  sin `await`), `no-misused-promises` (handler async donde se espera sync en
  Express) y `no-unsafe-*` (el resultado de descifrar / `res.json()` como `any`).
  Es el estándar actual de la industria para TS serio; se descartó
  `strictTypeChecked` por ruidoso para una prueba técnica. Verificado: `lint`,
  `typecheck` y `test` en verde.
- **Higiene de commits/push endurecida** (afecta a todo el repo):
  - **`no-console`** (permite `warn`/`error`/`info`) — evita que un `console.log`
    de depuración se cuele en un commit. Se ajustó el banner de arranque de
    `server.ts` a `console.info`.
  - **`vitest/no-focused-tests`** (error, solo en archivos de test) — bloquea
    `describe.only`/`it.only`, que desactivarían el resto de la suite en CI. Corre
    en el pre-commit vía lint-staged, así que aborta el commit. Nota: el flag
    `vitest --allowOnly=false` resultó no fiable (no devuelve exit ≠ 0), por eso la
    red es la regla ESLint, no el flag.
  - **Hook `pre-push`** nuevo (`pnpm typecheck && pnpm -r test`) — impide pushear
    código que no compila o con tests rojos.
- **Detección de secretos con gitleaks** (pre-commit vía Docker + job de CI).
  Detalle completo, reglas y verificación en [`seguridad.md`](seguridad.md).

> Todo lo relativo a seguridad (secretos, cifrado, cabeceras, rate limiting)
> vive centralizado en [`seguridad.md`](seguridad.md).

## Pendientes ⚠️

### 1. Validación de entorno que falla en silencio · Prioridad ALTA

`src/config/env.ts` pone las variables críticas (`MONGODB_URI`,
`CRYPTO_PRIVATE_KEY`) por defecto a `''`. Ausentes o inválidas, el servidor
arranca igual y falla tarde (o corre en estado inseguro).

- **Acción:** validación _fail-fast_ con Zod al boot (variables requeridas,
  formato PEM de la clave privada, etc.).
- **Detalle completo** (tabla de variables y reglas) en
  [`seguridad.md`](seguridad.md#1-validación-fail-fast-del-entorno--prioridad-alta).
- **Por qué importa aquí:** el objetivo del ejercicio es precisamente el cifrado;
  una clave vacía o mal formada rompe todo el flujo de forma silenciosa.

### 2. Falta middleware de seguridad/ops · Prioridad ALTA (cors) / MEDIA (resto)

Base estándar para una app Express 5 en producción:

- **`cors`** + **`helmet`** — **necesario ya** (cross-origin front↔back). Detalle
  de configuración (allowlist desde config, orden del middleware, white-label) en
  [`seguridad.md`](seguridad.md#3-cabeceras-y-cors--prioridad-alta-cors--media-helmet).
- **Manejador de errores centralizado** — Express 5 reenvía automáticamente los
  rechazos async, así que queda limpio de añadir. Debe devolver un JSON de error
  consistente y **no filtrar stack traces** en producción.
- **`express-rate-limit`** (opcional) — en el endpoint de escritura (ver
  `seguridad.md`).

### 3. Sin apagado ordenado (graceful shutdown) · Prioridad MEDIA

`src/server.ts` no maneja `SIGTERM`/`SIGINT` para cerrar el servidor HTTP y la
conexión de Mongoose. Estándar en despliegues con contenedores.

- **Acción:** capturar señales, dejar de aceptar conexiones, cerrar Mongoose y
  salir.

### 4. Sin logging estructurado · Prioridad MEDIA

`console.log` está bien para Fase 0, pero `pino` es el estándar actual.

- **Acción:** cablear `pino` (y `pino-http` para logs de request) antes de los
  endpoints reales.

### 5. Detalles menores · Prioridad BAJA

- **`@types/express` es redundante** — Express 5 trae sus propios tipos. Se puede
  quitar de `devDependencies`.
- **Falta `.nvmrc` / `.node-version`** pese a `engines.node >=20`.

## A verificar 🔍

- **`mongoose: ^9.7.3`** y **`typescript: ~6.0.3`** van por delante de lo
  esperado (Mongoose ~8.x y TS ~5.x en referencias previas). CLAUDE.md indica
  "dependencias a la última estable", así que es intencional — solo confirmar que
  instalan y compilan en CI.

## Orden sugerido

1. **Ahora (antes de la lógica real):** validación de entorno con Zod + `cors`.
2. **Al montar los endpoints de cifrado/contador:** `helmet`, manejador de
   errores centralizado, `pino`, graceful shutdown.
3. **Cuando sobre tiempo:** `express-rate-limit`, limpieza de menores.
