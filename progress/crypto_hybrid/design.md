# Design — crypto_hybrid

## Objetivo

Cumplir el requisito del enunciado: el **nombre** viaja cifrado del front al
back, el back lo descifra; el **número consecutivo** vuelve cifrado y el front lo
descifra y lo muestra. Decisión de arquitectura ya fijada (docs/seguridad.md §2,
no se reabre): **cifrado híbrido asimétrico**. El front cifra con la clave
**pública** del back (Web Crypto API nativa, cero secreto en el bundle); el back
descifra con la **privada** (leída de `env`, PEM, nunca hardcodeada).

Esta feature entrega **solo la mecánica de cifrado y su round-trip** en ambos
sentidos. El consecutivo real (persistido en Mongo) es de `consecutive_counter`;
aquí el endpoint devuelve un **número stub** cifrado para probar la vuelta.

---

## Esquema criptográfico concreto

### Decisión: híbrido RSA-OAEP + AES-256-GCM (mismo esquema en ambos sentidos)

Se evalúan dos vías (detalle en "Alternativas consideradas"). Recomendación:
**híbrido para la ida** y **AES-GCM simétrico de sesión para la vuelta**, con la
clave AES generada por el front y transportada cifrada con RSA. Es el esquema más
simple que resuelve el problema real del round-trip de vuelta.

**El problema de la vuelta.** El back no puede cifrar la respuesta con RSA
"hacia el front" porque el front no tiene clave privada con la que descifrar: RSA
solo cifra público→privado (front→back), no al revés de forma útil. La solución
canónica del cifrado híbrido lo resuelve de un tirón:

1. El **front genera una clave de sesión AES-256-GCM** (aleatoria, por petición,
   con `crypto.subtle.generateKey`).
2. El front **cifra el nombre** con esa clave AES-GCM (confidencialidad +
   integridad en un solo paso).
3. El front **cifra la clave AES** con la **pública RSA-OAEP** del back (RSA solo
   envuelve 32 bytes de clave, no el payload — evita el límite de tamaño de RSA).
4. El back **desenvuelve** la clave AES con su privada RSA, y con ella **descifra
   el nombre**.
5. Para la **vuelta**, el back **reutiliza esa misma clave AES de sesión** (ya la
   tiene en memoria de la petición) para **cifrar el número consecutivo** con
   AES-GCM. El front la tiene también → la descifra. **Sin segundo handshake.**

La clave AES de sesión vive solo durante la petición HTTP; no se persiste ni se
loguea (regla `no-console` / PII).

### Primitivas exactas

| Pieza | Algoritmo | API |
| --- | --- | --- |
| Envoltura de clave (front→back) | RSA-OAEP, SHA-256, clave 2048 bits | Web Crypto (`RSA-OAEP`) / Node `crypto.privateDecrypt` con `RSA_PKCS1_OAEP_PADDING` + `oaepHash: 'sha256'` |
| Cifrado del payload (ambos sentidos) | AES-256-GCM, IV de 12 bytes aleatorio por mensaje, tag de 128 bits | Web Crypto (`AES-GCM`) / Node `crypto.createCipheriv('aes-256-gcm', …)` |
| Codificación en tránsito | **base64** de cada blob binario (clave envuelta, IV, ciphertext+tag) | — |

- **IV distinto por mensaje** (ida y vuelta): dos IV independientes aunque la
  clave AES sea la misma. Reusar IV con la misma clave rompe GCM; el diseño lo
  prohíbe explícitamente.
- **Interop clave RSA:** la pública se sirve en **SPKI/PEM** (`-----BEGIN PUBLIC
  KEY-----`), que Web Crypto importa con `importKey('spki', …)`. La privada en
  `env` es **PKCS#8/PEM** (`-----BEGIN PRIVATE KEY-----`), como ya documenta
  `.env.example`.
- **AES-GCM en Web Crypto** concatena el tag al final del ciphertext; en Node hay
  que separarlo (`getAuthTag`) o usar `setAuthTag`. El contrato transmite
  `ciphertext` como el blob de Web Crypto (ct+tag juntos): el back parte los
  últimos 16 bytes como tag. Se documenta como detalle de implementación.

---

## Contrato de la API front↔back

### 1. `GET /crypto/public-key`

Devuelve la clave pública del back para que el front cifre.

**Response 200:**
```json
{ "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBI...\n-----END PUBLIC KEY-----\n", "alg": "RSA-OAEP-256" }
```
- `publicKey`: PEM SPKI. No es secreto (docs/seguridad.md §"la pública puede ser visible").
- `alg`: identificador informativo del esquema, para que el front valide compatibilidad.

