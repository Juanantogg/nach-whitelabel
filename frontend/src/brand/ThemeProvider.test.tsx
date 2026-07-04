import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useBrand } from './ThemeProvider';
import { parseBrandConfig } from './schema';
import shopinbazSeed from './seeds/shopinbaz.json';
import elektraSeed from './seeds/elektra.json';

/**
 * Acceptance #7: "Textos, estilos visuales e ilustración vienen de la config de
 * marca; cero literales en componentes".
 * Acceptance #8: "Cambiar de marca no requiere editar ningún componente".
 * Acceptance #9 (test estrella): "el mismo componente renderiza shopinbaz y
 * elektra con textos, colores e ilustración distintos".
 *
 * Rev.2 (identidad de marca abierta): el Provider cambia de firma
 * `brand: BrandKey` → `config: BrandConfig`. Recibe la config YA resuelta por
 * prop (síncrono, sin catálogo, sin red). El test multi-marca importa los SEEDS
 * (`./seeds/*.json`), los pasa por `parseBrandConfig` y los inyecta por prop:
 * las anclas de dato viven ahora contra los seeds.
 *
 * El MISMO componente `BrandShowcase` se renderiza con dos configs distintas;
 * solo cambia la config inyectada por prop (parametrización por Context).
 *
 * RED (Rev.2): el Provider aún recibe `brand="..."` y lee `BUNDLED_BRANDS` en vez
 * de recibir `config` por prop.
 */

const shopinbazConfig = parseBrandConfig(shopinbazSeed);
const elektraConfig = parseBrandConfig(elektraSeed);

// Componente de UI de ejemplo: SOLO lee de useBrand(), cero literales de marca.
function BrandShowcase() {
  const brand = useBrand();
  return (
    <div>
      <h1>{brand.text.title}</h1>
      <input placeholder={brand.text.inputPlaceholder} />
      <button type="button">{brand.text.submitLabel}</button>
      <img src={brand.assets.illustration} alt={brand.assets.illustrationAlt} />
    </div>
  );
}

function readVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

describe('ThemeProvider + useBrand — render multi-marca (config por prop)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
  });

  // Mecanismo (invariante): el mismo componente refleja EXACTAMENTE los datos de
  // la config inyectada (textos, illustration y color primario), sea cual sea el
  // copy. Se afirma contra la config parseada del seed, no contra literales.
  it.each([
    ['shopinbaz', shopinbazConfig],
    ['elektra', elektraConfig],
  ] as const)(
    'el MISMO componente refleja los textos, ilustración y color de %s',
    (_name, config) => {
      render(
        <ThemeProvider config={config}>
          <BrandShowcase />
        </ThemeProvider>,
      );

      expect(screen.getByRole('heading', { name: config.text.title })).toBeInTheDocument();
      expect(screen.getByRole('img')).toHaveAttribute('src', config.assets.illustration);
      expect(readVar('--brand-primary')).toBe(config.colors.primary);
    },
  );

  // Ancla (dato, acceptance #9 + #5): shopinbaz ES morado y elektra ES rojo, con
  // sus títulos e ilustraciones concretos. Literales INTENCIONALES: esta prueba
  // debe romperse si alguien confunde las marcas o cambia su identidad de dato.
  it('ANCLA: shopinbaz (desde seed) renderiza su título morado (170 59 255)', () => {
    render(
      <ThemeProvider config={shopinbazConfig}>
        <BrandShowcase />
      </ThemeProvider>,
    );

    expect(
      screen.getByRole('heading', { name: '¡Te damos la bienvenida a shopinbaz!' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brands/shopinbaz/illustration.svg');
    expect(readVar('--brand-primary')).toBe('170 59 255');
  });

  it('ANCLA: elektra (desde seed) renderiza su título rojo (242 74 45)', () => {
    render(
      <ThemeProvider config={elektraConfig}>
        <BrandShowcase />
      </ThemeProvider>,
    );

    expect(
      screen.getByRole('heading', { name: '¡Te damos la bienvenida a Préstamo Elektra!' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brands/elektra/illustration.svg');
    expect(readVar('--brand-primary')).toBe('242 74 45');
  });

  it('cambiar la prop config re-inyecta --brand-primary sin recargar (#8)', () => {
    const { rerender } = render(
      <ThemeProvider config={shopinbazConfig}>
        <BrandShowcase />
      </ThemeProvider>,
    );
    expect(readVar('--brand-primary')).toBe('170 59 255');

    // Mismo componente, solo cambia la config inyectada por prop.
    rerender(
      <ThemeProvider config={elektraConfig}>
        <BrandShowcase />
      </ThemeProvider>,
    );
    expect(readVar('--brand-primary')).toBe('242 74 45');
    expect(
      screen.getByRole('heading', { name: '¡Te damos la bienvenida a Préstamo Elektra!' }),
    ).toBeInTheDocument();
  });

  it('el submitLabel viene de config (mismo en ambas marcas, cero literal en el componente)', () => {
    render(
      <ThemeProvider config={elektraConfig}>
        <BrandShowcase />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Comenzar' })).toBeInTheDocument();
  });
});
