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
