import { describe, expect, expectTypeOf, it } from 'vitest';
import { brandConfigSchema, parseBrandConfig, type BrandConfig, type BrandKey } from './schema';

/**
 * Acceptance #1: "Existe un schema Zod (brandConfigSchema) con .default() por
 * campo; valida textos, colores, estilos visuales e ilustración/logo".
 *
 * Y acceptance #3 (parcial): "JSON parcial → Zod rellena con defaults y la
 * marca es usable".
 *
 * Rev.2 (identidad de marca abierta): `BrandKey = string`, se ELIMINA el
 * `brandKeySchema = z.enum([...])`. La única red de validación es
 * `brandConfigSchema`. El resto del schema (campos, defaults, prefault,
 * rgbChannels, parseBrandConfig) NO cambia.
 *
 * Estos tests prueban el MECANISMO del schema (defaults por campo, tolerancia de
 * un parcial, rechazo de formato inválido), NO el copy concreto de los defaults.
 * La fuente de verdad de un default es el propio `parseBrandConfig({})`: así,
 * cambiar el texto/color por defecto NO rompe el test del mecanismo "rellena
 * defaults". Los valores exactos de cada marca se anclan en los seeds.
 *
 * RED (Rev.2): la migración del schema (quitar el enum, `BrandKey = string`)
 * aún está pendiente, así que los tests de identidad abierta fallan hasta que el
 * implementer migre.
 */
describe('BrandKey — identidad de marca abierta (Rev.2)', () => {
  it('BrandKey es un string abierto: cualquier key compila (sin enum cerrado)', () => {
    // Si BrandKey siguiera siendo z.enum(['shopinbaz','elektra']), esto NO
    // compilaría. Rev.2 exige BrandKey = string.
    expectTypeOf<BrandKey>().toEqualTypeOf<string>();
    const arbitraria: BrandKey = 'banco_azteca';
    expect(typeof arbitraria).toBe('string');
  });

  it('la config parseada acepta una key arbitraria (no unión cerrada)', () => {
    const config: BrandConfig = parseBrandConfig({ key: 'marca-cualquiera' });
    expect(config.key).toBe('marca-cualquiera');
  });
});

describe('brandConfigSchema / parseBrandConfig', () => {
  it('rellena todos los campos con defaults cuando recibe un objeto vacío', () => {
    const config = parseBrandConfig({});

    // Ancla del mecanismo: cada bloque queda presente y usable (no vacío).
    expect(config.text.title.length).toBeGreaterThan(0);
    expect(config.text.submitLabel.length).toBeGreaterThan(0);
    expect(config.colors.primary).toMatch(/^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/);
    expect(config.style.radius.length).toBeGreaterThan(0);
    expect(config.assets.logo.length).toBeGreaterThan(0);
  });

  it('no lanza y devuelve la MISMA config por defecto que un objeto vacío', () => {
    expect(() => parseBrandConfig(undefined)).not.toThrow();

    // Mecanismo: undefined y {} deben producir la config por defecto completa.
    // La fuente de verdad del default es parseBrandConfig({}), no un literal.
    expect(parseBrandConfig(undefined)).toEqual(parseBrandConfig({}));
    expect(parseBrandConfig(undefined).text.title.length).toBeGreaterThan(0);
  });

  it('conserva un valor parcial de text y rellena el resto con los defaults del schema', () => {
    const defaults = parseBrandConfig({});
    const config = parseBrandConfig({ text: { title: 'X' } });

    // El valor provisto se respeta.
    expect(config.text.title).toBe('X');
    // Los sub-campos no provistos igualan el default del schema (no un literal).
    expect(config.text.submitLabel).toBe(defaults.text.submitLabel);
    expect(config.text.inputPlaceholder).toBe(defaults.text.inputPlaceholder);
    // Los demás bloques quedan intactos respecto al default → marca usable.
    expect(config.colors).toEqual(defaults.colors);
    expect(config.assets).toEqual(defaults.assets);
  });

  it('rechaza un color con formato inválido (no "R G B")', () => {
    expect(() => brandConfigSchema.parse({ colors: { primary: 'morado' } })).toThrow();
  });

  it('acepta un color válido en formato "R G B"', () => {
    const config = parseBrandConfig({ colors: { primary: '1 2 3' } });
    expect(config.colors.primary).toBe('1 2 3');
  });
});

