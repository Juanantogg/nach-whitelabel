# Review — welcome_screen (bugfix: fondo blanco)

**Veredicto:** APPROVED

Revisión del bugfix de theming (el fondo de la app se veía blanco en vez del
color de marca oscuro). Diff acotado a 2 líneas de producción + 2 asserts nuevos.

## Checklist

- **TDD:** [x] — Los 2 tests nuevos existían en RED (evidencia en `tests.md`
  §"Bugfix RED — fondo blanco", 2026-07-04: fallaban por implementación ausente,
  no por setup) y ahora pasan. El implementer NO relajó tests: el criterio #1
  (`main` con `bg-brand-bg`) se verifica sobre el DOM y el criterio #2 (regla
  global en `index.css`) con regex tolerante sobre el archivo estático — ambos
  intactos respecto a `tests.md`. Implementación mínima: una clase y una regla
  `body`, sin sobre-ingeniería.

- **White-label:** [x] — Cero literales. `WelcomeScreen.tsx:29` usa el token
  `bg-brand-bg` (no hex ni blanco fijo). `index.css:52-53` usa
  `rgb(var(--brand-bg))` y `rgb(var(--brand-text))`, variables que el
  ThemeProvider inyecta en `:root` por marca — el fondo cambia con la marca, sin
  color hardcodeado. Se puede añadir una marca sin tocar el componente.

- **Backend:** [x] — No aplica (cambio solo frontend). `smoke` sigue verde.

- **Calidad:** [x] — `./init.sh full` en verde completo: lint limpio, typecheck
  sin errores, 177 tests frontend + 44 backend, build y smoke OK. Sin `any`, sin
  `console.log`, sin dependencias nuevas. Orden de clases Tailwind idiomático
  (`bg-brand-bg` entre layout y `text-brand-text`). Estructura de `index.css`
  intacta: `@import` → `@theme inline` → `:root` → nueva regla `body` al final,
  con comentario que justifica la defensa en profundidad.

## Notas de correctitud

1. **Resuelve el bug sin regresiones.** El `<main>` es `max-w-sm mx-auto`
   (columna centrada), por lo que aplicar el fondo SOLO en `<main>` dejaría
   blancas las bandas laterales y el overscroll. La regla `body` cubre el lienzo
   exterior y el `bg-brand-bg` del `<main>` cubre el contenedor: la redundancia
   es defensa en profundidad real, no doble pintado problemático (son áreas
   distintas), y fue acordada por el usuario y registrada en los criterios de
   `tests.md`.

2. **`color: rgb(var(--brand-text))` global es coherente.** Fija el color de
   texto por defecto del documento (claro en shopinbaz). Los botones
   (`bg-brand-primary` + `text-brand-bg`) ganan por la utilidad Tailwind sobre la
   herencia del `body`, así que el texto oscuro sobre primario se mantiene. El
   `<main>` ya declaraba `text-brand-text`; la regla global solo refuerza lo que
   quede fuera del árbol de la pantalla. Sin herencia rota.

## Cambios requeridos

Ninguno.

## Documentación

El fix no introduce una decisión de arquitectura nueva (es la aplicación del
theming ya decidido en el ADR de white-label / CSS vars por marca). No requiere
ADR nuevo; `README.md` sigue coherente.

---

# REFACTOR — fix theming @theme inline v4

**Veredicto:** APPROVED

Fix de theming white-label. En `@theme inline`, los seis tokens de color pasan
de `rgb(var(--brand-X) / <alpha-value>)` a `rgb(var(--brand-X))`. Motivo:
`<alpha-value>` es mecanismo de Tailwind **v3**, inexistente en v4
(`tailwindcss@4.3.2`); el motor lo emitía como literal, produciendo un valor CSS
inválido que el navegador descartaba, con lo que NINGÚN color de marca se
aplicaba. Diff de producción acotado a 6 líneas de `index.css` (bloque
`@theme inline`).

## Checklist

- **TDD:** [x] — El bug estaba cubierto en RED por
  `frontend/src/brand/core/brandUtilitiesCss.test.ts` (evidencia en `tests.md`
  §RED del fix). El test compila el `index.css` REAL con el motor programático de
  Tailwind v4 (`compile()`, el mismo que `@tailwindcss/vite`) y afirma sobre el
  CSS generado, no sobre la fuente. Aserción de COMPORTAMIENTO, no frágil: exige
  (a) que exista la regla de cada utilidad, (b) que NINGUNA contenga el literal
  `<alpha-value>`, y (c) que `text-/bg-brand-primary` sigan apoyándose en
  `var(--brand-primary)` (theming en vivo). Ancla bien el bug: el test justifica
  explícitamente por qué jsdom+Testing Library NO lo capturaría (jsdom acepta
  cualquier string como color). El implementer NO relajó nada: aplicó la Opción A
  del research (`research-tailwind-alpha.md`), la de cambio mínimo.

