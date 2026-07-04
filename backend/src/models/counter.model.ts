import mongoose, { Schema, type Model } from 'mongoose';

/**
 * Secuencia atómica del consecutivo. Una fila por nombre lógico de secuencia
 * (`_id`, p.ej. "records"); `seq` es el último valor entregado. El siguiente
 * número se reserva con un `findOneAndUpdate` + `$inc` atómico (sin colisiones
 * bajo concurrencia).
 */
export interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

// Idempotente: reutiliza el modelo ya compilado si el módulo se reevalúa
// (los tests usan `vi.resetModules()` + reimport de la app).
export const Counter =
  (mongoose.models.Counter as Model<CounterDoc> | undefined) ??
  mongoose.model<CounterDoc>('Counter', counterSchema, 'counters');
