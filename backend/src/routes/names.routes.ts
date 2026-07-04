import { Router } from 'express';
import { postName } from '../controllers/crypto.controller.js';

/** Recibe el nombre cifrado y devuelve el consecutivo cifrado. Se monta en `/names`. */
export const namesRouter = Router();

namesRouter.post('/', postName);