/**
 * Contrato de marca de welcome_screen (design.md → decisión aprobada #1).
 *
 * La pantalla de bienvenida necesita textos que las maquetas NO muestran (solo
 * capturan el estado inicial): la etiqueta del resultado, el label del botón en
 * carga, los dos mensajes de error (genérico y de red) y el label de reintento.
 * Se añaden al bloque `text` con `.default()` por campo, para no romper el
 * principio "marca nueva = un JSON" ni tocar componentes.
 *
 * RED: falla hasta que el implementer de brand añada esos cinco campos al
 * `brandConfigSchema`. Aquí se prueba el MECANISMO (existencia + relleno por
 * defaults + preservación de un parcial), no el copy exacto: la fuente de verdad
 * del default es `parseBrandConfig({}).text`.
 */
describe('brandConfigSchema — textos de flujo de welcome_screen (decisión #1)', () => {
  it('un JSON sin esos textos produce una BrandConfig con los cinco campos completos y usables', () => {
    const config = parseBrandConfig({});

    // Los cinco campos existen y traen un default no vacío → marca usable sin declararlos.
    expect(config.text.resultLabel.length).toBeGreaterThan(0);
    expect(config.text.loadingLabel.length).toBeGreaterThan(0);
    expect(config.text.errorGeneric.length).toBeGreaterThan(0);
    expect(config.text.errorNetwork.length).toBeGreaterThan(0);
    expect(config.text.retryLabel.length).toBeGreaterThan(0);
  });

  it('conserva valores parciales de esos textos y rellena el resto con los defaults del schema', () => {
    const defaults = parseBrandConfig({});
    const config = parseBrandConfig({ text: { retryLabel: 'Volver a intentar' } });

    // El valor provisto se respeta.
    expect(config.text.retryLabel).toBe('Volver a intentar');
    // Los sub-campos no provistos igualan el default del schema (no un literal).
    expect(config.text.resultLabel).toBe(defaults.text.resultLabel);
    expect(config.text.loadingLabel).toBe(defaults.text.loadingLabel);
    expect(config.text.errorGeneric).toBe(defaults.text.errorGeneric);
    expect(config.text.errorNetwork).toBe(defaults.text.errorNetwork);
    // El resto de campos previos de text quedan intactos → marca usable.
    expect(config.text.title).toBe(defaults.text.title);
    expect(config.text.submitLabel).toBe(defaults.text.submitLabel);
  });
});

/**
 * Contrato de marca de voice_capture (design.md → acceptance #12).
 *
 * El schema Zod debe tener un bloque `voice` con `.default()` por campo (y
 * `.prefault({})` en el bloque), de modo que un JSON de marca SIN `voice` siga
 * produciendo una `BrandConfig` usable con los textos/locale de voz por defecto.
 *
 * RED: falla hasta que el implementer añada el bloque `voice` al schema. Aquí se
 * prueba el MECANISMO (existencia + relleno por defaults + preservación de un
 * parcial), no el copy exacto: la fuente de verdad del default es
 * `parseBrandConfig({}).voice`.
 */
describe('brandConfigSchema — bloque voice (voice_capture, acceptance #12)', () => {
  it('un JSON sin voice produce una BrandConfig con el bloque voice completo y usable', () => {
    const config = parseBrandConfig({});

    // El bloque existe.
    expect(config.voice).toBeDefined();

    // Todos los textos mostrables por defecto no vacíos → marca usable sin declararlos.
    expect(config.voice.startLabel.length).toBeGreaterThan(0);
    expect(config.voice.listeningLabel.length).toBeGreaterThan(0);
    expect(config.voice.permissionDenied.length).toBeGreaterThan(0);
    expect(config.voice.noSpeech.length).toBeGreaterThan(0);
    expect(config.voice.genericError.length).toBeGreaterThan(0);
    expect(config.voice.unsupported.length).toBeGreaterThan(0);

    // Locale BCP-47 por defecto para el reconocimiento (default 'es-ES').
    expect(config.voice.lang).toBe('es-ES');
  });

  it('conserva un valor parcial de voice y rellena el resto con los defaults del schema', () => {
    const defaults = parseBrandConfig({});
    const config = parseBrandConfig({ voice: { lang: 'es-MX' } });

    // El valor provisto se respeta.
    expect(config.voice.lang).toBe('es-MX');
    // Los sub-campos no provistos igualan el default del schema (no un literal).
    expect(config.voice.startLabel).toBe(defaults.voice.startLabel);
    expect(config.voice.genericError).toBe(defaults.voice.genericError);
    // Los demás bloques quedan intactos → marca usable.
    expect(config.text).toEqual(defaults.text);
    expect(config.colors).toEqual(defaults.colors);
  });
});

