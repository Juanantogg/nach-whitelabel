/**
 * Tests RED — crypto/decryptNumber (Web Crypto en el front).
 *
 * Mapeo design #12: `decryptNumber` descifra un sobre AES-GCM producido con la
 * clave de sesión → devuelve el número correcto. Camino de error: sobre
 * manipulado (tag inválido) → rechaza.
 *
 * El sobre lo produce el back simulado (node:crypto) con una clave AES cruda; la
 * misma clave se importa a un CryptoKey Web Crypto para pasársela a
 * decryptNumber, replicando que el front la generó y la tiene en memoria.
 *
 * RED esperado: `./decryptNumber` aún no existe → import falla, tests en rojo.
 */
import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { decryptNumber } from './decryptNumber';
import { encryptReturnAsBack } from './__test__/backSideKit';

/** Importa una clave AES cruda (Buffer) como CryptoKey AES-GCM de Web Crypto. */
async function importSessionKey(raw: Buffer): Promise<CryptoKey> {
  return webcrypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]) as Promise<CryptoKey>;
}

describe('decryptNumber — descifra la vuelta con la clave de sesión', () => {
  it('devuelve el número que el back cifró con la misma clave AES', async () => {
    const raw = Buffer.alloc(32, 11);
    const envelope = encryptReturnAsBack('123', raw);
    const sessionKey = await importSessionKey(raw);

    const number = await decryptNumber(envelope, sessionKey);

    expect(number).toBe('123');
  });

  it('rechaza cuando el ciphertext fue manipulado (tag GCM inválido)', async () => {
    const raw = Buffer.alloc(32, 13);
    const envelope = encryptReturnAsBack('999', raw);
    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    const tampered = { iv: envelope.iv, ciphertext: bytes.toString('base64') };
    const sessionKey = await importSessionKey(raw);

    await expect(decryptNumber(tampered, sessionKey)).rejects.toBeDefined();
  });
});
