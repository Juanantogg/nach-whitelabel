/**
 * Tests RED — crypto/encryptName (Web Crypto en el front).
 *
 * Mapeo a "Qué se testea (RED)" del design:
 *  - #10 `encryptName` produce { encryptedKey, iv, ciphertext } en base64 y una
 *        sessionKey de tipo AES-GCM 256.
 *  - #11 Round-trip front↔"back" simulado: cifrar con encryptName usando una
 *        pública de test, y desenvolver+descifrar en el test con la privada de
 *        test → recupera el nombre. (Verifica interop: RSA-OAEP sha256, IV 12,
 *        tag concatenado, SPKI.)
 *
 * RED esperado: `./encryptName` aún no existe → import falla, tests en rojo.
 */
import { describe, expect, it } from 'vitest';
import { encryptName } from './encryptName';
import { decryptNameAsBack, generateTestKeyPair } from './__test__/backSideKit';

/** Valida que una cadena es base64 estándar decodificable (no base64url). */
function isStandardBase64(s: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0;
}

describe('encryptName — produce el sobre híbrido', () => {
  it('devuelve encryptedKey, iv y ciphertext en base64 y una sessionKey AES-GCM 256', async () => {
    const { publicKeyPem } = generateTestKeyPair();

    const { payload, sessionKey } = await encryptName('Amaia', publicKeyPem);

    expect(isStandardBase64(payload.encryptedKey)).toBe(true);
    expect(isStandardBase64(payload.iv)).toBe(true);
    expect(isStandardBase64(payload.ciphertext)).toBe(true);

    // IV de 12 bytes (96 bits).
    expect(atob(payload.iv)).toHaveLength(12);
    // RSA-2048 → clave envuelta de 256 bytes.
    expect(atob(payload.encryptedKey)).toHaveLength(256);

    // La sessionKey es una CryptoKey AES-GCM de 256 bits reutilizable en la vuelta.
    expect(sessionKey.type).toBe('secret');
    expect(sessionKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(sessionKey.usages).toContain('decrypt');
  });

  it('genera un sobre distinto en cada llamada (clave AES/IV aleatorios por petición)', async () => {
    const { publicKeyPem } = generateTestKeyPair();

    const a = await encryptName('Iris', publicKeyPem);
    const b = await encryptName('Iris', publicKeyPem);

    expect(a.payload.iv).not.toBe(b.payload.iv);
    expect(a.payload.encryptedKey).not.toBe(b.payload.encryptedKey);
  });
});

describe('encryptName — round-trip contra el back simulado', () => {
  it('el back (privada de test) desenvuelve y descifra el nombre exacto', async () => {
    const { publicKeyPem, privateKeyPem } = generateTestKeyPair();

    const { payload } = await encryptName('José Ángel', publicKeyPem);
    const { name } = decryptNameAsBack(payload, privateKeyPem);

    expect(name).toBe('José Ángel');
  });
});
