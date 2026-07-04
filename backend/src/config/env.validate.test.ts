/**
 * Tests RED — validación fail-fast del entorno con Zod (feature consecutive_counter).
 *
 * Cubre el Grupo 3 del design (`progress/consecutive_counter/design.md`):
 *  - #8  MONGODB_URI ausente → resultado inválido.
 *  - #9  MONGODB_URI sin prefijo mongo (`mongodb://` / `mongodb+srv://`) → inválido.
 *  - #10 CRYPTO_PRIVATE_KEY no-PEM ("clave-basura") → inválido (intenta cargar la
 *        clave, no solo mirar el prefijo).
 *  - #11 combo válido (URI mongo + PEM real del test kit) → válido, con `port`
 *        default 3001 cuando PORT no está.
 *  - #12 importar `env.ts` NO aborta el proceso aunque falten variables.
 *
 * `validateEnv` es una función PURA y testeable (`source = process.env` por
 * defecto) que NO llama a `process.exit`; el fail-fast real vive en `server.ts`.
 * El diseño la deja libre de firmar como "devuelve resultado" o "lanza"; el
 * test acepta AMBAS convenciones vía un helper `esInvalido`.
 *
 * MOTIVO DE FALLO ESPERADO (RED legítimo): hoy `config/env.ts` NO exporta
 * `validateEnv` (usa `?? ''` sin validar) y `zod` NO está instalado en el
 * backend. El import de `validateEnv` falla por símbolo/módulo ausente → todo
 * el describe queda en rojo. Es el RED esperado del diseño.
 */
import { describe, expect, it } from 'vitest';
import * as envModule from './env.js';
import { generateTestKeyPair } from '../services/__test__/cryptoTestKit.js';

/** Resultado neutro respecto a la convención elegida (objeto `{success}` o throw). */
interface MaybeResult {
  success?: boolean;
  data?: { port?: number };
}

/**
 * Firma esperada de `validateEnv` (función pura y testeable que el implementer
 * creará en `env.ts`). Se accede vía import de namespace + cast tipado para que
 * el test sea type-safe y lint-limpio HOY, sin que TypeScript exija que el
 * export ya exista: el RED se produce en RUNTIME porque `validateEnv` todavía es
 * `undefined` (llamarlo lanza, o `typeof` no es 'function'), no por un error de
 * tipos que enmascare el rojo.
 */
type ValidateEnv = (source: Record<string, string | undefined>) => MaybeResult;
const validateEnv = (envModule as { validateEnv?: ValidateEnv }).validateEnv as ValidateEnv;

/**
 * ¿La validación del `source` dado es inválida? Acepta ambas convenciones:
 *  - `validateEnv` devuelve `{ success: false }` → inválido.
 *  - `validateEnv` lanza al validar (p.ej. ZodError) → inválido.
 *
 * IMPORTANTE (evitar RED enmascarado): exige primero que `validateEnv` SEA una
 * función real. Hoy no existe → esta aserción falla y el test queda en rojo por
 * la razón correcta (código ausente), no porque `undefined()` casualmente lance
 * y "parezca" inválido.
 */
function esInvalido(source: Record<string, string | undefined>): boolean {
  expect(typeof validateEnv).toBe('function');
  try {
    const result = validateEnv(source);
    return result.success === false;
  } catch {
    // Un throw AL VALIDAR (ZodError) cuenta como inválido, siempre que
    // `validateEnv` exista (garantizado por la aserción de arriba).
    return true;
  }
}

/** Extrae el resultado válido (para inspeccionar defaults como `port`). */
function validar(source: Record<string, string | undefined>): MaybeResult {
  return validateEnv(source);
}

describe('config/env — validateEnv (fail-fast del entorno)', () => {
  const pemValido = generateTestKeyPair().privateKeyPem;

  it('#8 con MONGODB_URI ausente → inválido', () => {
    const source = {
      CRYPTO_PRIVATE_KEY: pemValido,
      // sin MONGODB_URI
    };
    expect(esInvalido(source)).toBe(true);
  });

  it('#9 con MONGODB_URI sin prefijo mongo → inválido', () => {
    const source = {
      MONGODB_URI: 'http://no-es-mongo:27017/db',
      CRYPTO_PRIVATE_KEY: pemValido,
    };
    expect(esInvalido(source)).toBe(true);
  });

  it('#10 con CRYPTO_PRIVATE_KEY no-PEM → inválido', () => {
    const source = {
      MONGODB_URI: 'mongodb://localhost:27017/nach',
      CRYPTO_PRIVATE_KEY: 'clave-basura-no-pem',
    };
    expect(esInvalido(source)).toBe(true);
  });

  it('#11 combo válido (URI mongo + PEM real) → válido y port default 3001', () => {
    const source = {
      MONGODB_URI: 'mongodb://localhost:27017/nach',
      CRYPTO_PRIVATE_KEY: pemValido,
      // sin PORT → debe tomar el default 3001
    };
    expect(esInvalido(source)).toBe(false);

    const result = validar(source);
    // Convención "devuelve resultado": el default de port es 3001.
    if (result.success !== undefined) {
      expect(result.success).toBe(true);
      expect(result.data?.port).toBe(3001);
    }
  });

  it('#11b acepta mongodb+srv:// como URI válida', () => {
    const source = {
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.net/nach',
      CRYPTO_PRIVATE_KEY: pemValido,
    };
    expect(esInvalido(source)).toBe(false);
  });
});
