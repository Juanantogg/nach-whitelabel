import { Router } from 'express';
import { getPublicKey } from '../controllers/crypto.controller.js';

/** Rutas del esquema de cifrado. Se monta en `/crypto`. */
export const cryptoRouter = Router();

cryptoRouter.get('/public-key', getPublicKey);