- **White-label:** [x] — Cero literales. Las CSS vars `--brand-*` siguen siendo
  canales sueltos en `:root`, envueltas en `rgb(...)` dentro de `@theme inline`;
  el `ThemeProvider` y los archivos de marca NO se tocan (confirmado:
  `git status` no lista ThemeProvider ni `brands/*.json`). Añadir una marca sigue
  siendo añadir un archivo de config. Verificado empíricamente compilando con el
  motor real: `.bg-brand-primary → background-color: rgb(var(--brand-primary))`
  (válido) y el modificador de opacidad documentado `bg-brand-primary/50` compila
  a `color-mix(in oklab, rgb(var(--brand-primary)) 50%, transparent)` — sigue
  funcionando y es válido en v4. La invariante del comentario se mantiene.

- **Backend:** [x] — No aplica (cambio solo frontend).

- **Calidad:** [x] — `pnpm --filter @nach/frontend test` verde (182/182),
  `lint` limpio, `typecheck` sin errores. Solo se tocó `index.css` en su bloque
  `@theme inline`; `:root`, `body`, `ThemeProvider` y los `brands/*.json` quedan
  intactos. Sin `any`, sin `console.log`, sin dependencias nuevas. Se reutiliza
  el pipeline nativo de Tailwind (`compile()`) en el test en vez de reimplementar
  un parser CSS: correcto.

## Aclaración de alcance

El diff de `git diff index.css` contra el commit anterior muestra TAMBIÉN el
bloque `body { background/color }` como añadido, y `WelcomeScreen.tsx` con
`bg-brand-bg`. Eso pertenece al bugfix PREVIO "fondo blanco" ya revisado y
aprobado en la sección superior de este mismo archivo, NO a este REFACTOR. El
cambio propio de este fix es exclusivamente el bloque `@theme inline`.

## Suciedad detectada (menor — no bloquea)

Ninguna bloquea la aprobación, pero conviene que el implementer ajuste dos
comentarios para que no queden desactualizados tras el fix:

1. `frontend/src/index.css:12-13` — el comentario dice: *"Los valores viven como
   canales RGB ("R G B") para poder combinarlos con la opacidad de Tailwind
   (`bg-brand-primary/50`)."* Sigue siendo CIERTO (las vars `--brand-*` siguen
   siendo canales y `/50` funciona), pero ya no explica el mecanismo real de v4.
   Sugerencia de matiz para evitar que alguien reintroduzca `<alpha-value>`:
   añadir *"En Tailwind v4 el modificador de opacidad se resuelve vía
   `color-mix(in oklab, …, transparent)`; el `@theme inline` envuelve cada canal
   en `rgb(...)` para producir un color completo (requisito de `color-mix`). NO
   usar la sintaxis `/ <alpha-value>` de v3: en v4 queda como literal inválido y
   el navegador descarta la utilidad."*

2. `frontend/src/index.css:16-17` — el comentario ilustra la utilidad generada
   como `background-color: rgb(var(--brand-primary) / …)`. Tras el fix la
   utilidad real es `rgb(var(--brand-primary))` (sin `/ …`). Actualizar el
   ejemplo a `rgb(var(--brand-primary))` para que no sugiera la sintaxis muerta.

3. `frontend/src/index.css:34-35` (informativo, NO acción requerida) — el
   fallback estático de `:root` es `--brand-primary: 170 59 255`, distinto del
   `default.json` (`124 92 252`). Es solo el color ANTES de que el ThemeProvider
   inyecte la marca, por lo que en runtime nunca se ve; no es un bug. Si se
   quiere pulcritud, alinear el fallback con `default.json` (o dejar una nota de
   una línea de que es un fallback deliberadamente distinto). No bloquea.

## Documentación

El fix no introduce una decisión de arquitectura nueva: aplica el theming ya
decidido (CSS vars por marca) y corrige una regresión de sintaxis v3→v4. El
research que lo fundamenta (`progress/brand_config/research-tailwind-alpha.md`,
Opción A) queda como evidencia. No requiere ADR nuevo; `README.md` sigue
coherente.

---

