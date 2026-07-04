# Tests (RED) — consecutive_counter

Fase RED del TDD. Tests que **fallan a propósito** porque el código de producción
aún no existe. Derivados de `progress/consecutive_counter/design.md`, sección
"Criterios de aceptación traducibles a tests".

## Archivos de test

| Archivo | Grupo del design | Técnica |
|---|---|---|
| `backend/src/routes/names.routes.test.ts` | Grupos 1 y 2 (endpoint `POST /names`) | Supertest sobre `createApp()`, `counter.service` mockeado |
| `backend/src/config/env.validate.test.ts` | Grupo 3 (`validateEnv`) | Unit puro sobre la función |

### Justificación de ubicación

- **`names.routes.test.ts` (nuevo, dedicado):** los criterios de secuencia y
  longitud del consecutivo son propios de esta feature. No se tocó
  `crypto.routes.test.ts` (regresión de `crypto_hybrid`, debe quedar intacto).
  Separar en su propio archivo mantiene limpia la frontera entre features.
- **`env.validate.test.ts` (nuevo, no extiende `env.test.ts`):** `env.test.ts`
  es la regresión que fija la forma del objeto `env` (`cryptoPrivateKey`, no
  `cryptoSecret`) de `crypto_hybrid`. La función `validateEnv` es material nuevo;
  un archivo aparte evita mezclar el RED de esta feature con esa regresión y deja
  `env.test.ts` inmutable.

## Estrategia de mock del service (Grupos 1 y 2)

`counter.service` **no existe todavía**. Se mockea con
`vi.mock('../services/counter.service.js', ...)` exponiendo `createRecord` como
una `vi.fn<(name: string) => Promise<number>>()`. Dos objetivos:

1. **Inyectar la secuencia sin Mongo** (`mockResolvedValueOnce(1).mockResolvedValueOnce(2)`,
   `mockRejectedValue(...)` para el fallo de persistencia).
2. **Espiar el argumento** con que el controller invoca el service (verifica que
   recibe el nombre **ya descifrado**, no el ciphertext).

El controller de producción **debe importar** `createRecord` desde
`../services/counter.service.js` para que el mock intercepte. Hoy usa un
`stubCounter` en memoria y no importa ese módulo → por eso los espías reportan
"0 llamadas" (RED legítimo).

El cifrado de ida/vuelta en los tests usa el kit compartido
`services/__test__/cryptoTestKit.ts` (`generateTestKeyPair`, `encryptNameAsFront`,
`decryptReturnAsFront`), igual que `crypto.routes.test.ts`. No se reinventa cripto
en los tests.

## Mapeo caso → test → motivo de fallo esperado

### Grupo 1 — Secuencia del consecutivo (`names.routes.test.ts`)

| # | Test | Qué verifica | Motivo de fallo RED |
|---|---|---|---|
| 1 | dos peticiones válidas → números crecientes provenientes del service | mock devuelve 1 y 2; ambas respuestas descifran a `/^\d+$/`; `n1<n2`; el número **viene del service** (`createRecord` llamado 2 veces) | El controller no importa el service → `createRecordMock` recibe **0 llamadas** (`toHaveBeenCalledTimes(2)` falla). El stub global no garantiza que el número provenga del service. |
| 2 | invoca el service con el nombre YA descifrado | `POST /names` con "Sofía" cifrado → `createRecord` llamado con `'Sofía'` | El service no se invoca → **0 llamadas** (`toHaveBeenCalledWith('Sofía')` falla). |
| 3 | round-trip: 200, IV nuevo, front descifra `/^\d+$/` | regresión del contrato de vuelta tras el cambio a async | **PASA (verde)** — es la red que garantiza que el round-trip existente no se rompe. El stub actual ya devuelve un número. |
| 4 | fallo de persistencia (service lanza) → 500 `internal_error` | `mockRejectedValue` → respuesta 500 con `error:'internal_error'` | El stub nunca falla → hoy devuelve **200** (`toBe(500)` falla). |

### Grupo 2 — Validación de longitud ≤ 15 (`names.routes.test.ts`)

| # | Test | Qué verifica | Motivo de fallo RED |
|---|---|---|---|
| 5 | nombre de 16 chars → 400 `invalid_payload`, service NO invocado | falla-cerrado: no persiste | El techo actual es 256; un nombre de 16 pasa y devuelve **200** (`toBe(400)` falla). |
| 6 | nombre de exactamente 15 chars → 200 (límite inclusivo) | "0/15" de las maquetas | El service no se invoca (no importado) → `toHaveBeenCalledWith(nombre15)` falla con **0 llamadas**. |
| 7 | *(cubierto por `crypto.routes.test.ts`)* | payload incompleto/no-base64 → 400; tag manipulado/clave ajena → 422; privada inválida → 500 | No se re-testea aquí; regresión intacta (ver abajo). |

### Grupo 3 — `validateEnv` (`env.validate.test.ts`)

`validateEnv(source = process.env)` es pura y **no** llama a `process.exit` (el
fail-fast real vive en `server.ts`). El helper `esInvalido` acepta ambas
convenciones de firma (devolver `{success:false}` o lanzar `ZodError`), pero
**exige primero** `typeof validateEnv === 'function'` para no enmascarar el RED:
si la función no existe, el test falla por ausencia de código, no porque
`undefined()` casualmente lance.

