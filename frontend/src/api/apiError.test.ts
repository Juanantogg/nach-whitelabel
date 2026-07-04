/**
 * Tests RED — api/apiError (forma de error consistente de la capa API).
 *
 * Mapea acceptance del design:
 *  #5/#6 (parcial) `ApiError` es un Error tipado con `status` y preserva `cause`.
 *
 * RED esperado: `./apiError` aún no existe → import falla, tests en rojo.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from './apiError';

describe('ApiError', () => {
  it('es instancia de Error (la UI/ErrorBoundary puede distinguirlo)', () => {
    const err = new ApiError('boom', 500);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('boom');
  });

  it('expone el status HTTP', () => {
    const err = new ApiError('El servidor respondió con un error (HTTP 404)', 404);

    expect(err.status).toBe(404);
  });

  it('usa status 0 como convención de "sin respuesta" (red caída)', () => {
    const err = new ApiError('No se pudo conectar con el servidor', 0);

    expect(err.status).toBe(0);
  });

  it('preserva la causa original cuando se pasa por options', () => {
    const cause = new TypeError('Failed to fetch');
    const err = new ApiError('No se pudo conectar con el servidor', 0, { cause });

    expect(err.cause).toBe(cause);
  });
});
