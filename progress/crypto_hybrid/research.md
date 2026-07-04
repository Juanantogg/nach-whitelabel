# Research — crypto_hybrid

> Verificación de APIs y mejores prácticas (2025/2026) para implementar el
> cifrado híbrido asimétrico front↔back. La **decisión de arquitectura**
> (híbrido asimétrico, front cifra con la pública, back descifra con la privada)
> está tomada en `docs/seguridad.md §2` y **no se reabre**. Aquí se resuelve el
> *cómo* concreto: esquema, APIs exactas, formato de transporte y gotchas.
> Sin código de producción; los fragmentos son ilustrativos (firmas).

## Preguntas

1. Para la **ida** (front→back): ¿RSA-OAEP directo del payload o híbrido real
   (RSA-OAEP envuelve una clave AES-256-GCM que cifra el payload)?
2. Para la **vuelta** (back→front): el front no tiene privada. ¿Cómo cifra el
   back la respuesta de forma que el front la descifre, con el esquema más
   simple y correcto?
3. Firmas EXACTAS de las APIs: `crypto.subtle` en el front, módulo `crypto` de
   Node en el back.
4. Formato de transporte JSON: qué campos, qué encoding.
5. Gotchas: reuse de IV, authTag en GCM (interop Web Crypto ↔ Node), PEM
   SPKI/PKCS8, base64 vs base64url, tamaño RSA.

---

## Hallazgos

### 1. Ida: híbrido real (RSA-OAEP envuelve AES-256-GCM), no RSA directo

