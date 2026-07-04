import { z } from 'zod';

/**
 * Canales RGB en formato "R G B" (tres enteros 0-255 separados por espacio),
 * compatibles con la opacidad de Tailwind (`bg-brand-primary/50`) y con los
 * tokens `@theme` ya declarados en `index.css`.
 */
const rgbChannels = z.string().regex(/^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/);

/**
 * Key de marca ABIERTA (Rev.2 — identidad de marca abierta, S3 manda): en prod
 * es el subdominio tal cual y el bucket S3 dicta qué keys existen. No se valida
 * contra una lista cerrada; la única red de validación es `brandConfigSchema`.
 */
export type BrandKey = string;

/**
 * Schema de la config de marca. Todos los campos tienen `.default()` y cada
 * bloque anidado usa `.prefault({})` para que un JSON parcial (o `{}`/`undefined`)
 * produzca una `BrandConfig` completa y usable (los defaults internos se
 * disparan al re-parsear).
 *
 * Los defaults describen la marca genérica NEUTRA (coherente con
 * `data/default.json`), no la identidad de ningún cliente.
 */
export const brandConfigSchema = z
  .object({
    key: z.string().default('default'),
    name: z.string().default('Marca'),

    text: z
      .object({
        title: z.string().default('¡Te damos la bienvenida!'),
        subtitle: z
          .string()
          .default('Usa tu préstamo como dinero en efectivo o compra en donde quieras.'),
        namePrompt: z.string().default('¿Cómo prefieres que te llamemos?'),
        inputPlaceholder: z.string().default('Escribe tu nombre'),
        submitLabel: z.string().default('Comenzar'),
        counterTemplate: z.string().default('{count}/{max} caracteres'),
      })
      .prefault({}),

    colors: z
      .object({
        bg: rgbChannels.default('23 22 26'),
        surface: rgbChannels.default('38 36 43'),
        primary: rgbChannels.default('124 92 252'),
        accent: rgbChannels.default('124 92 252'),
        text: rgbChannels.default('245 245 247'),
        muted: rgbChannels.default('148 143 156'),
      })
      .prefault({}),

    style: z
      .object({
        radius: z.string().default('0.75rem'),
        fontFamily: z.string().default('system-ui, sans-serif'),
        titleWeight: z.string().default('700'),
        buttonVariant: z.enum(['solid', 'soft']).default('soft'),
      })
      .prefault({}),

    assets: z
      .object({
        logo: z.string().default('/brands/default/logo.svg'),
        illustration: z.string().default('/brands/default/illustration.svg'),
        logoAlt: z.string().default('Marca'),
        illustrationAlt: z.string().default('Ilustración de bienvenida'),
      })
      .prefault({}),
  })
  .prefault({});

export type BrandConfig = z.infer<typeof brandConfigSchema>;

/**
 * Valida y normaliza una config de marca cruda. Usa `.parse` (no `.safeParse`)
 * para que cualquier fallo de validación lance y sea capturado por el loader,
 * cayendo al mismo camino de fallback que un fetch fallido.
 */
export function parseBrandConfig(raw: unknown): BrandConfig {
  return brandConfigSchema.parse(raw);
}
