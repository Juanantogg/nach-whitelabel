/**
 * Limpia la puntuación de BORDE del texto DICTADO (nunca del teclado): Whisper/Groq
 * añade puntuación automática al transcribir ("Juan" → "Juan."), así que el camino
 * del dictado recorta los signos de los extremos antes del clamp de 15.
 *
 * Set de borde (decisión del usuario, 2026-07-05): `. , ; : ! ? ¡ ¿ …` más comillas
 * (`" ' « » “ ” ‘ ’`) y espacios en blanco. Solo se recorta desde los extremos hacia
 * dentro: CONSERVA letras, tildes, ñ y los espacios INTERNOS ("José María" intacto).
 */
// Clase de caracteres de borde: puntuación + comillas + espacios en blanco (\s).
const EDGE_CHARS = '.,;:!?¡¿…"\'«»“”‘’\\s';
const EDGE_TRIM = new RegExp(`^[${EDGE_CHARS}]+|[${EDGE_CHARS}]+$`, 'gu');

export function sanitizeDictatedName(text: string): string {
  return text.replace(EDGE_TRIM, '');
}
