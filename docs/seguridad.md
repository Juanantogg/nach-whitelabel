# Seguridad — nach-whitelabel

Documento de seguridad del proyecto. La app captura el nombre del usuario, lo
envía **cifrado** al backend, que lo descifra, genera un consecutivo y lo devuelve
**cifrado**. El activo crítico es la **clave privada de descifrado** del backend y
las **credenciales de MongoDB**.

Contexto: prueba técnica para Grupo Salinas (Banco Azteca / Elektra), donde la
seguridad es prioridad. Este doc recoge lo ya implementado y los pendientes.

## Activos a proteger

| Activo | Dónde vive | Riesgo si se filtra |
| --- | --- | --- |
| Clave **privada** RSA/ECDH | `.env` (back), **nunca** sale del servidor | Descifrado de todo el tráfico |
| `MONGODB_URI` (credenciales) | `.env` (back) | Acceso directo a la base de datos |
| Nombre del usuario (PII) | En tránsito y en BD | Exposición de datos personales |

> La clave **pública** no es un activo a proteger: por diseño puede ser visible.
> El front cifra con ella; solo la privada (en el servidor) descifra.

## Implementado ✅

### Gestión de secretos

- **`.env` fuera de git** — `.gitignore` cubre `.env`, `.env.local`,
  `.env.*.local`. Solo se versiona `.env.example` con placeholders. Verificado:
  no hay ningún `.env` real trackeado.
- **Config por variables de entorno** — nada de claves hardcodeadas en código
  (convención reforzada por la regla ESLint y por gitleaks).

### Detección de secretos (gitleaks)

Defensa en profundidad: **prevención** (`.gitignore`) + **detección** (gitleaks),
que además cubre el caso que `.gitignore` no puede — un secreto hardcodeado
directamente en un archivo de código.

- **`.gitleaks.toml`** — extiende las reglas por defecto (AWS, GitHub, claves
  privadas…) y añade dos propias del proyecto:
  - `nach-crypto-secret` — clave de cifrado hex inline (`crypto_secret` /
    `crypto_key` con hex ≥ 32); red por si se reintrodujera una clave simétrica.
    La clave **privada** PEM la detectan las reglas por defecto de gitleaks.
  - `nach-mongodb-uri` — cadena `mongodb(+srv)://user:pass@…` con credenciales.
  - **Allowlist** para los placeholders del `.env.example` (evita falsos
    positivos).
- **Pre-commit** (`.husky/pre-commit`) — corre gitleaks vía Docker
  (`git --pre-commit --staged`) sobre lo staged y **aborta el commit** si detecta
  un secreto. Si Docker no está disponible, avisa sin bloquear (el CI es la red
  dura).
- **CI** (`.github/workflows/ci.yml`) — job `secret-scan` con la action oficial
  `gitleaks/gitleaks-action@v2` y `fetch-depth: 0` para escanear **todo el
  historial** del push/PR.

**Verificado** con gitleaks v8.30.1 (exit codes reales):

| Escenario | Exit | Resultado |
| --- | --- | --- |
| `CRYPTO_SECRET` hex real staged | 1 | Commit abortado ✅ |
| `.env.example` con placeholders | 0 | Pasa (allowlist) ✅ |
| Repo limpio | 0 | Pasa ✅ |

> Nota de mantenimiento: gitleaks v8.30 estrenó CLI nueva (`git` / `dir` /
> `stdin`). Los comandos `detect` / `protect` de tutoriales antiguos están
> **obsoletos**; el hook usa `git --pre-commit --staged`.

### Higiene de código

- **`no-console`** (ESLint, permite `warn`/`error`/`info`) — evita filtrar datos
  por `console.log` de depuración. Relevante para PII: un log accidental del
  nombre o de un buffer descifrado no llega a producción.
- **Lint type-aware** (`recommendedTypeChecked`) — `no-floating-promises` y
  `no-unsafe-*` reducen bugs en la lógica async de cifrado.

