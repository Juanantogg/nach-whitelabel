/**
 * Tests RED — features/records/RecordsList.
 *
 * Render y estados de la pantalla del listado (design §"Layout de RecordsList" y
 * criterios de frontend 8-12):
 *   #8  loading → texto text.records.loading en región aria-live.
 *   #9  success → cabeceras nameHeader/numberHeader + una fila por registro con
 *       nombre COMPLETO (sin enmascarar, ADR 26) y su número.
 *   #10 empty   → texto text.records.empty, sin filas.
 *   #11 error   → role="alert" con text.records.error.
 *   #12 multi-marca: el MISMO componente bajo shopinbaz y bajo elektra muestra los
 *       textos de cada marca (cero literales); el fuente no tiene hex ni strings
 *       visibles hardcodeados.
 *
 * Se mockea `useRecords` (la carga async ya se prueba aislada en su propio test)
 * para conducir la máquina de estados desde el test. NO se mockea el consumo de la
 * config de marca, que es lo que aquí se verifica (cero literales). Se envuelve en
 * `<ThemeProvider>`, patrón idéntico a WelcomeScreen/ResultView.
 *
 * RED esperado: `./RecordsList` (ni `../useRecords`) existen aún → el import falla
 * y todos los tests quedan en rojo por "módulo ausente".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../../brand/ThemeProvider';
import { parseBrandConfig, type BrandConfig } from '../../../brand/core/schema';
import shopinbazSeed from '../../../brand/seeds/shopinbaz.json';
import elektraSeed from '../../../brand/seeds/elektra.json';
import { RecordsList } from './RecordsList';

// --- Mock del hook de carga: conduce la máquina de estados desde el test. ---
type RecordItem = { sequence: number; name: string; createdAt: string };
type RecordsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'success'; records: RecordItem[] };

const recordsMock = vi.hoisted<{ state: RecordsState }>(() => ({
  state: { status: 'loading' },
}));

vi.mock('../useRecords', () => ({
  useRecords: () => recordsMock.state,
}));

const shopinbazConfig = parseBrandConfig(shopinbazSeed);
const elektraConfig = parseBrandConfig(elektraSeed);

function renderList(config: BrandConfig = shopinbazConfig) {
  return render(
    <ThemeProvider config={config}>
      <RecordsList />
    </ThemeProvider>,
  );
}

const DOS_REGISTROS: RecordItem[] = [
  { sequence: 42, name: 'Juan', createdAt: '2026-07-05T10:12:00.000Z' },
  { sequence: 41, name: 'Ana', createdAt: '2026-07-05T10:08:00.000Z' },
];

beforeEach(() => {
  recordsMock.state = { status: 'loading' };
});

afterEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('RecordsList — estado loading (criterio 8)', () => {
  it('muestra text.records.loading en una región aria-live', () => {
    recordsMock.state = { status: 'loading' };
    renderList();

    const loading = screen.getByText(shopinbazConfig.text.records.loading);
    expect(loading).toBeInTheDocument();
    // El texto de carga vive en (o dentro de) una región aria-live.
    const liveRegion = loading.closest('[aria-live]');
    expect(liveRegion).not.toBeNull();
  });
});

describe('RecordsList — estado success con registros (criterio 9, ADR 26)', () => {
  beforeEach(() => {
    recordsMock.state = { status: 'success', records: DOS_REGISTROS };
  });

  it('renderiza las cabeceras de marca nameHeader y numberHeader (cero literal)', () => {
    renderList();
    expect(screen.getByText(shopinbazConfig.text.records.nameHeader)).toBeInTheDocument();
    expect(screen.getByText(shopinbazConfig.text.records.numberHeader)).toBeInTheDocument();
  });

  it('renderiza una fila por registro con el nombre COMPLETO (sin enmascarar) y su número', () => {
    renderList();

    // Nombres completos, tal cual (ADR 26: sin enmascarar).
    expect(screen.getByText('Juan')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    // Y sus números consecutivos.
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
  });

  it('muestra el título de pantalla de marca (text.records.title)', () => {
    renderList();
    expect(screen.getByText(shopinbazConfig.text.records.title)).toBeInTheDocument();
  });
});

describe('RecordsList — estado empty (criterio 10)', () => {
  it('muestra text.records.empty y no renderiza filas de datos', () => {
    recordsMock.state = { status: 'empty' };
    renderList();

    expect(screen.getByText(shopinbazConfig.text.records.empty)).toBeInTheDocument();
    // Sin registros: los nombres de ejemplo no aparecen.
    expect(screen.queryByText('Juan')).not.toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });
});

describe('RecordsList — estado error (criterio 11)', () => {
  it('muestra text.records.error dentro de un role="alert"', () => {
    recordsMock.state = { status: 'error' };
    renderList();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(shopinbazConfig.text.records.error);
  });
});

describe('RecordsList — render multi-marca (criterio 12)', () => {
  it.each([
    ['shopinbaz', shopinbazConfig],
    ['elektra', elektraConfig],
  ] as const)('el MISMO componente muestra las cabeceras y el título de %s', (_name, config) => {
    recordsMock.state = { status: 'success', records: DOS_REGISTROS };
    const { unmount } = renderList(config);

    expect(screen.getByText(config.text.records.title)).toBeInTheDocument();
    expect(screen.getByText(config.text.records.nameHeader)).toBeInTheDocument();
    expect(screen.getByText(config.text.records.numberHeader)).toBeInTheDocument();
    unmount();
  });

  it('el fuente del componente no contiene colores hex ni textos visibles hardcodeados', () => {
    // Vitest corre con cwd = raíz del paquete @nach/frontend.
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/records/RecordsList/RecordsList.tsx'),
      'utf8',
    );

    // Cero colores hex en el componente (los colores son tokens de marca).
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Cero copys hardcodeados de los textos de este listado.
    for (const text of [
      shopinbazConfig.text.records.title,
      shopinbazConfig.text.records.nameHeader,
      shopinbazConfig.text.records.numberHeader,
      shopinbazConfig.text.records.loading,
      shopinbazConfig.text.records.error,
      shopinbazConfig.text.records.empty,
    ]) {
      expect(source).not.toContain(text);
    }
  });
});

describe('RecordsList — datos tabulares accesibles (criterio 9)', () => {
  it('las cabeceras y los datos coexisten en la misma vista de listado', () => {
    recordsMock.state = { status: 'success', records: DOS_REGISTROS };
    const { container } = renderList();

    // No se fija el tag exacto (table vs lista ARIA — decide el implementer);
    // se afirma que cabeceras y datos están presentes en el mismo árbol.
    const scoped = within(container);
    expect(scoped.getByText(shopinbazConfig.text.records.nameHeader)).toBeInTheDocument();
    expect(scoped.getByText('Juan')).toBeInTheDocument();
  });
});
