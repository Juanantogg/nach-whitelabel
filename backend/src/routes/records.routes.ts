import { Router } from 'express';
import { getRecords } from '../controllers/records.controller.js';

/** Listado de registros generados (lectura idempotente). Se monta en `/records`. */
export const recordsRouter = Router();

recordsRouter.get('/', getRecords);
