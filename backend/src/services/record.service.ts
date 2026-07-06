import { Record } from '../models/record.model.js';

/** Cota dura de registros devueltos: evita traer una colección entera si crece. */
const MAX_RECORDS = 100;

/** Item plano de la respuesta de `/records` (design: nombre completo, ADR 26). */
export interface RecordListItem {
  sequence: number;
  name: string;
  createdAt: string;
}

/** Documento tal cual lo devuelve `.lean()` (Date real en `createdAt`). */
interface LeanRecordDoc {
  sequence: number;
  name: string;
  createdAt: Date;
}

/**
 * Lee los registros persistidos, más reciente primero, hasta `MAX_RECORDS`.
 * Proyección sin `_id`/`__v`/`updatedAt` (solo lo que expone el contrato) y
 * `.lean()` para objetos planos. `createdAt` se serializa a string ISO. Cualquier
 * fallo de Mongo se propaga (throw) para que el controller responda 500.
 */
export async function listRecords(): Promise<RecordListItem[]> {
  const docs = (await Record.find({}, { sequence: 1, name: 1, createdAt: 1, _id: 0 })
    .sort({ sequence: -1 })
    .limit(MAX_RECORDS)
    .lean()) as unknown as LeanRecordDoc[];

  return docs.map((doc) => ({
    sequence: doc.sequence,
    name: doc.name,
    createdAt: new Date(doc.createdAt).toISOString(),
  }));
}
