# Security audit — crypto_hybrid

**Veredicto:** SIN HALLAZGOS CRÍTICOS (PASS)

Auditoría del cifrado híbrido asimétrico (RSA-OAEP-256 envuelve AES-256-GCM de
sesión). No hay ningún hallazgo crítico ni alto. Se registran dos observaciones
de severidad baja, ninguna bloqueante y ambas ya cubiertas por pendientes
explícitos de `docs/seguridad.md` fuera del scope de esta feature.

## Tabla de hallazgos

| Severidad | Archivo:línea | Hallazgo | Recomendación |
| --- | --- | --- | --- |
| Bajo | `backend/src/app.ts:14` | `express.json()` sin `limit`. La validación de tamaño (`name.length > 256`) ocurre DESPUÉS de descifrar; un `ciphertext` base64 gigante se parsea y se intenta descifrar antes del techo. RSA solo desenvuelve 32 bytes, pero AES-GCM procesa todo el ciphertext. | Añadir `express.json({ limit: '16kb' })` como techo previo al parseo. Pertenece al pendiente §5 (validación de entrada) de `docs/seguridad.md`. No abre agujero de confidencialidad; es endurecimiento anti-DoS. |
| Bajo | `backend/src/config/env.ts:10` | `cryptoPrivateKey` cae a `''` por defecto; el server arranca con clave vacía. Mitigado en runtime: `privateKeyIsLoadable()` en el controller devuelve 500 `crypto_unavailable` antes de descifrar, y `getPublicKey` cae a 500 `public_key_unavailable`. No hay degradación silenciosa a "sin cifrado". | Cerrar con el fail-fast Zod-boot (§1 de `docs/seguridad.md`), ya declarado pendiente propio. Aceptable diferirlo: la feature falla cerrado (deniega), no abierto. |

## Checklist del modelo de amenazas

- **Claves** [x]
  - Privada solo de env (`CRYPTO_PRIVATE_KEY` vía `env.cryptoPrivateKey`), nunca hardcodeada, nunca logueada, nunca en respuesta HTTP.
  - Pública derivada de la privada (`createPublicKey`) y expuesta en `GET /crypto/public-key` — correcto por diseño (`docs/seguridad.md`).
  - `git grep "BEGIN PRIVATE KEY"` solo devuelve `.env.example` (placeholder `...`, en allowlist de gitleaks), `.gitleaks.toml` (patrón de detección) y docs. Cero claves reales en el repo o el bundle.
  - Front: `git grep "VITE_*(SECRET|PRIVATE|KEY)"` vacío; sin hex largos en `frontend/src`. Ningún secreto simétrico ni privado en el bundle.

- **Cifrado** [x]
  - RSA-OAEP con `oaepHash: 'sha256'` explícito (evita el default SHA-1 de Node) + `RSA_PKCS1_OAEP_PADDING`; front importa con `hash: 'SHA-256'`. Coinciden.
  - AES-256-GCM. IV de 12 bytes criptográficamente aleatorio: back `crypto.randomBytes(12)`, front `crypto.getRandomValues`. No fijo, no contador.
  - Sin reuse del par (clave, IV): la vuelta (`encryptForClient`) genera SIEMPRE un IV nuevo aunque reutilice la clave AES de sesión.
  - Tag GCM de 128 bits (16 bytes) verificado: `setAuthTag` + `final()` lanza ante manipulación → 422 `decryption_failed`. Integridad garantizada.
  - El nombre (PII) viaja cifrado en la ida y el consecutivo cifrado en la vuelta, según el contrato. Nombre descifrado en memoria, descartado (no se persiste ni loguea aquí).

- **Higiene del repo** [x]
  - `.env` no trackeado; `.env.example` solo placeholders.
  - `.gitleaks.toml` cubre PEM privado (reglas por defecto), clave simétrica hex (`nach-crypto-secret`) y URI Mongo con credenciales (`nach-mongodb-uri`), con allowlist para el `.env.example`. Cubre los patrones de esta feature.
  - Errores no filtran detalle interno: mensajes genéricos con código (`invalid_payload` / `decryption_failed` / `crypto_unavailable` / `public_key_unavailable`); todos los `catch {}` descartan el error, sin stack ni texto plano al cliente.
  - `no-console` respetado: sin `console.log`/`debug` de PII ni buffers de clave en los módulos crypto (back y front).
  - Superficie de entrada: base64 validado (`isBase64`: regex + longitud múltiplo de 4) antes de usarse; techo defensivo del nombre descifrado (≤256). Falta solo el `limit` del body-parser (hallazgo bajo).

## Deltas contra docs/seguridad.md

**Cierra (propongo marcar como hechos en el checklist de `docs/seguridad.md`):**
- [x] "Implementar el cifrado híbrido (clave pública en front, privada solo en back)" — implementado y auditado. Front cifra con la pública sin secreto en el bundle; back descifra con la privada de env.

**Queda pendiente, aceptable fuera de ESTA feature (no abre agujero aquí):**
- §1 Fail-fast Zod del entorno — mitigado en runtime (falla cerrado con 500, no degrada a sin-cifrado). Diferible.
- §3 CORS + helmet — no afectan la confidencialidad del payload cifrado; el nombre viaja cifrado extremo a extremo con o sin esas cabeceras. Pertenecen al cableado front↔back de `welcome_screen`/`deploy`.
- §4 Rate limiting — mitigación de abuso, no de fuga de datos. Diferible.
- §5 Validación de entrada avanzada — el body-parser `limit` (hallazgo bajo) vive aquí; el techo de 256 ya acota el nombre descifrado. Diferible sin riesgo de confidencialidad.

Dejar §1/§3/§4/§5 fuera NO abre un agujero en esta feature: el esquema cifra el
nombre extremo a extremo, verifica integridad con GCM, no reutiliza (clave, IV),
no expone secretos en el front y falla cerrado ante clave ausente/inválida.
