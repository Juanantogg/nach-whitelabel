/**
 * Cifrado híbrido del lado del front (solo Web Crypto API nativa).
 *
 * Genera una clave AES-256-GCM de sesión por petición, cifra el nombre con ella
 * (IV de 12 bytes) y envuelve la clave AES con la pública RSA-OAEP-256 del back.
 * Ningún secreto vive en el bundle: la clave AES se crea en runtime y la pública
 * no es secreta. La `sessionKey` se devuelve para descifrar la vuelta.
 *
 * Convenciones de interop (deben coincidir con el back):
 *  - RSA-OAEP con SHA-256.
 *  - IV de 12 bytes (96 bits).
 *  - AES-GCM devuelve `ct || tag` concatenados (nativo de Web Crypto).
 *  - Pública en SPKI/PEM; base64 estándar en tránsito.
 */
import { base64ToBytes, bytesToBase64 } from './base64';

export interface EncryptedPayload {
  /** clave AES-256 de sesión, envuelta con RSA-OAEP (base64) */
  encryptedKey: string;
  /** IV de 12 bytes del cifrado del nombre (base64) */
  iv: string;
  /** nombre cifrado AES-GCM: ct || tag (base64) */
  ciphertext: string;
}

const IV_LENGTH = 12;

/** Quita la armadura PEM (`-----BEGIN/END-----`) y devuelve el DER como bytes. */
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  return base64ToBytes(base64);
}

/** Importa la pública RSA (SPKI/PEM) como CryptoKey para envolver la clave AES. */
async function importPublicKey(publicKeyPem: string): Promise<CryptoKey> {
  const der = pemToDer(publicKeyPem);
  return crypto.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'encrypt',
  ]);
}

/**
 * Genera la clave AES de sesión, cifra el nombre y envuelve la clave con la
 * pública RSA. Devuelve el sobre en base64 y la `sessionKey` (para la vuelta).
 */
export async function encryptName(
  name: string,
  publicKeyPem: string,
): Promise<{ payload: EncryptedPayload; sessionKey: CryptoKey }> {
  const publicKey = await importPublicKey(publicKeyPem);

  const sessionKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable: para poder envolverla con RSA
    ['encrypt', 'decrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_LENGTH)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sessionKey,
    new TextEncoder().encode(name),
  );

  const rawKey = await crypto.subtle.exportKey('raw', sessionKey);
  const encryptedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey);

  return {
    payload: {
      encryptedKey: bytesToBase64(encryptedKey),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
    },
    sessionKey,
  };
}