## Óptica de seguridad de los pendientes ⚠️

> **Fuentes de verdad.** El *qué hacer* y su orden viven en `feature_list.json`
> (features `backend_hardening` / `frontend_infra` y la validación de entorno en
> `consecutive_counter`). Este documento **no repite el backlog**: aporta el *por
> qué* y las reglas de seguridad que cada feature debe respetar. Si el qué y el
> por qué discrepan, el JSON manda en el qué; este doc en el razonamiento.

### 1. Validación fail-fast del entorno · Prioridad ALTA

→ Backlog: acceptance de **`consecutive_counter`** en `feature_list.json`.

**Riesgo de seguridad (el por qué):** `backend/src/config/env.ts` deja las
variables críticas en `''` por defecto, así que el servidor **arranca igual** con
una `CRYPTO_PRIVATE_KEY` vacía o inválida. Eso no es solo falta de robustez: es el
escenario silencioso de "cifrado activado pero clave inválida", que puede degradar
a un estado sin cifrado efectivo **sin que nadie lo note**. Por eso la validación
debe cargar realmente la clave (no solo mirar que no esté vacía) y **fallar
cerrado** (exit ≠ 0), nunca abrir.

**Reglas de validación que la implementación debe cumplir** (tras la decisión de
cifrado asimétrico):

  | Variable | Regla de validación |
  | --- | --- |
  | `CRYPTO_PRIVATE_KEY` | No vacía y con formato PEM (`-----BEGIN PRIVATE KEY-----`). Idealmente intentar cargarla con `crypto.createPrivateKey` y fallar si lanza. |
  | `MONGODB_URI` | No vacía; empieza por `mongodb://` o `mongodb+srv://`. |
  | `PORT` | Entero válido; default 3001. |
  | `NODE_ENV` | `development` \| `production` \| `test`; default `development`. |

### 2. Esquema de cifrado — decisión de arquitectura · Prioridad ALTA

El enunciado pide que el backend **reciba el nombre ya cifrado**, lo descifre,
genere el consecutivo y **devuelva el resultado cifrado**. Es decir: el cifrado
ocurre en el cliente. La pregunta de diseño no es *si* ciframos en el front (hay
que hacerlo), sino **con qué esquema de claves**.

**Decisión: cifrado híbrido asimétrico (RSA-OAEP / ECDH + AES-GCM). NO clave
simétrica compartida con el front.**

Razonamiento:

- Con **clave simétrica** (un `VITE_CRYPTO_SECRET` en el front), la misma clave
  cifra y descifra, así que **tendría que viajar al navegador** — y todo lo que se
  expone con prefijo `VITE_` acaba en el bundle JS, visible en DevTools. Deja de
  ser secreta. **Descartado.**
- Con **cifrado asimétrico** hay dos claves: el front cifra con la **pública** del
  backend (puede ser visible, no importa) y **solo** el backend descifra con su
  **privada**, que nunca sale del servidor. El front cifra **sin poseer ningún
  secreto** — el mismo principio que TLS/HTTPS.

Flujo previsto:

1. `GET /crypto/public-key` — el front obtiene la clave pública del backend.
2. El front cifra el nombre (**Web Crypto API** nativa, sin librerías): RSA-OAEP,
   o ECDH para derivar una clave de sesión + **AES-256-GCM** para el payload
   (híbrido; GCM aporta confidencialidad **e** integridad).
3. `POST /names` con el payload cifrado → el backend descifra con la **privada**,
   genera el consecutivo.
4. La respuesta viaja cifrada de vuelta (clave de sesión AES-GCM establecida en el
   handshake, o esquema equivalente) y el front la descifra.

Ventajas para la evaluación:

- Cumple el enunciado al pie de la letra (el back recibe cifrado; el front cifra y
  descifra) **sin** exponer ningún secreto en el cliente.
