/**
 * Test RED — cero secreto en el bundle del front.
 *
 * Mapeo design #14: ningún módulo de producción de `src/crypto/` debe contener
 * una clave privada ni un secreto simétrico fijo. La clave AES se genera en
 * runtime por petición (Web Crypto), nunca estática. La regla de CLAUDE.md /
 * AGENTS.md: "la privada nunca sale del servidor; cero secreto en el bundle".
 *
 * Grepea los .ts de producción de `src/crypto/` (excluye *.test.ts y el kit de
 * test bajo __test__/, que sí usan node:crypto legítimamente).
 *
 * RED esperado: `src/crypto/` aún no tiene módulos de producción → la aserción
 * "hay al menos un módulo de crypto" falla (todavía no existe la implementación).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cryptoDir = path.dirname(fileURLToPath(import.meta.url));

function productionModules(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        e.name.endsWith('.ts') &&
        !e.name.endsWith('.test.ts') &&
        !e.name.endsWith('.d.ts'),
    )
    .map((e) => path.join(dir, e.name));
}

describe('src/crypto — cero secreto en el bundle', () => {
  it('existe al menos un módulo de producción de cifrado', () => {
    // Exige que la implementación exista (RED: aún no hay .ts de producción).
    expect(productionModules(cryptoDir).length).toBeGreaterThan(0);
  });

  it('ningún módulo de producción contiene una PRIVATE KEY ni un secreto simétrico fijo', () => {
    for (const file of productionModules(cryptoDir)) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src, `${path.basename(file)} no debe contener una clave privada`).not.toContain(
        'PRIVATE KEY',
      );
      expect(src, `${path.basename(file)} no debe leer un secreto simétrico`).not.toContain(
        'VITE_CRYPTO_SECRET',
      );
    }
  });
});
