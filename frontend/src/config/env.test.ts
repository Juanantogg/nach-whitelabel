/**
 * Tests RED — config/env (fuente única y validada del acceso a VITE_*).
 *
 * Mapea acceptance del design:
 *  #1 `validateEnv(source)` es pura, source inyectable, NUNCA lanza; success siempre true.
 *  #2 `env.apiUrl` es string sin trailing slash; '' es válido.
 *  #3 `env.defaultBrand` es undefined cuando la var está ausente o vacía.
 *
 * RED esperado: `../config/env` aún no existe → import falla, tests en rojo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, validateEnv } from './env';

describe('validateEnv — función pura sobre source inyectable', () => {
  it('con apiUrl ausente devuelve apiUrl = "" (dev legítimo)', () => {
    const result = validateEnv({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('');
    }
  });

  it('recorta el trailing slash de apiUrl (evita doble barra futura)', () => {
    const result = validateEnv({ VITE_API_URL: 'https://api.example.com/' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://api.example.com');
    }
  });

  it('preserva apiUrl sin trailing slash tal cual', () => {
    const result = validateEnv({ VITE_API_URL: 'https://api.example.com' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://api.example.com');
    }
  });

  it('defaultBrand es undefined cuando la var está ausente', () => {
    const result = validateEnv({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultBrand).toBeUndefined();
    }
  });

  it('defaultBrand es undefined cuando la var está vacía', () => {
    const result = validateEnv({ VITE_DEFAULT_BRAND: '' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultBrand).toBeUndefined();
    }
  });

  it('defaultBrand refleja el valor cuando la var está presente', () => {
    const result = validateEnv({ VITE_DEFAULT_BRAND: 'elektra' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultBrand).toBe('elektra');
    }
  });

  it('success es siempre true con las vars actuales (nunca falla)', () => {
    // Ninguna de las dos vars es requerida → safeParse jamás falla.
    expect(validateEnv({}).success).toBe(true);
    expect(validateEnv({ VITE_API_URL: 'x', VITE_DEFAULT_BRAND: 'y' }).success).toBe(true);
    expect(validateEnv({ VITE_API_URL: '' }).success).toBe(true);
  });
});

describe('env — objeto ya resuelto del entorno', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('existe y expone apiUrl (string) sin lanzar aunque el entorno esté vacío', () => {
    // El objeto `env` se hidrata al importarse; con las vars actuales nunca lanza.
    expect(env).toBeDefined();
    expect(typeof env.apiUrl).toBe('string');
  });

  it('se hidrata del entorno vía import.meta.env (validado por validateEnv)', () => {
    // Verifica el mecanismo de hidratación de forma pura (sin re-import del módulo):
    // lo que `env` refleja del entorno es exactamente lo que valida `validateEnv`.
    vi.stubEnv('VITE_API_URL', 'https://stubbed.example.com/');

    const result = validateEnv(import.meta.env);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiUrl).toBe('https://stubbed.example.com');
    }
  });
});
