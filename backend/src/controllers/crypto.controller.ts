import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { createRecord } from '../services/counter.service.js';
import {
  decryptName,
  encryptForClient,
  getPublicKeyPem,
  unwrapSessionKey,
  type EncryptedPayload,
} from '../services/crypto.service.js';

/** Límite de longitud del nombre en claro (maquetas: "0/15 caracteres"). */
const MAX_NAME_LENGTH = 15;

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
 * POST /names — descifra el nombre, genera y persiste un consecutivo real y lo
 * devuelve cifrado con la misma clave de sesión (IV nuevo). Traduce fallos a
 * 400/422/500 sin filtrar detalle criptográfico.
 */
export async function postName(req: Request, res: Response): Promise<void> {
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

  // Validación de negocio del nombre en claro (falla-cerrado): antes de reservar
  // consecutivo o persistir, para no gastar número por un payload inválido.
  if (name.length > MAX_NAME_LENGTH) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  // Consecutivo real persistido en Mongo (capa de services).
  let numero: number;
  try {
    numero = await createRecord(name);
  } catch {
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  const envelope = encryptForClient(String(numero), sessionKey);
  res.status(200).json(envelope);
}
