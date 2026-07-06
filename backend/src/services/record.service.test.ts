/**
 * Tests RED — services/record.service (feature records_list).
 *
 * Deriva de `progress/records_list/design.md` §"Criterios de aceptación
 * traducibles a tests", criterio 5 (backend, service):
 *
 *   `listRecords()` debe consultar el modelo `Record` con:
 *     - proyección que EXCLUYE `_id` (y no trae `__v`/`updatedAt`),
 *     - `.sort({ sequence: -1 })` (más reciente primero),
 *     - `.limit(MAX_RECORDS)` con MAX_RECORDS = 100,
 *     - `.lean()` (objetos planos),
 *   y mapear cada documento a `{ sequence, name, createdAt }` con `createdAt`
 *   como string ISO. Un fallo de Mongo se PROPAGA (throw) para que el controller
 *   responda 500.
 *
 * Estrategia de mock (patrón ESM default-import de Mongoose, MEMORY): el modelo
 * `Record` se importa por default desde `../models/record.model.js`. Se mockea
 * ese especificador con un doble que expone `find`, devolviendo un builder
 * encadenable (`sort`/`limit`/`lean`) para poder ESPIAR con qué argumentos se
 * llama a cada eslabón sin tocar Mongo. El especificador coincide con el que el
 * service de producción debe usar para importar `Record`.
 *
 * MOTIVO DE FALLO ESPERADO (RED legítimo): `./record.service.js` aún NO existe →
 * el import dinámico rechaza y todos los tests quedan en rojo por "módulo
 * ausente". No hay error de sintaxis del test: el mock del modelo está completo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Forma de un documento `.lean()` tal cual lo devolvería Mongo (con Date real). */
interface LeanRecordDoc {
  sequence: number;
  name: string;
  createdAt: Date;
}

/**
 * Builder encadenable que replica la superficie de Mongoose que usa el service:
 * `Record.find(filter, projection).sort(...).limit(...).lean()`. Cada eslabón es
 * una spy que devuelve el propio builder; `lean()` resuelve con el resultado
 * configurado (o rechaza, para el caso de error).
 */
function makeQueryBuilder(result: LeanRecordDoc[] | Error) {
  const sort = vi.fn().mockReturnThis();
  const limit = vi.fn().mockReturnThis();
  const lean = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  return { sort, limit, lean };
}

// `find` es la spy raíz: se reconfigura por test para devolver el builder deseado.
const findMock = vi.fn();

vi.mock('../models/record.model.js', () => ({
  Record: {
    find: (...args: unknown[]): unknown => findMock(...args),
  },
}));

/** Carga fresca del service para que relea el mock del modelo en cada test. */
async function loadService() {
  vi.resetModules();
  return import('./record.service.js');
}

describe('record.service — listRecords (modelo Record mockeado)', () => {
  beforeEach(() => {
    findMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('#5 consulta Record con proyección sin _id, orden sequence desc, limit 100 y lean', async () => {
    const builder = makeQueryBuilder([
      { sequence: 42, name: 'Juan', createdAt: new Date('2026-07-05T10:12:00.000Z') },
    ]);
    findMock.mockReturnValue(builder);

    const { listRecords } = await loadService();
    await listRecords();

    // find se invoca una vez; el segundo argumento (proyección) excluye _id.
    expect(findMock).toHaveBeenCalledTimes(1);
    const projection = findMock.mock.calls[0]?.[1] as Record<string, number> | undefined;
    expect(projection).toBeDefined();
    // _id fuera (0), y las tres columnas dentro (1).
    expect(projection?._id).toBe(0);
    expect(projection?.sequence).toBe(1);
    expect(projection?.name).toBe(1);
    expect(projection?.createdAt).toBe(1);
    // __v y updatedAt no se piden (no aparecen en la proyección).
    expect(projection).not.toHaveProperty('__v');
    expect(projection).not.toHaveProperty('updatedAt');

    // Orden descendente por sequence.
    expect(builder.sort).toHaveBeenCalledWith({ sequence: -1 });
    // Límite duro de 100 (MAX_RECORDS del design).
    expect(builder.limit).toHaveBeenCalledWith(100);
    // lean() para objetos planos.
    expect(builder.lean).toHaveBeenCalledTimes(1);
  });

  it('#5 mapea cada documento a { sequence, name, createdAt } con createdAt como string ISO', async () => {
    const docs: LeanRecordDoc[] = [
      { sequence: 42, name: 'Juan', createdAt: new Date('2026-07-05T10:12:00.000Z') },
      { sequence: 41, name: 'Ana', createdAt: new Date('2026-07-05T10:08:00.000Z') },
    ];
    findMock.mockReturnValue(makeQueryBuilder(docs));

    const { listRecords } = await loadService();
    const result = await listRecords();

    expect(result).toEqual([
      { sequence: 42, name: 'Juan', createdAt: '2026-07-05T10:12:00.000Z' },
      { sequence: 41, name: 'Ana', createdAt: '2026-07-05T10:08:00.000Z' },
    ]);
    // createdAt es string (ISO), no Date.
    expect(typeof result[0]?.createdAt).toBe('string');
  });

  it('#5 respeta el orden que devuelve Mongo (no reordena en el mapeo)', async () => {
    const docs: LeanRecordDoc[] = [
      { sequence: 99, name: 'Zoe', createdAt: new Date('2026-07-05T12:00:00.000Z') },
      { sequence: 3, name: 'Bea', createdAt: new Date('2026-07-05T09:00:00.000Z') },
    ];
    findMock.mockReturnValue(makeQueryBuilder(docs));

    const { listRecords } = await loadService();
    const result = await listRecords();

    expect(result.map((r) => r.sequence)).toEqual([99, 3]);
  });

  it('devuelve [] cuando la colección está vacía', async () => {
    findMock.mockReturnValue(makeQueryBuilder([]));

    const { listRecords } = await loadService();
    const result = await listRecords();

    expect(result).toEqual([]);
  });

  it('propaga (throw) un fallo de Mongo para que el controller responda 500', async () => {
    findMock.mockReturnValue(makeQueryBuilder(new Error('mongo caído')));

    const { listRecords } = await loadService();

    await expect(listRecords()).rejects.toThrow();
  });
});
