import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Fallback opcional: nodo o render-prop. Si se omite, usa el fallback neutro. */
  fallback?: ReactNode | ((error: Error) => ReactNode);
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Última línea de defensa: captura errores de RENDER de sus hijos para que un
 * fallo (de render, cifrado o red que burbujee en render) no deje la app en
 * blanco. NO captura errores async fuera del ciclo de render (esos los maneja la
 * capa `api` con `ApiError` y el estado del componente).
 *
 * El fallback por defecto es NEUTRO (no de marca) y en español: el boundary raíz
 * puede dispararse ANTES de que la `BrandConfig` esté resuelta, o justo porque el
 * theming falló, así que no puede depender de tokens/textos de marca. Usa tokens
 * de tema en className cuando existan y estilos inline neutros de respaldo para
 * garantizar contraste aunque las CSS variables de marca no estén inyectadas.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Loguear para diagnóstico; nunca filtrar el detalle a la UI.
    console.error('ErrorBoundary capturó un error de render:', error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error === null) {
      return children;
    }

    if (fallback !== undefined) {
      return typeof fallback === 'function' ? fallback(error) : fallback;
    }

    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center"
        style={{ backgroundColor: '#ffffff', color: '#1a1a1a' }}
      >
        <h1 className="text-2xl font-semibold">Algo salió mal</h1>
        <p className="max-w-md">Vuelve a intentarlo recargando la página.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md px-5 py-2 font-medium"
          style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
        >
          Recargar
        </button>
      </div>
    );
  }
}
