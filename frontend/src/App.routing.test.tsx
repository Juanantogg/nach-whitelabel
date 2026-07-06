/**
 * Tests RED — App routing (feature records_list, ADR 27).
 *
 * Deriva del design §"Router (ADR 27)" y del criterio de frontend 13:
 *   - navegar a `/`        → renderiza WelcomeScreen.
 *   - navegar a `/records` → renderiza RecordsList.
 *   - la ruta `/records` NO está listada: no existe ningún <Link>/<a> hacia
 *     `/records` en el árbol de WelcomeScreen.
 *
 * `App` pasa de renderizar `<WelcomeScreen />` directo a declarar `<Routes>` con
 * las dos rutas. El `<BrowserRouter>` lo pone `main.tsx`; aquí se usa
 * `<MemoryRouter initialEntries=[...]>` para conducir la ruta desde el test sin
 * tocar `window.location`.
 *
 * Se mockean `WelcomeScreen` y `RecordsList` con marcadores simples: aquí se prueba
 * el RUTEO (qué pantalla se monta en cada path), no el contenido de cada pantalla,
 * que ya tiene sus propios tests. El mock de WelcomeScreen incluye a propósito un
 * <a href="/"> (link legítimo) para asegurar que la aserción "no hay link a
 * /records" no es un falso positivo por ausencia total de anclas. Este fichero está
 * SEPARADO de `App.test.tsx` porque mockea las pantallas a nivel de módulo (los
 * `vi.mock` se hoistean y chocarían con la prueba de integración de welcome).
 *
 * MOTIVO DE FALLO ESPERADO (RED legítimo): doble causa hasta el GREEN —
 *   (1) `react-router-dom` aún NO está instalado (ADR 27: dep nueva que instala el
 *       implementer), así que `import { MemoryRouter }` no resuelve; y
 *   (2) `App.tsx` todavía renderiza `<WelcomeScreen />` directo, sin `<Routes>`,
 *       por lo que `/records` no montaría RecordsList.
 * Ambas se resuelven en GREEN. El fallo es por ausencia de código/dep, no por un
 * error del propio test.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

// --- Mocks de las pantallas: marcadores para verificar el ruteo. ---
vi.mock('./features/welcome/WelcomeScreen', () => ({
  WelcomeScreen: () => (
    <div data-testid="welcome-screen">
      welcome
      {/* Link legítimo a la home: existe un ancla, pero NINGUNA apunta a /records. */}
      <a href="/">inicio</a>
    </div>
  ),
}));

vi.mock('./features/records/RecordsList', () => ({
  RecordsList: () => <div data-testid="records-list">records</div>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App — ruteo de pantallas (criterio 13, ADR 27)', () => {
  it('en "/" renderiza WelcomeScreen y NO RecordsList', () => {
    renderAt('/');
    expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('records-list')).not.toBeInTheDocument();
  });

  it('en "/records" renderiza RecordsList y NO WelcomeScreen', () => {
    renderAt('/records');
    expect(screen.getByTestId('records-list')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();
  });

  it('la ruta /records NO está listada: WelcomeScreen no tiene ningún link hacia /records', () => {
    renderAt('/');
    const welcome = screen.getByTestId('welcome-screen');
    const links = welcome.querySelectorAll('a[href]');
    const hrefs = Array.from(links).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((href) => href.includes('/records'))).toBe(false);
  });
});
