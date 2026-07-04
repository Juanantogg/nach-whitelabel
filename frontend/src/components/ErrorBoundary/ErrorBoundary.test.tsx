/**
 * Tests RED — components/ErrorBoundary (última línea de defensa; la app nunca
 * queda en blanco ante un fallo de render).
 *
 * Mapea acceptance del design:
 *  #9  hijo que lanza en render → muestra el fallback (neutro por defecto; el
 *      pasado por prop si se provee) y NO propaga el crash.
 *  #10 hijos sanos → se renderizan sin interferencia.
 *  #11 el fallback por defecto es copy neutro en español (no de marca).
 *
 * Nota: React logea el error a consola en boundaries; silenciamos console.error
 * en el test que lo dispara para no ensuciar el output, restaurándolo después.
 *
 * RED esperado: `./ErrorBoundary` aún no existe → import falla, tests en rojo.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// Componente que lanza en render para forzar el boundary.
function Boom(): never {
  throw new Error('fallo de render simulado');
}

describe('ErrorBoundary', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React vuelca el error a console.error dentro del boundary; lo silenciamos.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('renderiza a los hijos sanos sin interferencia', () => {
    render(
      <ErrorBoundary>
        <p>contenido normal</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('contenido normal')).toBeInTheDocument();
  });

  it('ante un hijo que lanza en render muestra el fallback neutro y no propaga el crash', () => {
    // No debe lanzar hacia arriba: render() completa sin throw.
    expect(() =>
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      ),
    ).not.toThrow();

    // Copy neutro en español (no de marca): título de última línea de defensa.
    expect(screen.getByText(/algo salió mal/i)).toBeInTheDocument();
  });

  it('usa el fallback provisto por prop en lugar del neutro', () => {
    render(
      <ErrorBoundary fallback={<p>fallback personalizado</p>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('fallback personalizado')).toBeInTheDocument();
    // Y NO muestra el fallback neutro por defecto.
    expect(screen.queryByText(/algo salió mal/i)).not.toBeInTheDocument();
  });
});