**Response 500:** `{ "error": "public_key_unavailable" }` si el back no puede
derivar la pública desde la privada de `env` (clave ausente/inválida).

### 2. `POST /names`

Recibe el nombre cifrado, lo descifra, genera un consecutivo (**stub** en esta
feature) y lo devuelve cifrado con la misma clave de sesión.

**Request body:**
```json
{
  "encryptedKey": "<base64>",   // clave AES-256 de sesión, envuelta con RSA-OAEP
  "iv": "<base64>",             // IV de 12 bytes usado para cifrar el nombre
  "ciphertext": "<base64>"      // nombre cifrado con AES-GCM (ct + tag)
}
```

**Response 200:**
```json
{
  "iv": "<base64>",             // IV NUEVO (distinto del de ida) para la vuelta
  "ciphertext": "<base64>"      // número consecutivo cifrado con AES-GCM (ct + tag)
}
```
El front descifra `ciphertext` con la clave AES que él mismo generó (no reenvía
`encryptedKey` en la respuesta: el front ya la posee).

**Códigos de error:**
| Código | `error` | Cuándo |
| --- | --- | --- |
| 400 | `invalid_payload` | Falta un campo, no es base64, o el nombre descifrado excede el límite / no es texto válido |
| 422 | `decryption_failed` | RSA no desenvuelve la clave, o el tag GCM no valida (payload manipulado) |
| 500 | `crypto_unavailable` | La privada de `env` es inválida/ausente al procesar |

- No se filtra detalle criptográfico en el error (nada de stack, ni el valor
  descifrado). Mensaje genérico + código.
- El contrato del cuerpo descifrado del nombre en esta feature es **texto plano
  UTF-8** (el nombre). El límite de 15 caracteres es de `welcome_screen`; aquí el
  back solo valida un techo defensivo de tamaño (p.ej. ≤ 256 bytes) para no
  procesar payloads absurdos, y se documenta como validación de entrada mínima.

---

## Módulos y firmas

### Backend

**`config/env.ts` (corrección obligatoria).** Quitar `cryptoSecret` (esquema
simétrico viejo) y añadir la privada PEM:
```ts
export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongodbUri: process.env.MONGODB_URI ?? '',
  cryptoPrivateKey: process.env.CRYPTO_PRIVATE_KEY ?? '',
} as const;
```
> Scope: la validación **fail-fast con Zod** (docs/seguridad.md §1) NO entra en
> esta feature — queda como pendiente propio (env hardening). Aquí solo se
> renombra el campo para reflejar el esquema asimétrico. El `crypto.service`
> valida que la clave carga (createPrivateKey) y falla con `crypto_unavailable`
> si no; eso cubre el riesgo funcional inmediato sin adelantar el Zod-boot.

**`services/crypto.service.ts`** — lógica pura de cifrado, sin Express. Firmas:
```ts
/** Deriva la pública SPKI/PEM desde la privada PKCS#8 de env. Lanza si la clave es inválida. */
export function getPublicKeyPem(privatePem?: string): string;

/** Desenvuelve la clave AES (RSA-OAEP) y descifra el nombre (AES-GCM). Devuelve texto UTF-8. */
export function decryptName(payload: EncryptedPayload, privatePem?: string): string;

/** Cifra un valor (el consecutivo) con AES-GCM usando la clave de sesión desenvuelta. */
export function encryptForClient(plaintext: string, sessionKey: Buffer): CipherEnvelope;

/** Variante que expone la clave de sesión desenvuelta, para reusarla en la vuelta. */
export function unwrapSessionKey(encryptedKeyB64: string, privatePem?: string): Buffer;

interface EncryptedPayload { encryptedKey: string; iv: string; ciphertext: string; } // base64
interface CipherEnvelope { iv: string; ciphertext: string; } // base64
```
- `privatePem` opcional con default `env.cryptoPrivateKey`, para inyectarlo en
  tests (par de claves de test generado en el propio test, sin tocar `.env`).
- Usa solo el módulo `crypto` nativo de Node. Cero dependencias nuevas.

**`controllers/crypto.controller.ts`**:
```ts
export function getPublicKey(req: Request, res: Response): void;   // GET /crypto/public-key
export function postName(req: Request, res: Response): void;       // POST /names
```
`postName` orquesta: `unwrapSessionKey` → `decryptName` → genera consecutivo
**stub** (ver Scope) → `encryptForClient` con la misma clave → responde. Traduce
excepciones del service a los códigos 400/422/500.

