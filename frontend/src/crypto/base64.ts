/**
 * Conversión base64 estándar ↔ bytes, mínima y sin dependencias.
 * base64 estándar (`+`, `/`, `=`), consistente con `Buffer.toString('base64')`
 * del back. Los blobs van en el body JSON, no en la URL: no hace falta base64url.
 */

/** ArrayBuffer/Uint8Array → base64 estándar. */
export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * base64 estándar → Uint8Array respaldado por un `ArrayBuffer` concreto (no
 * `SharedArrayBuffer`), como exige `BufferSource` de Web Crypto.
 */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