- Usa primitivas nativas (Web Crypto + módulo `crypto` de Node), sin dependencias.
- Es una decisión de arquitectura defendible y documentable en el README, que el
  enunciado puntúa explícitamente ("buenas prácticas", "explicación de
  decisiones").

> Implicación práctica (**ya aplicada**): se eliminó `VITE_CRYPTO_SECRET` del
> `.env.example` y de `CLAUDE.md`; el front no lleva ningún secreto. El backend
> guarda solo su clave **privada** (`CRYPTO_PRIVATE_KEY`) en `.env`. La regla
> gitleaks se ajustó al nuevo esquema (la clave privada la detectan las reglas por
> defecto). El cifrado en sí ya está implementado (feature `crypto_hybrid`,
> `status: done`).

#### ¿Por qué la clave pública puede cifrar pero no descifrar?

La clave pública y la privada son dos números **emparejados matemáticamente**. El
esquema se apoya en una *función trampa*: una operación fácil de hacer en un
sentido e inviable de deshacer sin una pieza secreta.

En **RSA**, esa operación es multiplicar primos:

- Se eligen dos primos grandes `p` y `q`. Multiplicar `n = p × q` es instantáneo.
- El proceso inverso —dado solo `n`, recuperar `p` y `q` (**factorización**)— no
  tiene algoritmo eficiente conocido.

La clave **pública** contiene `n`; cifrar solo usa `n`, por eso basta la pública
para cifrar. Pero **descifrar requiere conocer los factores** `p` y `q`, que la
pública no revela. Con un `n` de 2048 bits, factorizarlo llevaría más tiempo que
la edad del universo con todo el cómputo disponible. Por eso publicar la clave
pública no compromete nada: es el mismo modelo que usa TLS/HTTPS.

Matices (seguridad = **computacional**, no absoluta):

- La respuesta *existe* (los factores existen); solo que encontrarla es inviable
  en la práctica. Toda la cripto moderna se basa en esta asimetría de dificultad.
- **El tamaño importa:** RSA-2048 es el mínimo recomendado hoy (RSA-512 ya se
  rompió). Por eso el `.env.example` genera claves de 2048 bits.
- Las computadoras cuánticas (algoritmo de Shor) amenazan a RSA/ECC a futuro → de
  ahí la criptografía post-cuántica. Irrelevante para esta prueba, pero es el
  contexto completo.

#### De la prueba a producción (decisiones y sus límites)

Varias decisiones de esta feature son **correctas también en producción**; otras
son **atajos deliberados de alcance** para la prueba. Distinguirlos es parte de la
defensa técnica del ejercicio.

**Se mantienen igual en un producto real:**

- Esquema híbrido RSA-OAEP + AES-GCM (patrón estándar TLS/JWE).
- Clave privada solo en el servidor; el front no lleva ningún secreto.
- AES-256-GCM (integridad autenticada), `oaepHash` SHA-256, IV aleatorio de 12
  bytes sin reuse del par (clave, IV).
- base64 estándar, claves SPKI/PKCS#8.

**Atajos de "esta prueba" que cambiarían en un producto:**

| # | Aquí (prueba) | En producción | Por qué el atajo es aceptable |
| --- | --- | --- | --- |
| 1 | Cifrado de aplicación sobre HTTP (ciframos el nombre a mano) | El transporte lo da TLS/HTTPS; el cifrado app-level solo se justifica para **E2E encryption** (el servidor no ve el dato) o **cifrado en reposo** | El **enunciado exige** cifrar en el cliente; sin ese requisito sería redundante con TLS |
| 2 | Misma clave AES para ida y vuelta | Handshake **ECDH efímero** → *forward secrecy* (comprometer la privada no descifra tráfico pasado) | ECDH añade HKDF y gestión de efímeras; descartado por minimalismo (no lo pide el enunciado) |
| 3 | RSA-2048 | RSA-3072/4096 o migración a ECC, y plan **post-cuántico** | 2048 es el mínimo aceptable hoy; suficiente para demostrar el esquema |
| 4 | Consecutivo = stub en memoria | Contador persistido, atómico, sin colisiones | Reparto de features (`consecutive_counter`); el stub solo prueba el round-trip de vuelta |
| 5 | Clave privada en variable de entorno | **KMS / Secrets Manager / HSM** con rotación; nunca en texto plano en el entorno | Env var es lo razonable para la prueba |
| 6 | Sin rotación de claves | Rotación periódica + versionado (`alg`/`kid` en la respuesta ya deja hueco) | Fuera de alcance temporal |
| 7 | `env.ts` cae a `''` y falla en runtime | **Fail-fast con Zod al boot** (ver §1) | Diferido; falla-cerrado con 500, no degrada a inseguro |
| 8 | Sin CORS/helmet/rate-limit | Obligatorios | Diferidos a `welcome_screen`/`deploy` (ver §3-5) |
| 9 | `GET /crypto/public-key` sin caché/pinning | Cache-control y posible *key pinning* anti-MITM | El MITM real lo cubre TLS; el pinning es defensa en profundidad |

> El punto de fondo (fila 1): en un producto la pregunta honesta es *"¿por qué
> cifrar a mano si ya hay HTTPS?"*. La respuesta legítima es **E2E/zero-knowledge**
> o **cifrado en reposo**. Aquí se hace porque el enunciado lo pide como ejercicio,
> y se implementa correctamente.

### 3. Cabeceras y CORS · Prioridad ALTA (cors) / MEDIA (helmet)

→ Backlog: acceptance de **`backend_hardening`** en `feature_list.json`.

**Reglas de seguridad que la implementación debe respetar (el por qué):**

- **`cors`** debe restringirse a una **allowlist de orígenes** leída de config
  (`env.ts`), **nunca** `origin: '*'`. Encaja con el enfoque white-label: cada
  marca/entorno se despliega en un dominio distinto, así que los orígenes
  permitidos son configurables, no literales en el código. Métodos acotados
  (`GET`, `POST`); `credentials` solo si se usan cookies (por ahora no).
- En Express 5 el **orden importa**: `cors` y `helmet` van **antes** de las rutas.
- **`helmet`** aporta las cabeceras base (HSTS, `X-Content-Type-Options: nosniff`,
  etc.).

### 4. Rate limiting · Prioridad MEDIA

→ Backlog: opcional dentro de **`backend_hardening`**.

**Por qué:** `express-rate-limit` en el endpoint de escritura mitiga abuso y
fuerza bruta. Es defensa en profundidad, no crítico para la prueba.

### 5. Validación de entrada · Prioridad MEDIA

→ Backlog: acceptance del endpoint de escritura en **`consecutive_counter`**.

**Por qué:** validar y acotar el payload (longitud del nombre ≤ 15 como en las
maquetas, tipo) **antes** de descifrar/procesar evita payloads maliciosos y
errores no controlados. Falla-cerrado: rechazar con 400, no intentar descifrar
basura.

## Checklist rápido

Garantías de seguridad **ya en su sitio** (lo pendiente vive en `feature_list.json`,
ver punteros §1 y §3-5):

- [x] `.env` en `.gitignore`, sin secretos trackeados
- [x] gitleaks en pre-commit + CI
- [x] `no-console` para no filtrar PII por logs
- [x] Esquema de cifrado decidido: híbrido asimétrico (sin secreto en el front)
- [x] `VITE_CRYPTO_SECRET` eliminado de `.env.example` y `CLAUDE.md`
- [x] Cifrado híbrido implementado (clave pública en front, privada solo en back) — `crypto_hybrid` done

Pendientes con óptica de seguridad (**el qué en el backlog**):

- Validación fail-fast del entorno con Zod → `consecutive_counter`
- `cors` restringido + `helmet` → `backend_hardening`
- Rate limiting en escritura (opcional) → `backend_hardening`
- Validación de payload de entrada → `consecutive_counter`
