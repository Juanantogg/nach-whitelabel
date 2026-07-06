import { useEffect, useState } from 'react';
import { fetchRecords, type RecordItem } from '../../api/fetchRecords';

/**
 * Máquina de estados explícita del listado. `empty` es un estado propio (no un
 * `success` con array vacío) para que el render sea un branch trivial por estado.
 */
export type RecordsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'success'; records: RecordItem[] };

/**
 * Carga los registros al montar (`useEffect`, sin params). Traduce el resultado a
 * la máquina de estados: array con datos → `success`; array vacío → `empty`;
 * rechazo de red/HTTP → `error`. Guarda anti-set-tras-desmontar con un flag.
 */
export function useRecords(): RecordsState {
  const [state, setState] = useState<RecordsState>({ status: 'loading' });

  useEffect(() => {
    let activo = true;

    fetchRecords()
      .then((records) => {
        if (!activo) return;
        setState(records.length === 0 ? { status: 'empty' } : { status: 'success', records });
      })
      .catch(() => {
        if (!activo) return;
        setState({ status: 'error' });
      });

    return () => {
      activo = false;
    };
  }, []);

  return state;
}
