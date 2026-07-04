# Tests — crypto_hybrid (fase RED)

Fase **RED** del ciclo TDD: tests derivados del acceptance y de la sección
"Qué se testea (RED)" del `design.md` (14 casos). Todos FALLAN ahora porque el
código de producción aún no existe. El implementer los pondrá en verde sin
tocarlos.

## Veredicto RED

- **Backend:** 3 suites en rojo.
  - `src/services/crypto.service.test.ts` → falla al cargar: `Cannot find module
    './crypto.service.js'` (módulo ausente). 8 tests bloqueados por el import.
  - `src/config/env.test.ts` → 2 tests fallan por forma del objeto `env`
    (`cryptoSecret` sigue presente, `cryptoPrivateKey` ausente).
  - `src/routes/crypto.routes.test.ts` → 8 tests fallan con **404** (rutas
    `GET /crypto/public-key` y `POST /names` no montadas todavía).
- **Frontend:** 4 suites en rojo.
  - `encryptName.test.ts`, `decryptNumber.test.ts`, `fetchPublicKey.test.ts` →
    `Failed to resolve import` (módulos de producción ausentes).
  - `noSecretInBundle.test.ts` → el test ancla ("existe al menos un módulo de
    producción") falla (aún no hay `.ts` de producción en `src/crypto/`).

Todos los fallos son por **código ausente**, no por errores de sintaxis/setup.
Verificado además que ambos kits de test interoperan de verdad (Web Crypto ↔
`node:crypto`) en un round-trip completo → los tests virarán a verde cuando el
implementer respete las convenciones de interop documentadas.

## Archivos creados

### Backend
- `backend/src/services/__test__/cryptoTestKit.ts` — kit compartido: genera par
  RSA-2048 (SPKI/PKCS8 PEM) e implementa "el lado del front" con `node:crypto`
  (`encryptNameAsFront`, `decryptReturnAsFront`). No es un test; es fixture.
- `backend/src/services/crypto.service.test.ts`
- `backend/src/config/env.test.ts`
- `backend/src/routes/crypto.routes.test.ts`

### Frontend
- `frontend/src/crypto/__test__/backSideKit.ts` — kit compartido: genera par RSA
  e implementa "el lado del back" con `node:crypto` (`decryptNameAsBack`,
  `encryptReturnAsBack`). Fixture, no test.
- `frontend/src/crypto/encryptName.test.ts`
- `frontend/src/crypto/decryptNumber.test.ts`
- `frontend/src/crypto/fetchPublicKey.test.ts`
- `frontend/src/crypto/noSecretInBundle.test.ts`

## Mapeo test ↔ acceptance (los 14 casos del design)

| # design | Test | Archivo |
|---|---|---|
| 1 | GET /crypto/public-key → 200 PEM SPKI + `alg: RSA-OAEP-256` | `crypto.routes.test.ts` › "responde 200 con la pública en PEM SPKI…" |
| 1 (service) | `getPublicKeyPem` deriva SPKI desde la privada; lanza si inválida | `crypto.service.test.ts` › "getPublicKeyPem …" |
| 2 | Round-trip de IDA: `decryptName` recupera el nombre exacto | `crypto.service.test.ts` › "recupera exactamente el nombre…" |
| 2 (borde) | Tag GCM manipulado → lanza; clave de otra pública → lanza | `crypto.service.test.ts` › "lanza cuando el tag GCM…" / "…OTRA pública…" |
| 3 | Round-trip de VUELTA: `encryptForClient` → front descifra | `crypto.service.test.ts` › "el front descifra el consecutivo…" |
| 3 (IV) | IV vuelta de 12 bytes, nuevo por llamada, ≠ IV de ida | `crypto.service.test.ts` › "usa un IV de 12 bytes…" / "el IV de la vuelta difiere…" |
| 3 (unwrap) | `unwrapSessionKey` recupera los 32 bytes de la clave AES | `crypto.service.test.ts` › "recupera los 32 bytes exactos…" |
| 4 | POST /names end-to-end → 200; front descifra el consecutivo stub | `crypto.routes.test.ts` › "descifra el nombre y devuelve el consecutivo…" |
| 5 | POST /names tag GCM manipulado → 422 `decryption_failed` | `crypto.routes.test.ts` › "…si el tag GCM del nombre fue manipulado" |
| 6 | POST /names `encryptedKey` de otra pública → 422 | `crypto.routes.test.ts` › "…envuelta con OTRA pública" |
| 7 | Payload incompleto → 400; campo no base64 → 400 `invalid_payload` | `crypto.routes.test.ts` › "…falta un campo…" / "…no es base64" |
| 8 | Privada por parámetro/env, nunca hardcodeada; inválida → 500 | `crypto.service.test.ts` › "el fuente … no contiene una PRIVATE KEY"; `crypto.routes.test.ts` › "…500 crypto_unavailable" / "…500 public_key_unavailable" |
| 9 | `env` ya no expone `cryptoSecret` y sí `cryptoPrivateKey` | `env.test.ts` (2 tests) |
| 10 | `encryptName` → { encryptedKey, iv, ciphertext } base64 + sessionKey AES-GCM 256 | `encryptName.test.ts` › "devuelve encryptedKey, iv y ciphertext…" |
| 11 | Round-trip front↔back simulado: back descifra el nombre exacto | `encryptName.test.ts` › "el back … desenvuelve y descifra el nombre exacto" |
| 12 | `decryptNumber` descifra el sobre AES-GCM → número; tag inválido rechaza | `decryptNumber.test.ts` (2 tests) |
| 13 | `fetchPublicKey` GET `${apiUrl}/crypto/public-key`; propaga si !res.ok | `fetchPublicKey.test.ts` (2 tests) |
| 14 | Cero secreto en el bundle: ningún módulo con `PRIVATE KEY`/`VITE_CRYPTO_SECRET` | `noSecretInBundle.test.ts` (2 tests) |

## Gotchas de interop verificados en los propios tests

Los kits de test replican el "otro lado" del esquema y comprueban de forma
ejecutable las trampas que señala el research, para que el implementer no se
desvíe:

- **RSA-OAEP con `oaepHash: 'sha256'`** (no el SHA-1 por defecto de Node). Los
  tests de "clave de otra pública → falla" y los round-trips solo pasan con
  sha256 en ambos lados.
- **IV de 12 bytes (96 bits).** Aserción directa `Buffer.from(iv,'base64')` /
  `atob(iv)` de longitud 12.
- **authTag CONCATENADO al ciphertext (`ct || tag`, últimos 16 bytes)** — la
  convención nativa de Web Crypto adoptada por el contrato en ambos sentidos. Los
  kits hacen `slice(-16)` / `concat` contra Node `getAuthTag`/`setAuthTag`. Los
  tests de manipulación corrompen `ciphertext[0]` para forzar el fallo del tag.
- **Pública SPKI / privada PKCS#8** (no PKCS#1). Aserciones de que el PEM
  contiene `BEGIN PUBLIC KEY` y NO `BEGIN RSA PUBLIC KEY`.
- **base64 estándar** (no base64url): `isStandardBase64` en `encryptName.test.ts`.
- **IV vuelta ≠ IV ida** con la MISMA clave AES (regla dura de GCM): aserciones
  explícitas en service y en el endpoint end-to-end.

## Estrategia de inyección de la clave (sin red ni `.env` real)

- **Service:** la privada se inyecta **por parámetro** (`privatePem`), con un par
  RSA generado en el propio test (`generateTestKeyPair`).
- **Endpoint:** la privada se inyecta vía `process.env.CRYPTO_PRIVATE_KEY` con
  `vi.stubEnv` + `vi.resetModules()` + import dinámico de `createApp`, para variar
  la clave por bloque (válida vs basura) y ejercitar el 500 sin fugas de estado.

## Higiene de tipos/lint de los archivos de test (post-GREEN)

Sin alterar ninguna aserción (RED/GREEN intacto), se corrigió el gate
`pnpm lint` + `pnpm typecheck` del workspace, que fallaba solo en archivos de
test/fixture:

- **Frontend — tipos de Node en el entorno de test.** Los kits/tests usan APIs
  de Node (`node:crypto`, `Buffer`, `node:fs/path/url`) para replicar "el otro
  lado" del esquema y grepear el fuente. Se añadió `frontend/tsconfig.test.json`
  (mismas opciones que `tsconfig.app.json` + `"types": ["node", …]`) que incluye
  `src/**/*.test.ts(x)`, `src/**/__test__/**` y `src/test/**`; se referenció
  desde `tsconfig.json` y se **excluyeron** esos globs de `tsconfig.app.json`
  para no contaminar el build de producción con tipos de Node. `@types/node` ya
  estaba en el paquete frontend. Esto también resolvió los TS7006 (`e` implicit
  any en callbacks de `fs.readdirSync`, ahora tipado como `Dirent`).
- **Backend — `res.body` de Supertest es `any`.** En `crypto.routes.test.ts` se
  añadieron interfaces locales (`PublicKeyBody`, `NamesBody`) y se castea
  `res.body as …` antes de acceder a `.alg`/`.publicKey`/`.iv`/`.ciphertext`/
  `.error`, eliminando los 17 `no-unsafe-member-access`/`no-unsafe-assignment`
  sin cambiar los casos ni las garantías (siguen verificando 200/422/400/500 y
  el round-trip).

Ningún archivo de producción del implementer ni `.claude/settings.json` fue
modificado. Verificado en raíz: `pnpm test` (73 en verde), `pnpm lint`
(0 errores) y `pnpm typecheck` (0 errores).

## Cómo reproducir el rojo

```bash
pnpm --filter @nach/backend exec vitest run \
  src/services/crypto.service.test.ts src/config/env.test.ts src/routes/crypto.routes.test.ts
pnpm --filter @nach/frontend exec vitest run src/crypto/
```

## Notas para el implementer (no bloqueantes)

- El endpoint lee la privada de `env.cryptoPrivateKey` con default; para que los
  tests de 500 funcionen, el service debe **lanzar** (no cachear a nivel de módulo
  una clave inválida de forma que sobreviva al `resetModules`). Cargar la clave
  dentro de la función/petición, no en el top-level del módulo.
- El consecutivo de `POST /names` es un **stub** (número); el test solo exige que
  la vuelta descifre a `/^\d+$/`, no un valor concreto — deja libre a
  `consecutive_counter` la generación real.
- El segundo test de `noSecretInBundle` pasa vacío hoy (no hay módulos que
  grepear); virará a comprobación real en cuanto exista la implementación. El
  test ancla del mismo archivo garantiza el rojo actual.
```
