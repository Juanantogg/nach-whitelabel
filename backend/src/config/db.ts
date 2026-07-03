import mongoose from 'mongoose';
import { env } from './env.js';

/**
 * Conecta a MongoDB Atlas. Se llama en el bootstrap del servidor, no en `app`,
 * para que los tests de endpoints no dependan de una base de datos real.
 */
export async function connectDb(): Promise<void> {
  if (!env.mongodbUri) {
    throw new Error('MONGODB_URI no está definida. Revisa tu archivo .env');
  }
  await mongoose.connect(env.mongodbUri);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