**`routes/crypto.routes.ts`**:
```ts
export const cryptoRouter = Router();
cryptoRouter.get('/public-key', getPublicKey);
```
Nota de montaje en `app.ts`: `app.use('/crypto', cryptoRouter)` y la ruta de
`POST /names` puede vivir en un `names.routes.ts` montado en `/names` (o el
mismo router; decisión menor del implementer). Mantener el patrón
`routes → controllers → services` ya establecido por health.

### Frontend

Nuevo módulo `frontend/src/crypto/`. Solo Web Crypto API nativa, cero libs.

**`crypto/encryptName.ts`**:
```ts
/** Genera clave AES de sesión, cifra el nombre, envuelve la clave con la pública RSA. */
export async function encryptName(
  name: string,
  publicKeyPem: string,
): Promise<{ payload: EncryptedPayload; sessionKey: CryptoKey }>;
```
Devuelve también la `sessionKey` (no exportable fuera del módulo salvo lo
necesario) para descifrar la respuesta. `EncryptedPayload` = los tres campos
base64 del request.

**`crypto/decryptNumber.ts`**:
```ts
/** Descifra la respuesta del back (AES-GCM) con la clave de sesión. Devuelve el número como string. */
export async function decryptNumber(
  envelope: { iv: string; ciphertext: string },
  sessionKey: CryptoKey,
): Promise<string>;
```

**`crypto/fetchPublicKey.ts`**:
```ts
/** GET /crypto/public-key; devuelve el PEM. fetchFn/apiUrl inyectables para tests. */
export async function fetchPublicKey(
  deps?: { fetchFn?: typeof fetch; apiUrl?: string },
): Promise<string>;
```
Sigue el patrón de `loadBrand` (deps con `fetchFn` mockeable, `apiUrl` desde
`VITE_API_URL`). No cachea aquí; el cacheo, si hace falta, es de
`welcome_screen`.

**`crypto/base64.ts`** (helper interno): `ArrayBuffer ↔ base64` con `btoa`/`atob`
o `Uint8Array`. Mínimo, solo si no hay ya un util equivalente en el repo (no lo
hay). Reutilizable por encrypt/decrypt.

> Reparto con `welcome_screen`: esta feature NO monta UI ni el `fetch` de
> `POST /names` desde un componente. Expone las funciones puras; el orquestador
> (encrypt → POST → decrypt) es de `welcome_screen`. Aquí se puede testear el
> round-trip a nivel de funciones + Supertest sin React.

---

## Qué se testea (RED)

### Backend (Vitest + Supertest sobre `createApp()`)

1. **`GET /crypto/public-key` responde 200 con un PEM SPKI válido** (`publicKey`
   empieza por `-----BEGIN PUBLIC KEY-----`) y `alg: 'RSA-OAEP-256'`.
2. **Round-trip de ida (service puro):** dado un par RSA de test, cifrar un
   nombre con el esquema del front (o un helper de test que replica Web Crypto) →
   `decryptName` devuelve **exactamente** el nombre original.
3. **Round-trip de vuelta (service puro):** `encryptForClient(numero, sessionKey)`
   → descifrar con la misma clave AES → recupera el número. IV de vuelta ≠ IV de
   ida.
4. **`POST /names` end-to-end (Supertest):** enviar payload cifrado con la
   pública que sirve `GET /crypto/public-key` → 200 con `{ iv, ciphertext }`;
   descifrando la respuesta con la clave de sesión del test sale el consecutivo
   stub. (Cierra el round-trip completo sobre HTTP.)
5. **`POST /names` con tag GCM manipulado → 422 `decryption_failed`** (integridad:
   alterar un byte del `ciphertext` hace fallar la verificación del tag).
6. **`POST /names` con `encryptedKey` no descifrable por la privada → 422**
   (clave envuelta con otra pública).
7. **Payload incompleto / no base64 → 400 `invalid_payload`.**
8. **La privada se lee de `env`/parámetro, nunca hardcodeada:** el service
   funciona con la clave inyectada por el test; con clave ausente/ inválida
   lanza→ el endpoint responde 500 `crypto_unavailable`. (Verifica que no hay una
   clave literal en el módulo.)
9. **`env.ts` ya NO expone `cryptoSecret`** y sí `cryptoPrivateKey` (test simple
   de forma del objeto `env`, o typecheck).

### Frontend (Vitest + Web Crypto de jsdom/node)

