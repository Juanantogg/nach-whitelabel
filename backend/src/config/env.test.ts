/**
 * Test RED — forma del objeto `env` tras adoptar el esquema asimétrico.
 *
 * Mapeo design #9: `env` YA NO expone `cryptoSecret` (esquema simétrico viejo)
 * y SÍ expone `cryptoPrivateKey` (PEM PKCS#8 de la privada, leída de entorno).
 *
 * RED esperado: hoy `env` todavía tiene `cryptoSecret` y no `cryptoPrivateKey`
 * → ambas aserciones fallan.
 */
import { describe, expect, it } from 'vitest';
import { env } from './env.js';

describe('config/env — esquema de cifrado asimétrico', () => {
  it('expone cryptoPrivateKey (PEM de la privada leída de entorno)', () => {
    expect(env).toHaveProperty('cryptoPrivateKey');
    expect(typeof env.cryptoPrivateKey).toBe('string');
  });

  it('ya NO expone cryptoSecret (esquema simétrico eliminado)', () => {
    expect(env).not.toHaveProperty('cryptoSecret');
  });
});
