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
        // Aviso unificado (teclado y voz) cuando el nombre llega al tope de 15
        // (ADR 25). Interpola {max} igual que counterTemplate. Con `.default()`
        // ninguna marca existente edita su JSON (marca nueva = un JSON).
        maxLengthReached: z.string().default('Máximo {max} caracteres'),
        // Textos del flujo de welcome_screen que las maquetas no muestran
        // (solo capturan el estado inicial). Con `.default()` por campo se
        // mantiene el principio "marca nueva = un JSON" sin tocar componentes.
        resultLabel: z.string().default('Tu número de registro es:'),
        loadingLabel: z.string().default('Procesando…'),
        errorGeneric: z.string().default('No pudimos procesarlo. Inténtalo de nuevo.'),
        errorNetwork: z.string().default('Sin conexión. Revisa tu internet e inténtalo.'),
        retryLabel: z.string().default('Reintentar'),
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

    voice: z
      .object({
        // Etiqueta accesible del botón de dictado (aria-label / tooltip).
        startLabel: z.string().default('Dictar mi nombre'),
        // Etiqueta mientras escucha (para el toggle del botón).
        listeningLabel: z.string().default('Escuchando…'),
        // Etiqueta mientras se transcribe el audio del fallback por IA (Firefox/
        // Brave). Estado sin equivalente en el flujo nativo. Con `.default()`
        // ninguna marca existente edita su JSON (marca nueva = un JSON).
        transcribingLabel: z.string().default('Transcribiendo…'),
        // Errores mostrables (la UI decide cuáles enseñar).
        permissionDenied: z
          .string()
          .default('No pudimos usar el micrófono. Revisa los permisos o escribe tu nombre.'),
        noSpeech: z.string().default('No te escuchamos. Inténtalo de nuevo o escribe tu nombre.'),
        genericError: z.string().default('Hubo un problema con el dictado. Escribe tu nombre.'),
        // Texto/aria cuando el navegador no soporta la API.
        unsupported: z.string().default('El dictado por voz no está disponible en este navegador.'),
        // Locale BCP-47 del reconocimiento.
        lang: z.string().default('es-ES'),
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
