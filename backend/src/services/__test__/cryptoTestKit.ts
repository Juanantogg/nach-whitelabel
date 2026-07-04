/**
 * Kit de test compartido para crypto_hybrid (fase RED).
 *
 * Implementa "el otro lado" del esquema híbrido (lo que hace el FRONT con Web
 * Crypto) usando solo `node:crypto`, para poder testear el service y el
 * endpoint sin depender de la red ni de un `.env` real. Genera un par RSA de
 * test y produce sobres cifrados exactamente como los produciría el front.
 *
 * Gotchas de interop verificados aquí a propósito (para que el implementer NO
 * se equivoque):
 *  - RSA-OAEP con `oaepHash: 'sha256'` (Node por defecto usaría SHA-1 → no
 *    interoperaría con Web Crypto).
 *  - IV de 12 bytes (96 bits), estándar NIST y el que usa Web Crypto.
 *  - authTag CONCATENADO al ciphertext (`ct || tag`, últimos 16 bytes), la
 *    convención nativa de Web Crypto que adopta el contrato en AMBOS sentidos.
 *  - Clave pública en SPKI/PEM, privada en PKCS#8/PEM (no PKCS#1).
 *  - base64 estándar (no base64url).
 */
import crypto from 'node:crypto';

export interface TestKeyPair {
  /** PEM SPKI: `-----BEGIN PUBLIC KEY-----` */
  publicKeyPem: string;
  /** PEM PKCS#8: `-----BEGIN PRIVATE KEY-----` */
  privateKeyPem: string;
}

/** Genera un par RSA-2048 en formato SPKI/PKCS8 PEM (como espera el esquema). */
export function generateTestKeyPair(): TestKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

export interface FrontEnvelope {
  /** clave AES-256 de sesión, envuelta con RSA-OAEP (base64) */
  encryptedKey: string;
  /** IV de 12 bytes del cifrado del nombre (base64) */
  iv: string;
  /** nombre cifrado AES-GCM: ct || tag (base64) */
  ciphertext: string;
  /** la clave AES cruda (32 bytes), para descifrar la vuelta en el test */
  sessionKey: Buffer;
}

/**
 * Replica lo que hace el front: genera clave AES-256 de sesión, cifra el
 * nombre con AES-GCM (IV#1), y envuelve la clave AES con la pública RSA-OAEP.
 * authTag concatenado al ciphertext, como Web Crypto.
 */
export function encryptNameAsFront(
  name: string,
  publicKeyPem: string,
  sessionKey: Buffer = crypto.randomBytes(32),
): FrontEnvelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
  const ct = Buffer.concat([cipher.update(name, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([ct, tag]); // ct || tag (convención Web Crypto)

  const encryptedKey = crypto.publicEncrypt(
    {
      key: crypto.createPublicKey(publicKeyPem),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    sessionKey,
  );

  return {
    encryptedKey: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: combined.toString('base64'),
    sessionKey,
  };
}

/**
 * Replica lo que hace el front al recibir la vuelta: descifra un sobre
 * AES-GCM (ct || tag) con la clave de sesión que él mismo generó.
 */
export function decryptReturnAsFront(
  envelope: { iv: string; ciphertext: string },
  sessionKey: Buffer,
): string {
  const iv = Buffer.from(envelope.iv, 'base64');
  const combined = Buffer.from(envelope.ciphertext, 'base64');
  const ct = combined.subarray(0, combined.length - 16);
  const tag = combined.subarray(combined.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
