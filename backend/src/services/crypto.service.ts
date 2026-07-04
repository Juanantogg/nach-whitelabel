/**
 * Lógica pura del cifrado híbrido asimétrico (sin Express).
 *
 * Esquema: RSA-OAEP-256 envuelve una clave AES-256-GCM de sesión que el front
 * genera por petición. La ida (front→back) descifra el nombre; la vuelta
 * (back→front) reutiliza la MISMA clave AES con un IV NUEVO para cifrar el
 * consecutivo. authTag concatenado al ciphertext (`ct || tag`), la convención
 * nativa de Web Crypto: el back parte/une los últimos 16 bytes contra Node.
 *
 * La clave privada se INYECTA por parámetro (default: la de entorno). Nunca se
 * hardcodea ni se loguea. Se carga DENTRO de cada llamada para que un valor de
 * entorno inválido produzca un error en tiempo de petición (no al cargar el
 * módulo), como exigen los tests del caso 500.
 */
import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** Sobre de ida producido por el front (todos los campos en base64). */
export interface EncryptedPayload {
  /** clave AES-256 de sesión, envuelta con RSA-OAEP */
  encryptedKey: string;
  /** IV de 12 bytes del cifrado del nombre */
  iv: string;
  /** nombre cifrado AES-GCM: ct || tag */
  ciphertext: string;
}

/** Sobre de vuelta que el back devuelve al front (base64). */
export interface CipherEnvelope {
  /** IV NUEVO de 12 bytes (distinto del de la ida) */
  iv: string;
  /** valor cifrado AES-GCM: ct || tag */
  ciphertext: string;
}

const IV_LENGTH = 12; // 96 bits, estándar NIST y el que usa Web Crypto
const TAG_LENGTH = 16; // 128 bits, tag GCM concatenado al final del ciphertext

/** Deriva la pública SPKI/PEM desde la privada PKCS#8. Lanza si la clave es inválida. */
export function getPublicKeyPem(privatePem: string = env.cryptoPrivateKey): string {
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(privateKey);
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

/** Desenvuelve la clave AES de sesión (RSA-OAEP sha256). Devuelve los 32 bytes crudos. */
export function unwrapSessionKey(
  encryptedKeyB64: string,
  privatePem: string = env.cryptoPrivateKey,
): Buffer {
  return crypto.privateDecrypt(
    {
      key: crypto.createPrivateKey(privatePem),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encryptedKeyB64, 'base64'),
  );
}

/** Desenvuelve la clave AES y descifra el nombre (AES-GCM). Devuelve texto UTF-8. */
export function decryptName(
  payload: EncryptedPayload,
  privatePem: string = env.cryptoPrivateKey,
): string {
  const sessionKey = unwrapSessionKey(payload.encryptedKey, privatePem);

  const iv = Buffer.from(payload.iv, 'base64');
  const combined = Buffer.from(payload.ciphertext, 'base64');
  const ct = combined.subarray(0, combined.length - TAG_LENGTH);
  const tag = combined.subarray(combined.length - TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Cifra un valor con la clave de sesión (AES-GCM, IV nuevo). tag concatenado al ciphertext. */
export function encryptForClient(plaintext: string, sessionKey: Buffer): CipherEnvelope {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([ct, tag]).toString('base64'),
  };
}
