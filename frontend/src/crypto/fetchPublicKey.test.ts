/**
 * Tests RED — crypto/fetchPublicKey (patrón deps inyectables como loadBrand).
 *
 * Mapeo design #13: `fetchPublicKey` hace GET a `${apiUrl}/crypto/public-key`
 * (fetch mockeado) y devuelve el PEM; propaga error si `!res.ok`.
 *
 * RED esperado: `./fetchPublicKey` aún no existe → import falla, tests en rojo.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchPublicKey } from './fetchPublicKey';

const PEM = '-----BEGIN PUBLIC KEY-----\nMIIBI...\n-----END PUBLIC KEY-----\n';

describe('fetchPublicKey', () => {
  it('hace GET a `${apiUrl}/crypto/public-key` y devuelve el PEM del body', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ publicKey: PEM, alg: 'RSA-OAEP-256' }),
      }),
    ) as unknown as typeof fetch;

    const pem = await fetchPublicKey({ fetchFn, apiUrl: 'https://api.example.com' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.example.com/crypto/public-key',
      expect.anything(),
    );
    expect(pem).toBe(PEM);
  });

  it('propaga error cuando la respuesta no es ok (!res.ok)', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'public_key_unavailable' }),
      }),
    ) as unknown as typeof fetch;

    await expect(
      fetchPublicKey({ fetchFn, apiUrl: 'https://api.example.com' }),
    ).rejects.toBeDefined();
  });
});
