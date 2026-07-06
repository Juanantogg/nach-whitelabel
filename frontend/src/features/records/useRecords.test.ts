/**
 * Tests RED — features/records/useRecords.
 *
 * Máquina de estados del hook de carga del listado (design §"Hook de carga
 * (useRecords)"): `loading | error | empty | success`. Carga al montar (useEffect)
 * llamando a `fetchRecords()`, sin params:
 *   - resuelve con registros  → success (con records)
 *   - resuelve con []          → empty (estado propio, no success con array vacío)
 *   - rechaza (red/HTTP)       → error
 *
 * Se mockea `fetchRecords` (borde: la capa API / red), NO la máquina de estados
 * bajo prueba. Se usa `renderHook` + `waitFor` al estilo de `useNameSubmission.test`.
 *
 * RED esperado: `./useRecords` aún no existe → el import falla y todos los tests
 * quedan en rojo por "módulo ausente".
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecords } from './useRecords';

// --- Mock del borde: la capa API. ---
const fetchRecordsMock = vi.hoisted(() => vi.fn());
vi.mock('../../api/fetchRecords', () => ({
  fetchRecords: fetchRecordsMock,
}));

const DOS_REGISTROS = [
  { sequence: 42, name: 'Juan', createdAt: '2026-07-05T10:12:00.000Z' },
  { sequence: 41, name: 'Ana', createdAt: '2026-07-05T10:08:00.000Z' },
];

describe('useRecords — máquina de estados', () => {
  beforeEach(() => {
    fetchRecordsMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('arranca en loading mientras la carga está pendiente', () => {
    // Promesa que no resuelve: el hook queda en loading.
    fetchRecordsMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRecords());

    expect(result.current.status).toBe('loading');
    // Se dispara la carga al montar, sin params.
    expect(fetchRecordsMock).toHaveBeenCalledTimes(1);
  });

  it('con registros → success exponiendo el array de records', async () => {
    fetchRecordsMock.mockResolvedValue(DOS_REGISTROS);

    const { result } = renderHook(() => useRecords());

    await waitFor(() => expect(result.current.status).toBe('success'));
    if (result.current.status === 'success') {
      expect(result.current.records).toEqual(DOS_REGISTROS);
    }
  });

  it('con array vacío → empty (estado propio, no success con [])', async () => {
    fetchRecordsMock.mockResolvedValue([]);

    const { result } = renderHook(() => useRecords());

    await waitFor(() => expect(result.current.status).toBe('empty'));
    // No es un success con array vacío: el estado es explícitamente empty.
    expect(result.current.status).not.toBe('success');
  });

  it('fetch rechazado (red/HTTP) → error', async () => {
    fetchRecordsMock.mockRejectedValue(new Error('caída de red'));

    const { result } = renderHook(() => useRecords());

    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
