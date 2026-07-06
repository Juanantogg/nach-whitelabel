import type { Request, Response } from 'express';
import { listRecords } from '../services/record.service.js';

/**
 * GET /records — devuelve el listado de registros (nombre + consecutivo) leído de
 * Mongo, ordenado desc. Un fallo del service se traduce a 500 con el contrato
 * `{ error: 'internal_error' }`, sin filtrar detalle interno.
 */
export async function getRecords(_req: Request, res: Response): Promise<void> {
  try {
    const records = await listRecords();
    res.status(200).json(records);
  } catch {
    res.status(500).json({ error: 'internal_error' });
  }
}
