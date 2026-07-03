# Frontend — Pendientes de mejora

Revisión de buenas prácticas del paquete `@nach/frontend` (estado: fin de Fase 0).
El scaffold está limpio y bien pensado; la arquitectura white-label vía CSS
variables + tokens de Tailwind está bien diseñada. Este documento recoge lo que
falta antes de construir la lógica real (pantalla de bienvenida, voz, cifrado,
theming por marca).

## Lo que ya está bien ✅

- **Arquitectura white-label sólida** — tokens en canales RGB (`"R G B"`) para
  soportar opacidad de Tailwind (`bg-brand-primary/50`).
- **ESLint completo y moderno** — flat config con `jsx-a11y` + `react-hooks` +
  `react-refresh`.
- **Setup de tests correcto** — Testing Library, `cleanup()` en `afterEach`,
  jsdom, coverage v8.
- **Config TS con project references** (`app` / `node` separados),
  `verbatimModuleSyntax`, `erasableSyntaxOnly`.
- **`<html lang="es">`, StrictMode, React 19 + `@types/react` 19** — al día.

## Hecho durante la revisión ✔️

- **`strict: true` activado** en `tsconfig.app.json` y `tsconfig.node.json`.
  Faltaba en toda la config de TS (inconsistente con el backend y contra
  CLAUDE.md, "evitar `any`"). La plantilla oficial de Vite lo trae por defecto;
  se había perdido al reescribir el tsconfig. Sin `strict` no hay
  `strictNullChecks`, y eso muerde justo en lo que viene: cifrado (buffers,
  posibles `null`), Web Speech API (`SpeechRecognition` es opcional/undefined en
  muchos navegadores) y respuestas de fetch. Verificado: `typecheck` y `test`
  siguen en verde.
- **ESLint subido a `recommendedTypeChecked`** (variante type-aware) con
  `projectService: true`. Antes usaba `recommended` (sin type-checking). Ahora se
  detectan bugs reales de async: `no-floating-promises`, `no-misused-promises`
  (handler async en `onClick`) y `no-unsafe-*` (resultado de descifrar / `res.json()`
  como `any`). Es el estándar actual de la industria; se descartó
  `strictTypeChecked` por ruidoso para una prueba técnica. Verificado: `lint`,
  `typecheck` y `test` en verde.
- **Higiene de commits/push endurecida** (config compartida del repo):
  `no-console` (permite `warn`/`error`/`info`), `vitest/no-focused-tests` (error
  en tests, bloquea `.only` en el pre-commit vía lint-staged) y un hook `pre-push`
  nuevo (`pnpm typecheck && pnpm -r test`) que impide pushear código roto. Ver
  detalle en `backend-pendientes.md`.

## Pendientes ⚠️

### 1. Sin capa de config de entorno · Prioridad ALTA

El front lee `import.meta.env.VITE_*` sin centralizar ni validar. Se necesitarán
`VITE_API_URL` y `VITE_DEFAULT_BRAND`. (El front **no** lleva ninguna clave de
cifrado: obtiene la clave pública del backend en runtime — ver
[`seguridad.md`](seguridad.md).)

- **Acción:** módulo `src/config/env.ts` con acceso tipado y validación (espejo
  del `config/env.ts` del backend).

### 2. Falta el andamiaje white-label prometido · Prioridad ALTA

`index.css` y `App.tsx` mencionan `src/brands/*` y un `ThemeProvider`, pero **no
existen** aún. Es el corazón de la prueba.

- **Acción:** crear `src/brands/*` (config por marca: shopinbaz, elektra, …) y el
  `ThemeProvider` que inyecta las variables en `:root` en runtime.

### 3. Sin capa de API / cliente fetch · Prioridad MEDIA

No hay dónde vivan las llamadas al backend.

- **Acción:** módulo dedicado (`src/api/*`) antes de escribir componentes, para
  centralizar fetch, base URL y manejo de errores.

### 4. Sin `ErrorBoundary` · Prioridad MEDIA

Estándar en React 19 para que un fallo de cifrado/red no deje la app en blanco.

- **Acción:** un `ErrorBoundary` de nivel raíz envolviendo `<App />`.

### 5. Detalles menores · Prioridad BAJA

- **`index.html` referencia `/favicon.svg`** — verificar que exista en `public/`
  o saldrá 404.

## A verificar 🔍

- **`vite: ^8.1.3`** y **`typescript: ~6.0.2`** van por delante de lo esperado
  (Vite ~5/6, TS ~5.x en referencias previas). CLAUDE.md indica "última estable",
  así que es intencional — solo confirmar que build/test pasan en CI.

## Orden sugerido

1. **Ahora (antes de la lógica real):** config de entorno tipada +
   `ThemeProvider` con `src/brands/*`.
2. **Al montar los componentes:** capa de API, `ErrorBoundary`.
3. **Cuando sobre tiempo:** limpieza de menores (favicon).
