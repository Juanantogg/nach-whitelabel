import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import {
  decryptName,
  encryptForClient,
  getPublicKeyPem,
  unwrapSessionKey,
  type EncryptedPayload,
} from '../services/crypto.service.js';

/** Contador stub en memoria del proceso; el consecutivo real es de consecutive_counter. */
let stubCounter = 0;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** ¿La cadena es base64 estándar (no vacía, longitud múltiplo de 4)? */
function isBase64(value: unknown): value is string {
  return typeof value === 'string' && value.length % 4 === 0 && BASE64_RE.test(value);
}

/** Valida que el body es un sobre de ida con los tres campos en base64. */
function parsePayload(body: unknown): EncryptedPayload | null {
  if (typeof body !== 'object' || body === null) return null;
  const { encryptedKey, iv, ciphertext } = body as Record<string, unknown>;
  if (!isBase64(encryptedKey) || !isBase64(iv) || !isBase64(ciphertext)) return null;
  return { encryptedKey, iv, ciphertext };
}

/** ¿La privada de entorno carga como PEM PKCS#8? Aísla el fallo de clave (500) del de descifrado (422). */
function privateKeyIsLoadable(): boolean {
  try {
    crypto.createPrivateKey(env.cryptoPrivateKey);
    return true;
  } catch {
    return false;
  }
}

/** GET /crypto/public-key — sirve la pública SPKI/PEM derivada de la privada de entorno. */
export function getPublicKey(_req: Request, res: Response): void {
  try {
    const publicKey = getPublicKeyPem();
    res.status(200).json({ publicKey, alg: 'RSA-OAEP-256' });
  } catch {
    res.status(500).json({ error: 'public_key_unavailable' });
  }
}

/**
 * POST /names — descifra el nombre, genera un consecutivo (stub) y lo devuelve
 * cifrado con la misma clave de sesión (IV nuevo). Traduce fallos a 400/422/500
 * sin filtrar detalle criptográfico.
 */
export function postName(req: Request, res: Response): void {
  const payload = parsePayload(req.body);
  if (payload === null) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  if (!privateKeyIsLoadable()) {
    res.status(500).json({ error: 'crypto_unavailable' });
    return;
  }

  let sessionKey: Buffer;
  let name: string;
  try {
    // Desenvolver la clave de sesión (para reutilizarla en la vuelta) y descifrar el nombre.
    sessionKey = unwrapSessionKey(payload.encryptedKey);
    name = decryptName(payload);
  } catch {
    res.status(422).json({ error: 'decryption_failed' });
    return;
  }

  // Techo defensivo de tamaño del nombre descifrado (no procesar payloads absurdos).
  if (name.length > 256) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  // Consecutivo STUB (número); la generación real persistida es de consecutive_counter.
  stubCounter += 1;
  const envelope = encryptForClient(String(stubCounter), sessionKey);
  res.status(200).json(envelope);
}
