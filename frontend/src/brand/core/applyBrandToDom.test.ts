import { afterEach, describe, expect, it } from 'vitest';
import { applyBrandToDom } from './applyBrandToDom';
import { parseBrandConfig } from './schema';
import shopinbazSeed from '../seeds/shopinbaz.json';
import elektraSeed from '../seeds/elektra.json';

/**
 * Acceptance #6: "ThemeProvider inyecta las CSS variables --brand-* en :root;
 * los colores se consumen vía tokens Tailwind, cero hex en componentes".
 *
 * applyBrandToDom es una función pura testeable que escribe sobre
 * document.documentElement.style (:root). Rev.2: NO cambia su comportamiento;
 * solo el fixture pasa de `BUNDLED_BRANDS` (catálogo eliminado) a los SEEDS
 * parseados.
 *
 * RED (Rev.2): el import de `BUNDLED_BRANDS` desaparece; los seeds parseados son
 * las nuevas configs de entrada.
 */
const shopinbaz = parseBrandConfig(shopinbazSeed);
const elektra = parseBrandConfig(elektraSeed);

function readVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

describe('applyBrandToDom', () => {
  afterEach(() => {
    // Limpia las vars inyectadas para no contaminar otros tests.
    document.documentElement.removeAttribute('style');
  });

  it('escribe --brand-primary en :root con el valor de la marca', () => {
    applyBrandToDom(elektra);
    expect(readVar('--brand-primary')).toBe('242 74 45');
  });

  it('escribe el resto de vars de color de marca en :root', () => {
    applyBrandToDom(shopinbaz);
    expect(readVar('--brand-bg')).toBe('23 22 26');
    expect(readVar('--brand-surface')).toBe('38 36 43');
    expect(readVar('--brand-accent')).toBe('170 59 255');
    expect(readVar('--brand-text')).toBe('245 245 247');
    expect(readVar('--brand-muted')).toBe('148 143 156');
  });

  it('escribe las vars de estilo no-color (radius/font/title-weight)', () => {
    applyBrandToDom(shopinbaz);
    expect(readVar('--brand-radius')).toBe('0.75rem');
    expect(readVar('--brand-title-weight')).toBe('700');
    expect(readVar('--brand-font').length).toBeGreaterThan(0);
  });

  it('re-setea --brand-primary al cambiar de marca sin recargar', () => {
    applyBrandToDom(shopinbaz);
    expect(readVar('--brand-primary')).toBe('170 59 255');

    applyBrandToDom(elektra);
    expect(readVar('--brand-primary')).toBe('242 74 45');
  });
});