/**
 * RED — voice_universal (design §5.6, SC1). El estado "transcribiendo" del
 * fallback por IA no tiene equivalente en el flujo nativo ni texto existente que
 * lo cubra, así que se añade UNA sola clave nueva al bloque `voice`:
 * `transcribingLabel`, con `.default()` para que ninguna marca existente edite su
 * JSON (principio "marca nueva = un JSON").
 *
 * RED: falla hasta que el implementer añada `voice.transcribingLabel` al schema.
 * Se prueba el MECANISMO (existencia + default no vacío + JSON que lo omite sigue
 * válido), no el copy exacto: la fuente de verdad del default es
 * `parseBrandConfig({}).voice.transcribingLabel`.
 */
describe('brandConfigSchema — voice.transcribingLabel (voice_universal, SC1)', () => {
  it('parseBrandConfig({}) produce voice.transcribingLabel con un default no vacío', () => {
    const config = parseBrandConfig({});

    expect(config.voice.transcribingLabel).toBeDefined();
    expect(typeof config.voice.transcribingLabel).toBe('string');
    expect(config.voice.transcribingLabel.length).toBeGreaterThan(0);
  });

  it('un JSON de marca que OMITE transcribingLabel sigue siendo válido y rellena el default', () => {
    const defaults = parseBrandConfig({});
    // JSON de marca con otros textos de voz pero SIN transcribingLabel.
    const config = parseBrandConfig({ voice: { startLabel: 'Dicta aquí' } });

    expect(config.voice.startLabel).toBe('Dicta aquí');
    // El campo omitido cae al default del schema (no un literal).
    expect(config.voice.transcribingLabel).toBe(defaults.voice.transcribingLabel);
  });

  it('conserva un transcribingLabel provisto por la marca (white-label)', () => {
    const config = parseBrandConfig({ voice: { transcribingLabel: 'Convirtiendo tu voz…' } });
    expect(config.voice.transcribingLabel).toBe('Convirtiendo tu voz…');
  });
});

/**
 * RED — feedback de longitud al límite (voice_auto_send, ADR 25). Cuando el
 * nombre alcanza el tope FIJO de 15 (por teclado o por dictado, ambos recortan a
 * 15), la UI muestra un aviso de marca. Se añade UNA sola clave nueva al bloque
 * `text`: `maxLengthReached`, con `.default('Máximo {max} caracteres')` para que
 * ninguna marca existente edite su JSON (principio "marca nueva = un JSON").
 *
 * RED: falla hasta que el implementer añada `text.maxLengthReached` al schema. Se
 * prueba el MECANISMO (existencia + default no vacío + placeholder {max} presente
 * + JSON que lo omite sigue válido), no el copy exacto: la fuente de verdad del
 * default es `parseBrandConfig({}).text.maxLengthReached`.
 */
describe('brandConfigSchema — text.maxLengthReached (voice_auto_send, ADR 25)', () => {
  it('parseBrandConfig({}) produce text.maxLengthReached con un default no vacío', () => {
    const config = parseBrandConfig({});

    expect(config.text.maxLengthReached).toBeDefined();
    expect(typeof config.text.maxLengthReached).toBe('string');
    expect(config.text.maxLengthReached.length).toBeGreaterThan(0);
  });

  it('el default de maxLengthReached contiene el placeholder {max} (reusa el patrón de counterTemplate)', () => {
    const config = parseBrandConfig({});
    expect(config.text.maxLengthReached).toContain('{max}');
  });

  it('un JSON de marca que OMITE maxLengthReached sigue siendo válido y rellena el default', () => {
    const defaults = parseBrandConfig({});
    // JSON de marca con otros textos pero SIN maxLengthReached.
    const config = parseBrandConfig({ text: { title: 'Hola' } });

    expect(config.text.title).toBe('Hola');
    // El campo omitido cae al default del schema (no un literal).
    expect(config.text.maxLengthReached).toBe(defaults.text.maxLengthReached);
    // Los demás campos previos de text quedan intactos → marca usable.
    expect(config.text.counterTemplate).toBe(defaults.text.counterTemplate);
  });

  it('conserva un maxLengthReached provisto por la marca (white-label)', () => {
    const config = parseBrandConfig({ text: { maxLengthReached: 'Tope: {max} letras' } });
    expect(config.text.maxLengthReached).toBe('Tope: {max} letras');
  });
});
