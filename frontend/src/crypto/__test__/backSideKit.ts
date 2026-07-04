/**
 * Kit de test compartido (frontend, fase RED).
 *
 * Implementa "el otro lado" del esquema híbrido — lo que hace el BACK con
 * `node:crypto` — para poder probar las funciones de `src/crypto/` (Web Crypto)
 * sin depender de red ni de un backend real. Vitest corre en Node, así que aquí
 * disponemos de `node:crypto` en el archivo de test aunque el módulo de
 * producción use solo Web Crypto.
 *
 * Gotchas de interop verificados a propósito (para que el implementer no falle):
 *  - RSA-OAEP `oaepHash: 'sha256'` en el desenvuelto de la clave AES.
 *  - authTag CONCATENADO (`ct || tag`, últimos 16 bytes) que produce Web Crypto.
 *  - IV de 12 bytes.
 *  - Pública SPKI/PEM, privada PKCS#8/PEM.
 */
import crypto from 'node:crypto';

export interface TestKeyPair {
  publicKeyPem: string; // SPKI PEM
  privateKeyPem: string; // PKCS#8 PEM
}

export function generateTestKeyPair(): TestKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/**
 * Simula el back: desenvuelve la clave AES (RSA-OAEP sha256) y descifra el
 * nombre (AES-GCM, tag concatenado al final del ciphertext).
 */
export function decryptNameAsBack(
  payload: { encryptedKey: string; iv: string; ciphertext: string },
  privateKeyPem: string,
): { name: string; sessionKey: Buffer } {
  const sessionKey = crypto.privateDecrypt(
    {
      key: crypto.createPrivateKey(privateKeyPem),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(payload.encryptedKey, 'base64'),
  );

  const iv = Buffer.from(payload.iv, 'base64');
  const combined = Buffer.from(payload.ciphertext, 'base64');
  const ct = combined.subarray(0, combined.length - 16);
  const tag = combined.subarray(combined.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv);
  decipher.setAuthTag(tag);
  const name = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');

  return { name, sessionKey };
}

/**
 * Simula el back cifrando la vuelta (el consecutivo) con la misma clave AES de
 * sesión, IV NUEVO, tag concatenado (para que Web Crypto lo descifre).
 */
export function encryptReturnAsBack(
  value: string,
  sessionKey: Buffer,
): { iv: string; ciphertext: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([ct, tag]).toString('base64'),
  };
}
