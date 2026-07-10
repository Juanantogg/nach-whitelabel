# Security audit — crypto_hybrid (auditoría profunda del núcleo criptográfico)

**Veredicto:** PASS (sin hallazgos CRÍTICO/ALTO). Observaciones MEDIO/BAJO/INFO abajo.

Ámbito: crypto.service.ts, crypto.controller.ts, config/env.ts, frontend/src/crypto/*,
docs/seguridad.md. NO incluye CORS/helmet/deploy (cubiertos por backend_hardening).

## Resumen
Esquema híbrido RSA-OAEP-256 (RSA-2048) + AES-256-GCM correctamente implementado e
interoperable entre Web Crypto (front) y node:crypto (back). GCM aporta integridad
autenticada; IV de 12 bytes aleatorio por operación; tag de 16 bytes concatenado
(ct||tag). Clave privada solo de entorno, con fail-fast real al boot (server.ts) que
carga la clave de verdad (createPrivateKey). Ningún secreto en el bundle del front.
Errores genéricos sin filtrar detalle criptográfico. 18/18 tests de crypto en verde.

## Hallazgos

- [MEDIO] crypto.service.ts:79 / controller:95 — Reuso de la MISMA sessionKey AES para
  ida y vuelta. Con GCM, la seguridad exige no repetir el par (clave, IV). La ida y la
  vuelta usan IV aleatorios independientes de 12 bytes, así que la probabilidad de
  colisión es ~2^-48 por par y NO hay reuso real de nonce en la práctica; además la clave
  es efímera por petición. Es un atajo de diseño DOCUMENTADO (seguridad.md fila 2) y
  aceptable para la prueba. En producción: ECDH efímero + HKDF para forward secrecy y
  claves direccionales distintas. No es defecto explotable aquí.

- [BAJO] controller.ts:63-66,72-76 — El chequeo privateKeyIsLoadable() dentro de postName
  es defensa redundante (el boot ya hace fail-fast). No es un problema; solo separa el 500
  (clave) del 422 (descifrado) para no dar oráculo. Correcto.

- [INFO] controller.ts:74-75 — decryption_failed (422) se devuelve tanto si falla el
  unwrap RSA-OAEP como si falla la validación del tag GCM. Mensaje único, sin distinguir
  causa: evita oráculo de padding. Bien resuelto.

- [INFO] docs/seguridad.md coherente con el código: RSA-OAEP SHA-256, AES-256-GCM, IV 12B
  aleatorio, SPKI/PKCS#8, base64 estándar, misma clave ida/vuelta declarada como atajo.
  Todo lo que dice el doc es lo que hace el código.

## Verificación de amenazas
- Maleabilidad/integridad: AES-GCM autentica; manipular el sobre hace fallar el tag →
  final() lanza → 422 (back) / Promise reject (front). No hay confidencialidad-sin-
  integridad. OK.
- Clave privada: nunca se loguea (grep sin resultados), no aparece en respuestas de error,
  fail-fast al boot cargándola de verdad. server.ts:15-18 loguea solo path+message de Zod,
  nunca el valor. OK.
- Validación falla-cerrado: parsePayload rechaza no-base64/vacío antes de descifrar (400);
  longitud >15 tras descifrar antes de reservar consecutivo (400). OK.
- Bundle front: noSecretInBundle.test grepea PRIVATE KEY / VITE_CRYPTO_SECRET; sessionKey
  se genera en runtime; pública no es secreta. git grep confirma cero secretos VITE. OK.
- Higiene repo: .env no trackeado; .env.example solo placeholders (...); gitleaks cubre
  PEM y CRYPTO_SECRET hex. OK.

## Checklist
- Claves: [x] privada solo en env, pública lo único al front, cero secreto en bundle
- Cifrado: [x] RSA-OAEP-256/AES-256-GCM correctos, IV 12B aleatorio, tag autenticado, sin logs de plaintext
- Higiene del repo: [x] .env fuera de git, .env.example con placeholders, gitleaks OK