10. **`encryptName` produce los tres campos base64** (`encryptedKey`, `iv`,
    `ciphertext`) y una `sessionKey` de tipo AES-GCM 256.
11. **Round-trip front↔"back" simulado:** cifrar con `encryptName` usando una
    pública de test, desenvolver+descifrar en el test con la privada de test →
    recupera el nombre. (Espejo del test 2, del lado del front.)
12. **`decryptNumber` descifra un sobre AES-GCM** producido con la clave de
    sesión → devuelve el número correcto.
13. **`fetchPublicKey` hace GET a `${apiUrl}/crypto/public-key`** (fetch mockeado)
    y devuelve el PEM; propaga error si `!res.ok`.
14. **Cero secreto en el bundle:** test/aserción de que ningún módulo de
    `src/crypto/` exporta ni contiene una clave privada ni un secreto simétrico
    fijo (grep del build o del fuente por `PRIVATE KEY` / `VITE_CRYPTO_SECRET`).
    La clave AES es generada en runtime por petición, nunca estática.

> El tester puede escribir un pequeño helper de test compartido que genere un par
> RSA (`crypto.generateKeyPairSync` en Node) e implemente el "otro lado" del
> esquema, para no depender de red ni de `.env` reales.

---

## Alternativas consideradas

### A) RSA-OAEP directo sobre el nombre (sin AES)
El front cifra el nombre entero con la pública RSA; el back descifra con la
privada. Simple para la **ida**.
- Contras: **no resuelve la vuelta** (el back no tiene con qué cifrar hacia el
  front); RSA-2048 solo cifra ~190 bytes (suficiente para un nombre, pero es un
  parche que no escala); habría que inventar un segundo mecanismo para la
  respuesta. Descartado por dejar la vuelta sin resolver.

### B) Híbrido RSA-OAEP + AES-GCM con clave de sesión reutilizada (RECOMENDADO)
El descrito arriba. La clave AES generada por el front sirve para la ida y la
vuelta; RSA solo la transporta.
- Pros: resuelve **ida y vuelta con un solo handshake**; patrón estándar (es lo
  que hace TLS conceptualmente); GCM da integridad; solo primitivas nativas.
- Contras: un poco más de fontanería (envolver/desenvolver clave, dos IV). Es
  complejidad esencial, no accidental.

### C) ECDH (P-256) + HKDF + AES-GCM
Handshake Diffie-Hellman efímero, clave derivada compartida.
- Pros: forward secrecy real, sobres más pequeños.
- Contras: más piezas (HKDF, gestión de la efímera del back), mayor superficie de
  test para una prueba técnica. Sobredimensionado para el requisito. Descartado
  por minimalismo (no lo pide el enunciado).

---

## Recomendación

**Opción B: híbrido RSA-OAEP-256 (envoltura de clave) + AES-256-GCM (payload),
con la clave de sesión AES generada por el front y reutilizada por el back para
la respuesta.** Es el mínimo correcto que cierra el round-trip en ambos sentidos,
con solo Web Crypto (front) y `node:crypto` (back), cero dependencias nuevas y
cero secreto en el bundle. Se concilia con el researcher antes de RED.

---

## Límites de scope (qué NO entra)

- **Consecutivo real:** el número que devuelve `POST /names` es un **stub**
  (p.ej. constante `1` o un contador en memoria del proceso, no persistido). La
  generación real con Mongo/Mongoose sin colisiones es de `consecutive_counter`
  (depende de esta). Aquí el stub solo sirve para probar el **round-trip de
  vuelta**. Documentar el stub como tal en el código.
- **UI / orquestación en componente:** esta feature expone funciones puras y los
  endpoints; el flujo `encrypt → POST → decrypt` desde un componente React, los
  estados de carga/error y el contador de 15 caracteres son de `welcome_screen`.
- **Validación fail-fast del entorno con Zod** (docs/seguridad.md §1): fuera de
  scope; aquí solo se renombra `cryptoSecret → cryptoPrivateKey` en `env.ts`. El
  hardening Zod-boot es pendiente propio.
- **CORS / helmet / rate-limit / validación de entrada avanzada**
  (docs/seguridad.md §3-5): no entran; el back solo aplica un techo defensivo de
  tamaño del nombre descifrado. CORS es necesario para el flujo real front↔back
  pero pertenece al cableado de `welcome_screen`/`deploy`.
- **Persistencia del nombre (PII) en BD:** no se guarda nada aquí; el nombre se
  descifra en memoria y se descarta. Persistir el par nombre+consecutivo es de
  `consecutive_counter`/`records_list`.
