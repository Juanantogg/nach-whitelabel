/**
 * Descifra la vuelta del back (AES-GCM) con la clave de sesión que el front
 * generó. El sobre trae `ct || tag` concatenados (convención Web Crypto), así
 * que se descifra directamente sin separar el tag. Devuelve el número como
 * string; si el tag no valida (payload manipulado), la Promise rechaza.
 */
import { base64ToBytes } from './base64';

export async function decryptNumber(
  envelope: { iv: string; ciphertext: string },
  sessionKey: CryptoKey,
): Promise<string> {
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);

  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sessionKey, ciphertext);

  return new TextDecoder().decode(plaintext);
}
