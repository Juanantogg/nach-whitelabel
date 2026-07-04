/**
 * Tests RED — services/crypto.service (lógica pura de cifrado, sin Express).
 *
 * Mapeo a "Qué se testea (RED)" del design:
 *  - #2 Round-trip de ida (decryptName).
 *  - #3 Round-trip de vuelta (encryptForClient / unwrapSessionKey), IV vuelta ≠ ida.
 *  - #8 La privada se lee por parámetro/env, nunca hardcodeada.
 *  - #1 getPublicKeyPem deriva un PEM SPKI válido desde la privada.
 *
 * La clave privada se INYECTA por parámetro (par de test generado aquí, sin
 * tocar `.env`). Los sobres de entrada los produce el kit de test replicando
 * exactamente lo que hará el front con Web Crypto.
 *
 * RED esperado: el módulo `./crypto.service.js` aún no existe → los imports
 * fallan y todos los tests quedan en rojo por "función/módulo ausente".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decryptName,
  encryptForClient,
  getPublicKeyPem,
  unwrapSessionKey,
} from './crypto.service.js';
import {
  decryptReturnAsFront,
  encryptNameAsFront,
  generateTestKeyPair,
  type TestKeyPair,
} from './__test__/cryptoTestKit.js';

let keys: TestKeyPair;

beforeAll(() => {
  keys = generateTestKeyPair();
});

describe('getPublicKeyPem — deriva la pública SPKI desde la privada PKCS#8', () => {
  it('devuelve un PEM SPKI (BEGIN PUBLIC KEY) desde la privada inyectada', () => {
    const pem = getPublicKeyPem(keys.privateKeyPem);

    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pem).toContain('-----END PUBLIC KEY-----');
    // SPKI, NO PKCS#1 (que Web Crypto no importaría).
    expect(pem).not.toContain('BEGIN RSA PUBLIC KEY');
  });

  it('lanza cuando la privada es inválida (no un PEM PKCS#8 cargable)', () => {
    expect(() => getPublicKeyPem('no-soy-una-clave')).toThrow();
  });
});

describe('decryptName — round-trip de IDA (front cifra → back descifra)', () => {
  it('recupera exactamente el nombre cifrado por el front con la pública del par', () => {
    const env = encryptNameAsFront('María José', keys.publicKeyPem);

    const name = decryptName(
      { encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext },
      keys.privateKeyPem,
    );

    expect(name).toBe('María José');
  });

  it('lanza cuando el tag GCM no valida (ciphertext manipulado)', () => {
    const env = encryptNameAsFront('Ana', keys.publicKeyPem);
    // Corromper un byte del ciphertext → el tag GCM ya no cuadra.
    const raw = Buffer.from(env.ciphertext, 'base64');
    raw[0] ^= 0xff;
    const tampered = raw.toString('base64');

    expect(() =>
      decryptName(
        { encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: tampered },
        keys.privateKeyPem,
      ),
    ).toThrow();
  });

  it('lanza cuando la clave AES fue envuelta con OTRA pública (RSA no desenvuelve)', () => {
    const otherKeys = generateTestKeyPair();
    const env = encryptNameAsFront('Luis', otherKeys.publicKeyPem);

    expect(() =>
      decryptName(
        { encryptedKey: env.encryptedKey, iv: env.iv, ciphertext: env.ciphertext },
        keys.privateKeyPem,
      ),
    ).toThrow();
  });
});

describe('unwrapSessionKey — desenvuelve la clave AES de sesión (RSA-OAEP sha256)', () => {
  it('recupera los 32 bytes exactos de la clave AES que generó el front', () => {
    const sessionKey = Buffer.alloc(32, 7); // clave AES conocida
    const env = encryptNameAsFront('X', keys.publicKeyPem, sessionKey);

    const unwrapped = unwrapSessionKey(env.encryptedKey, keys.privateKeyPem);

    expect(Buffer.isBuffer(unwrapped)).toBe(true);
    expect(unwrapped).toHaveLength(32);
    expect(unwrapped.equals(sessionKey)).toBe(true);
  });
});

describe('encryptForClient — round-trip de VUELTA (back cifra → front descifra)', () => {
  it('el front descifra el consecutivo con la misma clave de sesión', () => {
    const sessionKey = Buffer.alloc(32, 3);

    const envelope = encryptForClient('42', sessionKey);

    // El sobre viaja en base64 y el front lo descifra con la clave que ya tiene.
    const number = decryptReturnAsFront(envelope, sessionKey);
    expect(number).toBe('42');
  });

  it('usa un IV de 12 bytes (base64) y NUEVO en cada llamada — nunca reutiliza IV', () => {
    const sessionKey = Buffer.alloc(32, 9);

    const a = encryptForClient('1', sessionKey);
    const b = encryptForClient('1', sessionKey);

    // IV de 12 bytes.
    expect(Buffer.from(a.iv, 'base64')).toHaveLength(12);
    // IV distinto entre dos cifrados con la MISMA clave (regla dura de GCM).
    expect(a.iv).not.toBe(b.iv);
  });

  it('el IV de la vuelta difiere del IV de la ida aunque la clave AES sea la misma', () => {
    const sessionKey = Buffer.alloc(32, 5);
    const ida = encryptNameAsFront('Dora', keys.publicKeyPem, sessionKey);

    const vuelta = encryptForClient('7', sessionKey);

    expect(vuelta.iv).not.toBe(ida.iv);
  });
});

describe('la privada nunca está hardcodeada en el módulo', () => {
  it('el fuente de crypto.service.ts no contiene una PRIVATE KEY literal', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'crypto.service.ts'), 'utf8');

    expect(source).not.toContain('BEGIN PRIVATE KEY');
    expect(source).not.toContain('BEGIN RSA PRIVATE KEY');
  });
});
