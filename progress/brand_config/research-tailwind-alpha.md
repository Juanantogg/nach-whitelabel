# Research — Tailwind v4: tokens de color como CSS vars + modificador de opacidad

Investigación puntual para el BUG de theming white-label: las utilidades de
marca (`.text-brand-primary`, `.bg-brand-*`) se emiten con el literal
`<alpha-value>` sin sustituir, el navegador descarta la declaración y ningún
color de marca se aplica.

## Versión instalada (verificada en lockfile)

- `tailwindcss@4.3.2`
- `@tailwindcss/vite@4.3.2`

Fuente: `frontend/package.json` + `pnpm-lock.yaml`.

## Preguntas

1. ¿Cómo se definen en Tailwind v4 tokens de color en `@theme` cuyo valor es
   una CSS var inyectada en runtime, MANTENIENDO el modificador de opacidad
   (`bg-brand-primary/50`)?
2. ¿Por qué `rgb(var(--x) / <alpha-value>)` produce `<alpha-value>` literal?
   ¿Sigue existiendo `<alpha-value>` en v4?
3. ¿Qué debe contener el `@theme` si las vars son canales sueltos
   (`124 92 252`)? ¿Y si son colores completos?

## Causa raíz confirmada

`<alpha-value>` es el mecanismo de **Tailwind v3**, no de v4. En v3 el motor
(plugin JS) sustituía el placeholder `<alpha-value>` en tiempo de build por el
alfa de la utilidad. **En v4 ese placeholder ya no existe ni se sustituye**: por
eso queda como texto literal `rgb(124 92 252 / <alpha-value>)`, valor CSS
inválido que el navegador descarta → la utilidad no llega a la CSSOM.

En v4 el modificador de opacidad se implementa con `color-mix()`. Al escribir
`bg-blue-500/50`, Tailwind v4 genera:

```css
background-color: color-mix(in oklab, var(--color-blue-500) 50%, transparent);
```

De la doc oficial (Colors / core concepts): *"In v4.0, `color-mix()` is used which
lets you adjust the opacity of any color value, including CSS variables and
`currentColor`."* Y del blog de lanzamiento v4.0: el operando de `color-mix`
debe ser **un valor de color resoluble** (`var(--color-*)` que contenga un color
completo, `currentColor`, etc.).

Implicación clave: el valor del token en `@theme` debe ser un **color CSS
completo** (`rgb(...)`, `oklch(...)`), NO canales sueltos ni la sintaxis
`.../ <alpha-value>`. `color-mix(in oklab, rgb(124 92 252) 50%, transparent)` es
válido; `color-mix(in oklab, 124 92 252 50%, transparent)` no lo es.

## Patrón correcto recomendado

El modificador de opacidad funciona **automáticamente** en v4 sin configuración
especial siempre que el token resuelva a un color completo. Hay dos opciones;
recomiendo la **Opción A** (menos cambios, conserva el layout actual).

### Opción A — mantener canales sueltos en `:root`, envolver en `rgb()` en `@theme`

Las CSS vars `--brand-*` siguen siendo canales (`"124 92 252"`), y el `@theme
inline` envuelve cada una en `rgb(...)` para producir un color completo:

```css
@theme inline {
  --color-brand-bg: rgb(var(--brand-bg));
  --color-brand-surface: rgb(var(--brand-surface));
  --color-brand-primary: rgb(var(--brand-primary));
  --color-brand-accent: rgb(var(--brand-accent));
  --color-brand-text: rgb(var(--brand-text));
  --color-brand-muted: rgb(var(--brand-muted));
}

:root {
  --brand-bg: 23 22 26;
  --brand-surface: 38 36 43;
  --brand-primary: 170 59 255;
  --brand-accent: 170 59 255;
  --brand-text: 245 245 247;
  --brand-muted: 148 143 156;
  /* radius/font/title-weight sin cambios */
}
```

Con esto Tailwind emite `.text-brand-primary { color: var(--color-brand-primary) }`
(color completo, válido) y `text-brand-primary/50` →
`color-mix(in oklab, var(--color-brand-primary) 50%, transparent)`.

- El `ThemeProvider` **no cambia**: sigue inyectando canales sueltos en `:root`.
- `body { background: rgb(var(--brand-bg)) }` sigue funcionando igual.
- `@theme inline` es obligatorio aquí: incrusta el valor (`rgb(var(--brand-*))`)
  en la utilidad, de modo que lee EN VIVO la var de `:root` que el provider
  actualiza en runtime.

### Opción B — colores completos en `:root`

Si se prefiere guardar colores completos por marca (p. ej. migrar a `oklch`):

```css
@theme inline {
  --color-brand-primary: var(--brand-primary);
  /* … resto de tokens con var(--brand-*) directo … */
}

:root {
  --brand-primary: oklch(0.62 0.24 300);   /* o rgb(170 59 255) */
  /* … */
}
```

El modificador de opacidad también funciona (`color-mix` sobre el color
completo). Coste: hay que tocar el `ThemeProvider` y todos los archivos de marca
para que inyecten colores completos en vez de canales, y ajustar
`body { background: var(--brand-bg) }`. Más invasivo; solo si además se quiere
migrar a oklch.

## Recomendación para esta feature

- **Enfoque sugerido: Opción A.** Cambio mínimo (solo `index.css`): quitar
  `/ <alpha-value>` y envolver cada var en `rgb(...)`. Cero cambios en
  `ThemeProvider`, en los archivos de marca ni en el layout. Conserva la
  invariante documentada de "canales RGB para poder combinar opacidad".
- **Trampas a evitar:**
  - No dejar `rgb(var(--x) / <alpha-value>)` — sintaxis v3 muerta en v4.
  - No poner canales sueltos como valor del token (`--color-brand-x: var(--brand-x)`
    con `--brand-x: 124 92 252`): rompe `color-mix` y también el color base
    (`color: 124 92 252` es inválido).
  - No hace falta `--alpha()` ni configurar nada extra para el modificador:
    en v4 va solo si el token es color completo.
- **Deprecaciones relevantes:** el placeholder `<alpha-value>` de v3 no existe
  en v4; migrado a `color-mix(in oklab, …, transparent)`.

## Fuentes

- https://tailwindcss.com/docs/colors — "In v4.0, `color-mix()` is used which lets
  you adjust the opacity of any color value, including CSS variables and
  currentColor"; opacidad vía `bg-x/NN`.
- https://tailwindcss.com/blog/tailwindcss-v4 (lanzamiento v4.0) — opacity
  modifiers generan `color-mix(in oklab, var(--color-*) N%, transparent)`; OKLAB
  por defecto; funciona con CSS vars y `currentColor` sin workarounds.
- https://tailwindcss.com/docs/theme — `@theme inline` incrusta el *valor* del
  token (no la referencia) en la utilidad; ejemplo con `var(--…)`; colores del
  tema por defecto en formato `oklch(...)` (color completo).
