/**
 * Límite común a TODAS las marcas para el nombre del usuario (maquetas:
 * "0/15 caracteres"). No es config de marca: es una regla del producto y lo
 * consume la welcome_screen. La config solo aporta la plantilla del contador.
 */
export const NAME_MAX_LENGTH = 15;

/**
 * Base URL del bucket S3/CloudFront donde viven los JSON de marca en producción.
 * La infraestructura real es de la feature `deploy`; aquí es el punto único de
 * configuración de la URL.
 */
export const S3_BASE_URL = 'https://brands.garcia3apps.com';

/**
 * Dominio base de la app en producción. `resolveBrand` cuenta labels contra él
 * para distinguir un subdominio de marca (`elektra.garcia3apps.com`) del apex o
 * `www` (que caen al default). Se inyecta en `resolveBrand` desde `main.tsx`.
 */
export const BASE_DOMAIN = 'garcia3apps.com';
