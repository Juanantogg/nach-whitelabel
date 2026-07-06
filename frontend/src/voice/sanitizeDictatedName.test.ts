/**
 * Tests RED — voice/sanitizeDictatedName (limpieza PURA de puntuación de borde
 * del texto DICTADO). Añadido a la feature voice_auto_send (decisión del usuario,
 * 2026-07-05).
 *
 * MOTIVO (descubierto en runtime): Whisper/Groq añade puntuación automática al
 * transcribir, así que dictar "Juan" devuelve "Juan." con punto final. Hay que
 * limpiarlo, pero SOLO en el texto que viene del DICTADO — nunca en el input
 * manual del teclado (si el usuario escribe un punto a mano, es su decisión).
 *
 * Contrato de la función pura (la crea el implementer en el GREEN):
 *   sanitizeDictatedName(raw: string): string
 * Quita los signos de puntuación de BORDE (inicio y final) y los espacios
 * sobrantes, CONSERVANDO letras, tildes, ñ y los espacios INTERNOS (nombres
 * compuestos como "José María" quedan intactos).
 *
 * Set de signos de borde a eliminar (decisión del usuario): . , ; : ! ? ¡ ¿ …
 * más comillas ("" '' « » “ ” ‘ ’) y espacios en blanco de borde. NO se tocan
 * los caracteres internos: solo se recorta desde los extremos hacia dentro.
 *
 * NO necesita jsdom ni mocks: es una función pura sobre strings. Se afirma la
 * semántica con pares entrada→salida.
 *
 * RED esperado: `./sanitizeDictatedName` aún NO existe (lo crea el implementer en
 * el GREEN) → el import falla y toda la suite queda en rojo por "módulo ausente".
 * RED puro por símbolo/módulo inexistente, no por sintaxis del test.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeDictatedName } from './sanitizeDictatedName';

describe('sanitizeDictatedName — puntuación de borde del dictado', () => {
  it('quita el punto final que añade Whisper: "Juan." → "Juan"', () => {
    expect(sanitizeDictatedName('Juan.')).toBe('Juan');
  });

  it('quita la coma final: "Ana," → "Ana"', () => {
    expect(sanitizeDictatedName('Ana,')).toBe('Ana');
  });

  it('quita los signos de interrogación de ambos bordes: "¿María?" → "María"', () => {
    expect(sanitizeDictatedName('¿María?')).toBe('María');
  });

  it('quita los signos de exclamación de ambos bordes: "¡Hola!" → "Hola"', () => {
    expect(sanitizeDictatedName('¡Hola!')).toBe('Hola');
  });

  it('quita los puntos suspensivos (…) del final: "Pedro…" → "Pedro"', () => {
    expect(sanitizeDictatedName('Pedro…')).toBe('Pedro');
  });

  it('quita el punto y coma y los dos puntos de borde: ";Luis:" → "Luis"', () => {
    expect(sanitizeDictatedName(';Luis:')).toBe('Luis');
  });

  it('quita las comillas de borde: \'"Sara"\' → "Sara"', () => {
    expect(sanitizeDictatedName('"Sara"')).toBe('Sara');
  });

  it('recorta los espacios en blanco de borde: "  Ana  " → "Ana"', () => {
    expect(sanitizeDictatedName('  Ana  ')).toBe('Ana');
  });

  it('quita puntuación Y espacios de borde combinados: "  Ana,  " → "Ana"', () => {
    expect(sanitizeDictatedName('  Ana,  ')).toBe('Ana');
  });
});

describe('sanitizeDictatedName — CONSERVA letras, tildes, ñ y espacios internos', () => {
  it('conserva el espacio interno de un nombre compuesto: "José María" → "José María" (intacto)', () => {
    expect(sanitizeDictatedName('José María')).toBe('José María');
  });

  it('conserva la ñ: "Begoña" → "Begoña" (intacto)', () => {
    expect(sanitizeDictatedName('Begoña')).toBe('Begoña');
  });

  it('limpia el borde pero conserva el espacio interno: "¿José María?" → "José María"', () => {
    expect(sanitizeDictatedName('¿José María?')).toBe('José María');
  });

  it('un nombre ya limpio no cambia: "Juan" → "Juan"', () => {
    expect(sanitizeDictatedName('Juan')).toBe('Juan');
  });
});

describe('sanitizeDictatedName — casos borde / no rompe', () => {
  it('el string vacío no rompe: "" → ""', () => {
    expect(sanitizeDictatedName('')).toBe('');
  });

  it('un string todo-puntuación colapsa a vacío: "..." → ""', () => {
    expect(sanitizeDictatedName('...')).toBe('');
  });

  it('un string de solo espacios colapsa a vacío: "   " → ""', () => {
    expect(sanitizeDictatedName('   ')).toBe('');
  });
});
