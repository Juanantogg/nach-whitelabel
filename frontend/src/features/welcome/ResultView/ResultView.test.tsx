/**
 * Tests RED — features/welcome/ResultView.
 *
 * Deriva de welcome_screen (acceptance #3: "número mostrado" y estado success de
 * design.md). `ResultView` muestra el consecutivo descifrado acompañado del texto
 * de marca `text.resultLabel`. Cero literales: la etiqueta viene de la config.
 *
 * RED esperado: `./ResultView` aún no existe → import falla, tests en rojo.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../../brand/ThemeProvider';
import { parseBrandConfig } from '../../../brand/core/schema';
import shopinbazSeed from '../../../brand/seeds/shopinbaz.json';
import { ResultView } from './ResultView';

const brand = parseBrandConfig(shopinbazSeed);

function renderResult(numero: string) {
  return render(
    <ThemeProvider config={brand}>
      <ResultView numero={numero} />
    </ThemeProvider>,
  );
}

describe('ResultView — muestra el número descifrado (acceptance #3)', () => {
  it('renderiza el número consecutivo recibido', () => {
    renderResult('7');
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('acompaña el número con la etiqueta de marca (text.resultLabel, cero literal)', () => {
    renderResult('42');
    expect(screen.getByText(brand.text.resultLabel)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
