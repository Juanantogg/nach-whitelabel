# Review — crypto_hybrid

**Veredicto:** APPROVED

## Resumen

Fase REFACTOR validada. `./init.sh full` en verde (lint + typecheck + test +
build). 73 tests pasan (21 backend + 52 frontend). El código está limpio,
respeta el diseño y las convenciones del repo, y no requiere cambios. Sin
sobre-ingeniería ni código muerto.

## Checklist

- **TDD:** [x] — Tests RED reales, existían antes (documentado en `tests.md`) y
  ahora pasan sin ser relajados. Aserciones fuertes intactas: IV de 12 bytes,
  `iv.not.toBe` (no-reuse), IV vuelta ≠ ida, tag GCM manipulado → lanza, clave
  de otra pública → lanza, `source.not.toContain('BEGIN PRIVATE KEY')`.
  Implementación mínima: stub del consecutivo claramente marcado
  (`crypto.controller.ts:12-13,84-86`), sin abstracción prematura.
- **White-label:** [x] N/A — esta feature no monta UI ni componentes; expone
  funciones puras de cifrado. Sin literales de estilo/texto.
- **Backend:** [x] — Capas respetadas: `routes` (crypto.routes / names.routes)
  → `controllers` (crypto.controller) → `services` (crypto.service, lógica pura
  sin Express). `app.ts` testeable con Supertest (createApp separado de server).
  Clave privada SOLO de `env.cryptoPrivateKey`, nunca hardcodeada, y **cargada
  dentro de cada función** (crypto.service.ts:41,53 — no top-level), como exige
  el test del 500. Sin `cryptoSecret` residual del esquema simétrico viejo.
- **Calidad:** [x] — Cero `any`, cero `console.*`, cero secretos literales. El
  nombre descifrado y los buffers/claves NUNCA se loguean. Errores traducidos a
  400/422/500 sin filtrar detalle criptográfico (mensaje genérico + código).
  Cero dependencias nuevas (solo `node:crypto` y Web Crypto nativos). No
  reimplementa nada existente; `base64.ts` es mínimo y no había util previo.
  `fetchPublicKey` replica fielmente el patrón de deps inyectables de
  `loadBrand` (fetchFn/apiUrl con defaults).

## Verificaciones específicas del encargo

1. **Contrato y códigos de error:** [x]
   - `GET /crypto/public-key` → 200 `{ publicKey (SPKI/PEM), alg: 'RSA-OAEP-256' }`;
     500 `public_key_unavailable` si la privada no deriva.
   - `POST /names` → 200 `{ iv, ciphertext }`. Errores bien diferenciados:
     400 `invalid_payload` (campo ausente/no base64, o nombre > 256 bytes),
     422 `decryption_failed` (RSA/tag GCM), 500 `crypto_unavailable`
     (privada inválida, aislada con `privateKeyIsLoadable()` antes del try/catch
     de descifrado — la diferenciación 500-vs-422 es correcta).
   - Consecutivo es STUB explícito (`stubCounter`, comentado como tal; el real
     es de consecutive_counter).

2. **Correctitud criptográfica:** [x]
   - `oaepHash: 'sha256'` + `RSA_PKCS1_OAEP_PADDING` en `unwrapSessionKey`
     (crypto.service.ts:54-55). Front usa `hash: 'SHA-256'` (encryptName.ts:43).
   - IV de 12 bytes aleatorio por mensaje: back `randomBytes(IV_LENGTH=12)`
     (crypto.service.ts:80), front `getRandomValues(new Uint8Array(12))`.
   - IV de vuelta ≠ ida: la vuelta genera un IV nuevo por llamada; sin reuse.
   - authTag concatenado `ct||tag`: back parte `subarray(-16)` al descifrar y
     concatena al cifrar (crypto.service.ts:70-71,86); front trata el blob
     completo (Web Crypto nativo). Puente correcto en ambos sentidos.
   - SPKI (pública) / PKCS#8 (privada) respetados; `pemToDer` limpia armadura
     antes de `importKey('spki')`.

3. **Convenciones:** [x] — sin `any`, sin secretos literales, no-console,
   crypto.subtle.* todos awaited (no-floating-promises), capas respetadas,
   deps inyectables estilo loadBrand.

4. **Limpieza REFACTOR:** [x] — sin duplicación relevante, naming claro,
   comentarios útiles (documentan interop, no ruido), sin código muerto. La
   privada se carga en la petición y los errores no filtran detalle.

5. **Regresiones:** [x] — health y brand_config intactos (11 suites frontend /
   4 backend en verde). `app.ts` solo añade el montaje de los routers nuevos.

## Documentación

- [x] La decisión de arquitectura (cifrado híbrido asimétrico RSA-OAEP +
  AES-GCM) YA está registrada como ADR en `docs/decisiones.md:90-96` (commit
  previo f4a4d84), con contexto/porqué/nota de honestidad. Esta feature la
  IMPLEMENTA; no introduce una nueva decisión de arquitectura que exija un ADR
  adicional. README coherente. Sin acción requerida.

## Cambios requeridos

Ninguno. APPROVED.
