import type { BrandConfig } from './schema';

/**
 * Escribe las CSS variables `--brand-*` de la marca activa en `:root`
 * (`document.documentElement`). Los tokens Tailwind (`bg-brand-primary`…) las
 * consumen; cambiar de marca vuelve a llamar esta función y re-setea las
 * variables sin recargar.
 */
export function applyBrandToDom(config: BrandConfig): void {
  const root = document.documentElement;
  const { colors, style } = config;

  root.style.setProperty('--brand-bg', colors.bg);
  root.style.setProperty('--brand-surface', colors.surface);
  root.style.setProperty('--brand-primary', colors.primary);
  root.style.setProperty('--brand-accent', colors.accent);
  root.style.setProperty('--brand-text', colors.text);
  root.style.setProperty('--brand-muted', colors.muted);

  root.style.setProperty('--brand-radius', style.radius);
  root.style.setProperty('--brand-font', style.fontFamily);
  root.style.setProperty('--brand-title-weight', style.titleWeight);
}
