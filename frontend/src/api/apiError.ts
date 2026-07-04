/**
 * Error tipado de la capa API. No es un `Error` genérico para que la UI/
 * ErrorBoundary pueda distinguir fallos de red/HTTP de otros.
 *
 * Convención de `status`:
 *  - `0`      → red caída / sin respuesta HTTP (fetch rechazado).
 *  - `>= 400` → respuesta HTTP no-ok (el número es el status del servidor).
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
  }
}
