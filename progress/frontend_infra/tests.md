# Tests (RED) — frontend_infra

Fase RED del TDD. Tests de Vitest que FALLAN porque el código de producción aún
no existe. Derivados de la sección "Criterios de aceptación traducibles a tests"
de `design.md` (11 criterios) y del "Orden RED->GREEN".

## Archivos de test nuevos

- `frontend/src/config/env.test.ts`
- `frontend/src/api/apiError.test.ts`
- `frontend/src/api/client.test.ts`
- `frontend/src/components/ErrorBoundary.test.tsx`

## Qué cubre cada test y mapeo a acceptance

### `src/config/env.test.ts` → módulo `../config/env` (inexistente)

Cubre `validateEnv(source?)` (función pura, `source` inyectable) y el objeto
`env` hidratado del entorno.

| Test | Criterio |
|---|---|
| `apiUrl ausente → ""` | #2 (`''` es válido en dev) |
| `recorta el trailing slash de apiUrl` | #2 (sin trailing slash, evita doble barra) |
| `preserva apiUrl sin trailing slash tal cual` | #2 |
| `defaultBrand es undefined cuando la var está ausente` | #3 |
| `defaultBrand es undefined cuando la var está vacía` | #3 |
| `defaultBrand refleja el valor cuando está presente` | #3 (camino con valor) |
| `success es siempre true con las vars actuales` | #1 (nunca falla / nunca lanza) |
| `env existe y expone apiUrl sin lanzar aunque el entorno esté vacío` | #1/#2 (smoke de hidratación, no rompe en blanco) |
| `env se hidrata del entorno vía import.meta.env` | #1 (usa `vi.stubEnv` + `vi.unstubAllEnvs()` en afterEach) |

Nota: el caso de hidratación verifica el mecanismo con `validateEnv(import.meta.env)`
tras `vi.stubEnv`, sin re-importar el módulo (evita acoplarse al momento de
evaluación del singleton `env`), fiel al diseño que separa la lógica pura del
singleton.

### `src/api/apiError.test.ts` → módulo `./apiError` (inexistente)

Cubre la clase `ApiError` (error tipado, no genérico).

| Test | Criterio |
|---|---|
| `es instancia de Error` | #5/#6 (forma de error; la UI puede distinguirlo) |
| `expone el status HTTP` | #5 |
| `usa status 0 como convención de "sin respuesta"` | #6 |
| `preserva la causa original` | #6 (`cause`) |

### `src/api/client.test.ts` → módulos `./client` + `./apiError` (inexistentes)

Cubre `apiFetch<T>(path, init?, { fetchFn?, apiUrl? })` con `fetchFn` SIEMPRE
mockeado (nunca red real).

| Test | Criterio |
|---|---|
| `respuesta ok → devuelve JSON tipado como T` | #4 |
| `!res.ok → ApiError con status = HTTP status` | #5 (camino de error HTTP) |
| `rechazo de red → ApiError status 0 y preserva cause` | #6 (borde: red caída) |
| `URL con UNA barra cuando apiUrl trae trailing slash` | #7 |
| `URL con UNA barra cuando apiUrl NO trae trailing slash` | #7 |
| `añade Accept: application/json por defecto` | #7 |
| `no pisa los headers del llamador (merge)` | #7 (borde: POST con Content-Type + método propio) |

### `src/components/ErrorBoundary.test.tsx` → módulo `./ErrorBoundary` (inexistente)

Testing Library sobre jsdom. Silencia `console.error` (React lo vuelca dentro del
boundary) con `vi.spyOn` en `beforeEach` y lo restaura en `afterEach`.

| Test | Criterio |
|---|---|
| `renderiza hijos sanos sin interferencia` | #10 |
| `hijo que lanza en render → fallback neutro y no propaga el crash` | #9 + #11 (localiza por texto neutro `/algo salió mal/i`, no por implementación) |
| `usa el fallback provisto por prop en lugar del neutro` | #9 (prop `fallback`) |

## Evidencia de RED

Comando: `pnpm --filter @nach/frontend test`

```
 FAIL  src/api/apiError.test.ts    Failed to resolve import "./apiError"
 FAIL  src/api/client.test.ts      Failed to resolve import "./client"
 FAIL  src/config/env.test.ts      Failed to resolve import "./env"
 FAIL  src/components/ErrorBoundary.test.tsx   Failed to resolve import "./ErrorBoundary"

 Test Files  4 failed | 12 passed (16)
      Tests  71 passed (71)
```

Los 4 archivos nuevos fallan por **módulo inexistente** (resolución de import),
NO por error de sintaxis del test — RED real. Los 12 archivos previos (71 tests)
siguen en verde.

### `fetchPublicKey.test.ts` NO se tocó y sigue pasando

Comando: `pnpm --filter @nach/frontend exec vitest run src/crypto/fetchPublicKey.test.ts`

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Este test existente es la red de seguridad del refactor del implementer
(delegar `fetchPublicKey` en `apiFetch` conservando firma, retorno y texto de
error). No se modificó su fuente ni su archivo de test.

## Nota para el implementer (GREEN)

- Crear en orden de dependencias: `src/config/env.ts` → `src/api/apiError.ts`
  → `src/api/client.ts` → `src/api/index.ts` → `src/components/ErrorBoundary.tsx`.
- El texto neutro del fallback por defecto debe contener "Algo salió mal"
  (el test localiza `/algo salió mal/i`, case-insensitive).
- El header por defecto es `Accept: application/json`, mergeado (no reemplaza)
  con los headers del llamador; el método del llamador se respeta.
- NO modificar ningún archivo `*.test.*` para hacer pasar los tests.