- **Límite de RSA-OAEP**: con RSA-2048 y SHA-256 el máximo de texto plano es
  `k − 2·hLen − 2 = 256 − 64 − 2 = 190 bytes`. El nombre (≤15 chars ≈ ≤60 bytes
  UTF-8) **cabría** en RSA directo, PERO:
  Fuente: [Chilkat / RFC 8017 PKCS#1](https://cknotes.com/rsa-encryption-maximum-number-of-bytes/),
  [PyCryptodome OAEP](https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html).
- **RSA-OAEP no aporta integridad autenticada** (no hay tag). AES-GCM sí:
  confidencialidad **e** integridad en una operación (detecta manipulación del
  ciphertext). Fuente: [MDN SubtleCrypto.encrypt](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt).
- **Por qué híbrido y no RSA directo aunque el nombre quepa**: el híbrido es el
  patrón estándar (mismo modelo que TLS/JWE), reutiliza la MISMA clave de sesión
  AES para cifrar la **vuelta** (resuelve la pregunta 2 sin un segundo par de
  claves), y no queda atado al límite de 190 bytes si el payload crece. Es la
  decisión defendible en el README.

### 2. Vuelta: reutilizar la clave AES de sesión (opción b)

De las tres opciones planteadas, la **(b)** es la más simple y correcta para
esta prueba:

- El front **genera** una clave AES-256-GCM de sesión (`generateKey`).
- Cifra el nombre con esa clave AES (GCM) → `ciphertext + iv + tag`.
- **Envuelve** (encripta) la clave AES con la **pública RSA** del back
  (RSA-OAEP) → `encryptedKey`.
- El back: `privateDecrypt` para recuperar la clave AES; `createDecipheriv` para
  descifrar el nombre. Genera el consecutivo y **responde cifrando con la MISMA
  clave AES** (nuevo IV) → el front descifra con la clave que ya tiene en memoria.

Ventajas frente a las alternativas:
- **(a)** front genera su propio par RSA y manda su pública: más handshake, más
  código, sin ventaja aquí.
- **(c)** ECDH: elegante pero más piezas (derivación HKDF, coordinación de
  curvas). Overkill para una prueba; la clave AES envuelta con RSA-OAEP cumple.

> Regla dura de la vuelta: **IV distinto** para la respuesta (nunca reutilizar el
> IV de la ida con la misma clave AES — ver gotcha 5.1). La clave AES sí se
> reutiliza; el IV NO.

### 3. APIs exactas

#### Front — Web Crypto (`crypto.subtle`), todo async/Promise

Fuentes: [MDN importKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey),
[MDN exportKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/exportKey),
[MDN encrypt](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt).

- Importar la pública RSA del back (viene en SPKI DER, derivado de PEM):
  ```
  crypto.subtle.importKey(
    "spki", spkiDerArrayBuffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false, ["encrypt"])
  ```
- Generar la clave AES de sesión:
  ```
  crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, ["encrypt", "decrypt"])   // extractable:true para poder envolverla
  ```
- Cifrar el nombre con AES-GCM (IV de 12 bytes aleatorio):
  ```
  const iv = crypto.getRandomValues(new Uint8Array(12));
  crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, utf8Bytes)
  // -> ArrayBuffer = ciphertext || authTag(16 bytes) CONCATENADOS (ver gotcha 5.2)
  ```
- Envolver la clave AES con la pública RSA. Dos formas equivalentes:
  - exportar raw + `encrypt`:
    ```
    const rawAes = await crypto.subtle.exportKey("raw", aesKey); // 32 bytes
    crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaPublicKey, rawAes)
    ```
  - o `crypto.subtle.wrapKey("raw", aesKey, rsaPublicKey, { name: "RSA-OAEP" })`
    (equivalente; `encrypt` sobre el raw es más explícito y fácil de testear).
- Descifrar la vuelta (mismo `aesKey`, IV de la respuesta):
  ```
  crypto.subtle.decrypt({ name: "AES-GCM", iv: ivResp }, aesKey, respBytes)
  ```

#### Back — Node `crypto` (síncrono con Buffers)

Fuente: [Node.js Crypto docs](https://nodejs.org/api/crypto.html).

- Cargar claves PEM:
  ```
  const pub  = crypto.createPublicKey(pemSpkiString);    // PEM 'spki'
  const priv = crypto.createPrivateKey(pemPkcs8String);  // PEM 'pkcs8'
  ```
  Servir la pública al front en DER SPKI:
  `pub.export({ type: "spki", format: "der" })` (o PEM y que el front lo
  des-armorice a DER; ver gotcha 5.3).
- Desenvolver la clave AES (RSA-OAEP + SHA-256):
  ```
  crypto.privateDecrypt(
    { key: priv,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256" },
    encryptedKeyBuffer)                 // -> Buffer de 32 bytes (la clave AES)
  ```
  > `oaepHash: "sha256"` es OBLIGATORIO. Sin él Node usa SHA-1 por defecto y
  > NO interopera con Web Crypto (que usó SHA-256). Ver gotcha 5.4.
- Descifrar el nombre (AES-256-GCM). Node maneja el authTag SEPARADO:
  ```
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv); // iv 12 bytes
  decipher.setAuthTag(authTag);          // 16 bytes, ANTES de final()
  const name = Buffer.concat([decipher.update(ciphertext), decipher.final()])
                     .toString("utf8"); // final() lanza si el tag no valida
  ```
- Cifrar la vuelta (consecutivo) con la MISMA clave AES, IV NUEVO:
  ```
  const ivResp = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, ivResp);
  const ct = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();       // 16 bytes, DESPUÉS de final()
  ```
  Para que el front (Web Crypto) lo descifre, enviar `ct || tag` concatenados
  (ver gotcha 5.2).

### 4. Formato de transporte (JSON + base64)

Los bytes NO son JSON-safe → **base64** (estándar, no base64url; ver gotcha 5.5).

Request `POST /names` (ida):
```
{
  "encryptedKey": "<base64>",   // clave AES envuelta con RSA-OAEP (256 bytes -> b64)
  "iv":           "<base64>",   // 12 bytes del nombre
  "ciphertext":   "<base64>"    // AES-GCM: ct || authTag (16 bytes al final)
}
```
Response (vuelta), cifrada con la misma clave AES:
```
{
  "iv":         "<base64>",     // 12 bytes NUEVOS de la respuesta
  "ciphertext": "<base64>"      // AES-GCM: ct || authTag; sin encryptedKey (ya la tiene el front)
}
```

Decisión de contrato del `ciphertext`: adoptar la convención de **Web Crypto**
(tag concatenado al final del ciphertext) en AMBOS sentidos y en AMBOS lados. El
back separa/une los 16 últimos bytes al hablar con Node `crypto`. Alternativa:
un campo `authTag` explícito — más verboso, elige el designer, pero la
concatenación evita un campo y es lo que ya produce Web Crypto de forma natural.

Encoding de texto: nombre y payload en **UTF-8** (`TextEncoder`/`TextDecoder` en
front; `"utf8"` en Node).

### 5. Gotchas / errores comunes

**5.1 Reuse de IV (nonce) en GCM — crítico.** Reutilizar el par (clave, IV) en
GCM rompe la seguridad por completo. Generar IV **aleatorio de 12 bytes por cada
operación** (`crypto.getRandomValues` / `crypto.randomBytes`). La vuelta usa la
misma clave AES que la ida → OBLIGA a IV distinto en la respuesta. 96 bits (12
bytes) es el estándar NIST SP 800-38D; con IV≠96 bits el tag debe ser 128 bits.
Fuente: [NIST SP 800-38D](https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-38d.pdf).

**5.2 authTag: Web Crypto lo CONCATENA, Node lo separa — el gotcha de interop #1.**
`crypto.subtle.encrypt` con AES-GCM devuelve `ciphertext || tag` (los últimos 16
bytes son el tag) y `decrypt` espera lo mismo. Node los trata aparte:
`getAuthTag()` tras `final()` (cifrado) y `setAuthTag()` antes de `final()`
(descifrado). Puente: en el back, al recibir de Web Crypto, cortar
`ct = buf.slice(0, -16)` / `tag = buf.slice(-16)`; al enviar a Web Crypto,
`Buffer.concat([ct, tag])`.
Fuente: [MDN encrypt](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt),
[Node getAuthTag/setAuthTag](https://nodejs.org/api/crypto.html).

**5.3 IV de GCM: 12 bytes.** La doc de Node menciona 16 en un ejemplo, pero el
estándar y Web Crypto usan **12 bytes (96 bits)**. Usar 12 en ambos lados para
interoperar y seguir NIST. Node acepta 12 sin problema.

**5.4 `oaepHash` debe coincidir (SHA-256 en ambos lados).** Web Crypto fija el
hash en la CryptoKey (`hash: "SHA-256"` en importKey). Node por defecto usa
**SHA-1** en `privateDecrypt` si no se pasa `oaepHash: "sha256"`. Mismatch →
descifrado falla. Siempre `oaepHash: "sha256"` + `RSA_PKCS1_OAEP_PADDING`.

**5.5 PEM SPKI (pública) vs PKCS8 (privada).** El back sirve la **pública** en
SPKI (`-----BEGIN PUBLIC KEY-----`) y guarda la **privada** en PKCS8
(`-----BEGIN PRIVATE KEY-----`). NO confundir con PKCS1
(`-----BEGIN RSA PRIVATE/PUBLIC KEY-----`), que Web Crypto NO importa. Generar
con: `openssl genpkey -algorithm RSA -pkcs8 ...` (privada PKCS8) y
`openssl rsa -pubout` (pública SPKI). `docs/seguridad.md §1` ya exige validar
que `CRYPTO_PRIVATE_KEY` es un PEM PKCS8 cargable con `createPrivateKey`.

**5.6 SPKI: PEM→DER en el front.** `importKey("spki", ...)` espera **DER**
(ArrayBuffer), no PEM. Si el back sirve PEM, el front debe quitar cabeceras
`-----BEGIN/END-----`, quitar saltos de línea y hacer `atob` del base64 a bytes.
Más limpio: el back sirve DER directamente en base64 (o el endpoint devuelve el
PEM y el front lo des-armoriza). Decidir en design.

**5.7 base64 vs base64url.** `btoa`/`atob` (front) y `Buffer.toString("base64")`
(Node) usan base64 **estándar** (`+`, `/`, `=`). Consistente en ambos lados. NO
mezclar con base64url (`-`, `_`, sin padding) salvo que se decida uniformemente.
Como los campos van en el **body** JSON (no en URL), base64 estándar está bien.

**5.8 RSA-2048 mínimo.** `docs/seguridad.md` ya lo fija: 2048 bits es el mínimo
recomendado hoy. Con SHA-256, `encryptedKey` cifrado ocupa 256 bytes (→ ~344
chars en base64).

---

## Recomendación para esta feature

**Enfoque sugerido (híbrido real, clave de sesión AES reutilizada):**

1. `GET /crypto/public-key` → back sirve su pública RSA-2048 (SPKI; DER-base64 o
   PEM, a decidir por design).
2. Front: `importKey(spki)` la pública; `generateKey` una AES-256-GCM de sesión;
   cifra el nombre con AES-GCM (IV#1, 12 bytes); envuelve la clave AES con
   RSA-OAEP/SHA-256.
3. `POST /names` con `{ encryptedKey, iv, ciphertext(ct||tag) }` en base64.
4. Back: `privateDecrypt` (OAEP+sha256) la clave AES; `createDecipheriv`
   aes-256-gcm (setAuthTag) el nombre; genera el consecutivo; responde con la
   MISMA clave AES + IV#2 nuevo → `{ iv, ciphertext(ct||tag) }`.
5. Front: `decrypt` AES-GCM con la clave de sesión que ya tiene en memoria.

**Trampas a evitar:**
- Reutilizar IV con la misma clave AES (gatillo directo: la respuesta). IV nuevo
  siempre.
- Olvidar `oaepHash: "sha256"` en Node (default SHA-1 → no interopera).
- Tratar el authTag como campo separado en un lado y concatenado en otro:
  fijar UNA convención (recomendado: concatenado ct||tag, la nativa de Web
  Crypto) y que el back haga slice/concat contra Node.
- Pasar PEM a `importKey("spki")` sin convertir a DER.
- Claves en PKCS1 en vez de SPKI/PKCS8 (Web Crypto no las importa).

**Deprecaciones / notas de versión:**
- RSA-OAEP con SHA-1 (default de Node si no se especifica `oaepHash`) es la
  configuración legada a evitar; forzar SHA-256.
- Sin librerías de terceros: primitivas nativas (Web Crypto + `node:crypto`),
  como exige AGENTS.md.
- La regla `no-floating-promises` (lint type-aware ya activo) aplica a todo el
  `crypto.subtle.*` del front: son Promises, hay que await-earlas.

---

## Fuentes

- [MDN — SubtleCrypto.encrypt](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt) — algoritmos RSA-OAEP/AES-GCM, IV 12 bytes, integridad de GCM.
- [MDN — SubtleCrypto.importKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey) — formatos spki/raw, algoritmo `{name, hash}`, keyUsages.
- [MDN — SubtleCrypto.exportKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/exportKey) — spki (pública) / raw (AES), devuelve ArrayBuffer.
- [Node.js — Crypto](https://nodejs.org/api/crypto.html) — createPublicKey/createPrivateKey, publicEncrypt/privateDecrypt (OAEP+oaepHash), createCipheriv/createDecipheriv aes-256-gcm, getAuthTag/setAuthTag.
- [NIST SP 800-38D](https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-38d.pdf) — GCM: IV recomendado 96 bits, no reuse de nonce.
- [PKCS#1 OAEP — PyCryptodome](https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html) / [Chilkat RSA max bytes](https://cknotes.com/rsa-encryption-maximum-number-of-bytes/) — límite RSA-OAEP 2048/SHA-256 = 190 bytes.