# Review — welcome_screen (REFACTOR — fallback de assets rotos)

**Veredicto:** APPROVED

Revisión de la red de seguridad en runtime: cuando un asset remoto de marca
(logo/ilustración en S3) no carga, el `<img>` cae al asset bundleado de
`DEFAULT_BRAND` en vez de pintar el ícono roto. Diff acotado a un único archivo
de producción (`WelcomeScreen.tsx`: helper `fallbackTo` + `onError` en los dos
`<img>`) + un `describe` nuevo de 5 tests.

## Checklist

- **TDD:** [x] — Los 3 tests de comportamiento existían en RED (evidencia en
  `tests.md` §"RED — fallback de assets rotos", 2026-07-05: fallaban por
  `onError` ausente, `src` quedaba en la ruta remota rota; los 2 de guarda
  pasaban trivialmente sin implementación, quedan como red de regresión). Ahora
  los 5 pasan. El implementer NO relajó tests: los asserts se comparan contra
  `DEFAULT_BRAND.assets` (fuente de verdad, sin strings sueltos) y no cambiaron
  respecto a `tests.md`. Implementación mínima y razonable: un helper de 3 líneas
  con guarda anti-bucle, sin sobre-ingeniería.

- **White-label:** [x] — Cero literales y cero hex nuevos. La ruta de fallback
  sale de `DEFAULT_BRAND.assets.logo/illustration` (config), no hardcodeada. El
  `alt` sigue viniendo de la config de marca. Coherente con ADR 13: `default` es
  la ÚNICA marca con assets bundleados offline, usarla como red de seguridad en
  runtime respeta esa excepción. NO se tocó el schema (`assets.*` sigue
  `z.string()` sin validación de formato, correcto). No requiere ADR nuevo: es
  implementación menor coherente con una decisión ya registrada; `README.md`
  sigue coherente.

- **Backend:** [x] — No aplica (cambio solo de frontend).

- **Calidad:** [x] — `pnpm --filter @nach/frontend test` verde (187/187, los 25
  de WelcomeScreen incluidos), `lint` limpio, `typecheck` sin errores. Sin `any`,
  sin `console.log`, sin dependencias nuevas. Usa la API nativa (`onError` del
  `<img>` + Web `SyntheticEvent`), sin librería de fallback de imágenes: prefiere
  stdlib como manda la convención. No reimplementa nada existente.

## Observaciones (no bloqueantes)

1. **Guarda anti-bucle `img.src.endsWith(fallback)` — correcta para las marcas
   actuales, riesgo solo teórico.** En browser/jsdom `img.src` es absoluto
   (`https://brands.garcia3apps.com/elektra/logo.svg`) y `fallback` es relativo
   (`/brands/default/logo.svg`). El sufijo comparado es el path completo
   `/brands/default/logo.svg`, no solo `/logo.svg`: un asset de marca que termina
   en `/elektra/logo.svg` NO satisface la guarda, así que el swap SÍ ocurre — y
   tras el swap, `src` termina en `/brands/default/logo.svg`, la guarda se cumple
   y no re-entra. Funciona. El único falso positivo posible sería una marca cuyo
   asset viviera en una URL terminada EXACTAMENTE en `/brands/default/logo.svg`
   (p.ej. `https://cdn.otramarca.com/brands/default/logo.svg`): ahí el swap se
   saltaría. Es patológico e improbable (una marca no-default sirviendo bajo la
   ruta `brands/default`). No merece endurecerse ahora; si se quisiera blindar,
   la vía limpia es un flag por elemento (`data-fallback-applied` / dataset) en
   vez de comparar strings de ruta — anotado para un futuro, no requerido aquí.

2. **`fallbackTo` se recrea en cada render.** Devuelve dos closures nuevos por
   render. Irrelevante en este componente: los `<img>` no están memoizados y el
   coste es nulo. `useCallback` aquí sería abstracción prematura; correcto
   dejarlo tal cual.

3. **`alt` tras el fallback.** Queda el `alt` de la marca activa (p.ej.
   "elektra") sobre la imagen de default. Aceptable: el `alt` describe el rol
   semántico (logo/ilustración de la marca) más que el archivo concreto, y el
   fallback es una identidad degradada visible. No es incorrecto; no bloquea.

## Verificación runtime

Confirmado por el implementer con Playwright (`?brand=elektra`, assets S3 rotos
en local): ambos `<img>` caen a `/brands/default/*.svg` y dejan de mostrar el
ícono roto. Coherente con la nota de memoria "verificar SVG visualmente".
