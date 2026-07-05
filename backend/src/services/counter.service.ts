import { Counter } from '../models/counter.model.js';
import { Record } from '../models/record.model.js';

/** Nombre lógico de la secuencia del consecutivo en la colección `counters`. */
const SEQUENCE_ID = 'records';

/**
 * Reserva el siguiente consecutivo (atómico) y persiste el registro. Devuelve el
 * número asignado. Cualquier fallo de Mongo se propaga (throw) para que el
 * controller responda 500 sin entregar un número no persistido.
 */
export async function createRecord(name: string): Promise<number> {
  // Reserva atómica del número: `$inc` sobre el mismo `_id` está serializado por
  // MongoDB, así que dos peticiones concurrentes nunca leen el mismo `seq`.
  const counter = await Counter.findOneAndUpdate(
    { _id: SEQUENCE_ID },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  ).lean();

  const sequence = counter.seq;
  await Record.create({ sequence, name });
  return sequence;
}