| # | Test | Qué verifica | Motivo de fallo RED |
|---|---|---|---|
| 8 | `MONGODB_URI` ausente → inválido | requerida | `validateEnv` no existe (no exportada; `zod` no instalado) → `expect(typeof validateEnv).toBe('function')` falla. |
| 9 | `MONGODB_URI` sin prefijo mongo → inválido | regex `^mongodb(\+srv)?://` | ídem: función ausente. |
| 10 | `CRYPTO_PRIVATE_KEY` no-PEM → inválido | carga real de la clave, no solo prefijo | ídem: función ausente. |
| 11 | combo válido (URI mongo + PEM real del kit) → válido, `port` default 3001 | camino feliz + default | ídem: función ausente → `esInvalido` devuelve `true` en vez de `false`. |
| 11b | acepta `mongodb+srv://` → válido | variante SRV de Atlas | ídem. |
| 12 | importar `env.ts` NO aborta el proceso | garantía de que los tests que hacen `import { env }` sin `MONGODB_URI` siguen corriendo | **Verificado implícitamente:** las 4 suites de regresión (incluida `env.test.ts`, que importa `env`) siguen ejecutando y en verde. No se añadió test explícito por redundancia. |

## Notas técnicas del RED

- **`zod` NO está instalado en el backend** (solo lo usa el front hoy). El test de
  `validateEnv` importa de un módulo que aún no exporta la función → RED legítimo.
  **No se instaló ninguna dependencia** (es trabajo del implementer / GREEN).
- **Type-safety del RED de env:** para que el test sea `tsc`-limpio y ESLint-limpio
  HOY sin que TypeScript exija que el export ya exista, se usa import de namespace
  (`import * as envModule`) + cast tipado a la firma esperada `ValidateEnv`. El
  fallo se produce en **runtime** (`validateEnv` es `undefined`), no por un error
  de tipos que ocultaría el rojo. Sin `any`.
- **`names.routes.test.ts`** compila y linta limpio; los fallos son de aserción en
  ejecución (comportamiento ausente), no de import/sintaxis.

## Regresión a vigilar (deben seguir VERDES — el implementer no las toca)

Verificado corriéndolas en aislamiento: **4 suites, 21 tests, todas en verde.**

- `config/env.test.ts` — `env` expone `cryptoPrivateKey`, no `cryptoSecret`.
- `app.test.ts` — health 200.
- `routes/crypto.routes.test.ts` — round-trip cripto completo (400/422/500/200).
- `services/crypto.service.test.ts` — service de cifrado.

El diseño afirma que el objeto `env` mantiene su forma (`validateEnv` es adición,
no cambio de forma) y que el round-trip sigue devolviendo `/^\d+$/`; ambas cosas
quedan cubiertas por estas suites + el test #3. **No se detectó ninguna regresión
que el diseño rompa.** Punto a re-confirmar en GREEN: cuando el implementer añada
la validación `> 15`, el techo de 256 desaparece; ningún test existente depende de
enviar un nombre de entre 16 y 256 chars, así que no debería romperse nada.

## Evidencia del runner (RED)

Comando: `pnpm --filter @nach/backend test`

```
❯ src/config/env.validate.test.ts (5 tests | 5 failed)
   × #8 con MONGODB_URI ausente → inválido
   × #9 con MONGODB_URI sin prefijo mongo → inválido
   × #10 con CRYPTO_PRIVATE_KEY no-PEM → inválido
   × #11 combo válido (URI mongo + PEM real) → válido y port default 3001
   × #11b acepta mongodb+srv:// como URI válida
❯ src/routes/names.routes.test.ts (6 tests | 5 failed)
   × #1 dos peticiones válidas consecutivas devuelven números crecientes provenientes del service
   × #2 invoca el service con el nombre YA descifrado
   × #4 fallo de persistencia (el service lanza) → 500 internal_error
   × #5 nombre descifrado de 16 caracteres → 400 invalid_payload y el service NO se invoca
   × #6 nombre descifrado de exactamente 15 caracteres → 200 (límite inclusivo)

 Test Files  2 failed | 4 passed (6)
      Tests  10 failed | 22 passed (32)
```

- **10 tests nuevos en rojo** (5 env + 5 names) — el RED esperado.
- **22 en verde**: 21 de regresión + el test #3 (round-trip), que valida que el
  contrato de vuelta no se rompe.
- `tsc --noEmit` y `eslint` sobre los dos archivos nuevos: **limpios** (el rojo es
  de comportamiento, no de tooling).

## Ajuste de regresión: mock de `counter.service` en `crypto.routes.test.ts`

**Contexto (2026-07-04):** al reemplazar el `stubCounter` en memoria por el
consecutivo real persistido en Mongo (`counter.service.createRecord`), el test
200 de `crypto.routes.test.ts` ("descifra el nombre y devuelve el consecutivo
cifrado (200)…") empezó a invocar `createRecord` real. Sin conexión a Mongo,
Mongoose hace buffering y el test se colgaba hasta el timeout de 5s. Los demás
tests de ese archivo (422/400/500) no llegan a llamar al service y no se veían
afectados.

**Qué se cambió:** se añadió `vi.mock('../services/counter.service.js', …)` con
`createRecord: vi.fn().mockResolvedValue(1)`. El registro de mocks de Vitest
persiste a través del `vi.resetModules()` que usa cada bloque, así que el
`import('../app.js')` dinámico siempre recibe el service mockeado.

**Por qué (design.md, "Punto crítico para el tester", ~L162):** los tests de
endpoint no arrancan Mongo; el `counter.service` debe mockearse para no exigir
infra. La verificación de atomicidad `$inc` real es un test de integración
opcional (mongodb-memory-server), no obligatorio para el GREEN.

**Aserciones preservadas:** el round-trip sigue verificando status 200, `iv` de
vuelta ≠ `iv` de ida y `decryptReturnAsFront` → `/^\d+$/`. Solo se desacopló el
service de Mongo; ninguna aserción de cifrado se ablandó.

**Evidencia (verde):**
```
 Test Files  6 passed (6)
      Tests  32 passed (32)   Duration ~450ms (sin timeouts)
```
`tsc --noEmit` y `eslint .` del backend: limpios.
