import type { Request, Response } from 'express';

/** Endpoint de liveness para health-checks y para verificar el deploy. */
export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', service: 'nach-backend' });
}
