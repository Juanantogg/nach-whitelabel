# Security audit — consecutive_counter

**Veredicto:** APTO (PASS) — sin hallazgos bloqueantes.

Audita la feature `consecutive_counter` (en GREEN, working tree sin commitear):
fail-fast del entorno (§1 de `docs/seguridad.md`), validación de entrada
(§5) y persistencia del nombre + consecutivo en Mongo. Solo lectura de código;
edición de docs de seguridad y este `progress/`.

## Alcance revisado (archivo:línea)

- `backend/src/config/env.ts:22-42,61-76` — `validateEnv` + schema Zod.
- `backend/src/server.ts:6-25` — bootstrap fail-fast.
- `backend/src/controllers/crypto.controller.ts:13-97` — validación de payload,
  longitud ≤15 y traducción de errores.
- `backend/src/models/record.model.ts`, `counter.model.ts`,
  `backend/src/services/counter.service.ts` — persistencia.
- `backend/package.json` + `pnpm-lock.yaml` — nueva dep `zod`.

## Hallazgos

- **[BAJA] `backend/src/server.ts:11`** — el fail-fast loguea
  `result.error.issues` completo. Verificado empíricamente con zod 4.4.3: para
  las reglas actuales (`.regex` de `MONGODB_URI` y `.refine` de
  `CRYPTO_PRIVATE_KEY`) los `issues` contienen solo `code`/`path`/`message`,
  **nunca el valor de entrada** — no hay fuga de la clave ni de las credenciales
  de Mongo. Observación preventiva: si a futuro se añaden validaciones cuyo issue
  incluya `received`/`input` (algunos formatos de Zod lo traen), loguear el issue
  crudo podría filtrar valores. Remediación (no urgente): loguear solo
  `path` + `message` (p.ej. `issues.map(i => ({ path: i.path, message: i.message }))`).
  No bloqueante: hoy no filtra nada.

- **[INFO / privacidad] `record.model.ts:9-18` + `counter.service.ts:12-24`** —
  se persiste el **nombre en claro** (alias ≤15 que el propio usuario teclea) +
  el consecutivo. Es aceptable para esta prueba: el dato es un alias corto no
  identificador, provisto voluntariamente; el activo crítico (clave privada,
  credenciales Mongo) no se toca. Implicación anotada para `records_list`: esa
  pantalla mostrará estos nombres; su acceptance ya exige "respetar la privacidad
  acordada". Recomendación para cuando se diseñe: acceso restringido y/o no
  exponer más que nombre+consecutivo (ya es el mínimo). No se persiste NINGÚN
  material criptográfico (ni `sessionKey`, ni `iv`, ni `ciphertext`, ni la
  privada) — confirmado: `createRecord` solo escribe `{ sequence, name }`.

## Checklist del modelo de amenazas

### 1. Fail-fast del entorno
- [x] **Valida la clave DE VERDAD**: `env.ts:23-30,41` usa
  `crypto.createPrivateKey(value)` dentro de `loadsAsPem`, no un simple prefijo
  `-----BEGIN`. Una clave con prefijo correcto pero cuerpo corrupto → inválida.
- [x] **Aborta ANTES de aceptar tráfico**: `server.ts:8-12` llama a `validateEnv`
  y hace `process.exit(1)` **antes** de `connectDb()` (línea 14) y de
  `app.listen()` (línea 17). Falla cerrado, nunca abre en estado inseguro.
- [x] **No filtra secretos en logs**: verificado que `ZodError.issues` de las
  reglas actuales no contiene el valor de `CRYPTO_PRIVATE_KEY` ni de
  `MONGODB_URI` (test empírico con zod 4.4.3). Ver hallazgo [BAJA] preventivo.
- [x] **`env.ts` no aborta al importarse** (correcto: `env` cae a `''` para no
  romper tests que importan sin variables — `env.ts:12-18`), pero el proceso real
  sí aborta vía `server.ts`. Separación pura/efecto correcta y testeada
  (`env.validate.test.ts` #12).

### 2. Validación de entrada / falla-cerrado
- [x] **Rechazo >15 sin persistir ni consumir consecutivo**: la comprobación
  `name.length > MAX_NAME_LENGTH` (`crypto.controller.ts:81-84`) ocurre **antes**
  de `createRecord` (línea 89). Test #5 confirma que el service NO se invoca. No
  se gasta número.
- [x] **Techo defensivo previo (256) sustituido sin abrir hueco**: el límite
  ahora es 15 (`MAX_NAME_LENGTH`, línea 14). El `maxlength: 15` del modelo Mongo
  (`record.model.ts:16`) es defensa en profundidad redundante. Sin hueco.
- [x] **Errores no filtran stack/detalle/nombre**: las cuatro respuestas de error
  son códigos genéricos y estables — `invalid_payload` (400), `decryption_failed`
  (422), `crypto_unavailable` (500), `internal_error` (500) y
  `public_key_unavailable` (500). Ningún `catch` reenvía el `err` ni el `name` al
  cliente; el `catch` de descifrado (línea 74) y el de persistencia (línea 90)
  descartan el error. Sin `console.error(err)` con PII en la ruta caliente.

### 3. Datos del usuario en Mongo
- [x] Se persiste nombre en claro + consecutivo; aceptable para la prueba (ver
  hallazgo INFO). Implicación de privacidad anotada para `records_list`.
- [x] **No se persiste material criptográfico**: `createRecord` escribe solo
  `{ sequence, name }`. La `sessionKey` vive solo en memoria para la vuelta
  (`crypto.controller.ts:68-95`), nunca se guarda.

### 4. Claves y secretos
- [x] **Privada solo en env**: `env.cryptoPrivateKey` sale de
  `process.env.CRYPTO_PRIVATE_KEY` (`env.ts:17`); nunca hardcodeada.
- [x] **Sin secretos nuevos en código/tests**: `git grep "BEGIN PRIVATE KEY"`
  solo devuelve placeholders (`.env.example`, en allowlist gitleaks), patrones de
  `.gitleaks.toml`, docs y aserciones de test que verifican la AUSENCIA. El
  `cryptoTestKit.ts` **genera** el par RSA en runtime (`generateKeyPairSync`), no
  hay clave fija.
- [x] **`.env` no trackeado**; `.env.example` solo placeholders.
- [x] **`zod` es la dep esperada**: `zod@4.4.3` en `pnpm-lock.yaml` con integrity
  sha512 desde el registry oficial; sin dependencias transitivas sospechosas (zod
  no tiene deps de runtime). Añadida a `dependencies` (correcto: se usa en runtime
  del boot).
- [x] **Front sin secretos** (`git grep VITE_*SECRET/PRIVATE/KEY frontend/`): la
  única coincidencia es un test guardarraíl que verifica que `VITE_CRYPTO_SECRET`
  NO existe en el bundle.

### 5. Coherencia con docs/seguridad.md
- [x] §1 (fail-fast) y §5 (validación de entrada) movidas de "pendientes ⚠️" a
  "implementado ✅" con evidencia archivo:línea, sin borrar el razonamiento
  histórico (marcado como resuelto, no eliminado).

## Resumen para el gate pre-commit

**APTO.** Sin hallazgos ALTA/MEDIA. Un hallazgo BAJA preventivo (log de
`error.issues` — hoy no filtra nada) y una nota INFO de privacidad para
`records_list`. El fail-fast valida la clave de verdad y aborta antes de aceptar
tráfico; la validación de longitud falla cerrado sin consumir consecutivo; no se
filtran secretos en logs ni respuestas; no se persiste material criptográfico; la
privada sigue solo en env; `zod` es la dep legítima.
