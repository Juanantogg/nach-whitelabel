import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Acceptance #6 (theming white-label): "los colores se consumen vía tokens
 * Tailwind (`bg-brand-primary`, `text-brand-primary`, …)". Que el token exista
 * en `@theme` no basta: la UTILIDAD que Tailwind genera para ese token tiene que
 * ser un color CSS VÁLIDO, o el navegador la descarta y la marca no se pinta.
 *
 * Por qué este test y no un render con Testing Library:
 * Vitest + jsdom NO compilan Tailwind ni validan CSS real — jsdom acepta como
 * `color` cualquier string (incluido `rgb(var(--x) / <alpha-value>)`), así que un
 * test de render NUNCA capturaría este bug. Por eso compilamos el `index.css`
 * REAL con el pipeline programático de Tailwind v4 (`compile()`, el mismo motor
 * que usa `@tailwindcss/vite`) y afirmamos sobre el CSS generado.
 *
 * El defecto observable: `@theme inline` define los tokens como
 * `--color-brand-primary: rgb(var(--brand-primary) / <alpha-value>)`. Tailwind v4
 * emite la utilidad con el literal `<alpha-value>` SIN sustituir, produciendo
 * `color: rgb(var(--brand-primary) / <alpha-value>)`. Ese `<alpha-value>` es un
 * placeholder inválido: el navegador rechaza la declaración entera y el color de
 * marca no llega a la CSSOM (verificado en runtime con Playwright: el <h1> con
 * `text-brand-primary` hereda el color en vez de ser morado; el botón con
 * `bg-brand-primary` queda con fondo transparente).
 *
 * RED (hoy): la utilidad contiene `<alpha-value>` → inválida. El test falla.
 * GREEN (tras el arreglo del theming): las utilidades brand producen un color
 * válido sin placeholders → el test pasa. El test afirma el COMPORTAMIENTO ("la
 * utilidad brand es un color usable"), no una solución concreta.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '../../..');
const indexCssPath = path.join(frontendRoot, 'src/index.css');
const tailwindCssPath = path.join(frontendRoot, 'node_modules/tailwindcss/index.css');

// Clases de prueba: una utilidad por token de color de marca, cubriendo
// `color` (text-*) y `background-color` (bg-*).
const PROBE_CLASSES = [
  'text-brand-primary',
  'bg-brand-primary',
  'text-brand-accent',
  'bg-brand-accent',
  'text-brand-text',
  'text-brand-muted',
  'bg-brand-bg',
  'bg-brand-surface',
] as const;

/**
 * Compila `src/index.css` con las clases de prueba usando el motor real de
 * Tailwind v4, resolviendo `@import 'tailwindcss'` contra el paquete instalado.
 */
async function compileBrandUtilities(classes: readonly string[]): Promise<string> {
  const source = readFileSync(indexCssPath, 'utf8');
  const compiler = await compile(source, {
    base: path.dirname(indexCssPath),
    loadStylesheet: (id, base) => {
      const resolved = id === 'tailwindcss' ? tailwindCssPath : path.resolve(base, id);
      return Promise.resolve({
        path: resolved,
        base: path.dirname(resolved),
        content: readFileSync(resolved, 'utf8'),
      });
    },
  });
  return compiler.build([...classes]);
}

/** Extrae el valor de la declaración `prop` dentro de la regla `.className`. */
function declaredValue(css: string, className: string, prop: string): string | null {
  // Escapa el `.` de la clase para el selector.
  const rule = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`, 's').exec(css);
  if (!rule) return null;
  const decl = new RegExp(`${prop}\\s*:\\s*([^;]+);?`, 's').exec(rule[1]);
  return decl ? decl[1].trim() : null;
}

describe('utilidades de color de marca (CSS generado por Tailwind)', () => {
  let css: string;

  beforeAll(async () => {
    css = await compileBrandUtilities(PROBE_CLASSES);
  });

  it('genera una regla para cada utilidad de color de marca probada', () => {
    for (const cls of PROBE_CLASSES) {
      expect(css, `falta la regla .${cls}`).toContain(`.${cls}`);
    }
  });

  it('NO deja el placeholder <alpha-value> sin sustituir en ninguna utilidad', () => {
    // `<alpha-value>` es un token interno de Tailwind que SIEMPRE debe resolverse
    // antes de llegar al CSS final. Si sobrevive, el navegador descarta la
    // declaración y el color de marca no se aplica.
    expect(css).not.toContain('<alpha-value>');
  });

  it('la utilidad text-brand-primary produce un color CSS válido, no un placeholder', () => {
    const value = declaredValue(css, 'text-brand-primary', 'color');
    expect(value, 'no se encontró la declaración color de .text-brand-primary').toBeTruthy();
    // Un color válido no puede contener el marcador literal `<alpha-value>`.
    expect(value).not.toContain('<alpha-value>');
    // Y debe seguir apoyándose en la CSS var de marca (theming en vivo por marca).
    expect(value).toContain('var(--brand-primary)');
  });

  it('la utilidad bg-brand-primary produce un background-color CSS válido, no un placeholder', () => {
    const value = declaredValue(css, 'bg-brand-primary', 'background-color');
    expect(
      value,
      'no se encontró la declaración background-color de .bg-brand-primary',
    ).toBeTruthy();
    expect(value).not.toContain('<alpha-value>');
    expect(value).toContain('var(--brand-primary)');
  });

  it('ninguna declaración de color/background de marca contiene un placeholder inválido', () => {
    const offenders: string[] = [];
    for (const cls of PROBE_CLASSES) {
      const prop = cls.startsWith('bg-') ? 'background-color' : 'color';
      const value = declaredValue(css, cls, prop);
      if (value && value.includes('<alpha-value>')) {
        offenders.push(`.${cls} { ${prop}: ${value} }`);
      }
    }
    expect(offenders, `utilidades con placeholder inválido:\n${offenders.join('\n')}`).toEqual([]);
  });
});
