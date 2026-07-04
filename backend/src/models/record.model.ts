import mongoose, { Schema, type Model } from 'mongoose';

/**
 * Registro persistido por petición válida: el consecutivo entregado (`sequence`,
 * índice único como red contra colisiones) y el nombre ya descifrado (`name`,
 * maxlength 15 como defensa en profundidad frente a la validación del controller).
 */
export interface RecordDoc {
  sequence: number;
  name: string;
}

const recordSchema = new Schema<RecordDoc>(
  {
    sequence: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, maxlength: 15 },
  },
  { timestamps: true },
);

// Idempotente: reutiliza el modelo ya compilado si el módulo se reevalúa
// (los tests usan `vi.resetModules()` + reimport de la app).
export const Record =
  (mongoose.models.Record as Model<RecordDoc> | undefined) ??
  mongoose.model<RecordDoc>('Record', recordSchema, 'records');
