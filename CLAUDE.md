# CLAUDE.md — nach-whitelabel

Contexto para agentes de IA que trabajan en este repo. Prueba técnica Nach / cliente Upax.

## Qué es

App web **white-label**: captura el nombre del usuario (input manual + dictado por
voz), lo envía **cifrado** a un backend Node que lo descifra, genera un **número
consecutivo** y lo devuelve **cifrado**; el frontend lo descifra y lo muestra.
La misma base de código se re-tematiza por marca (shopinbaz, Elektra, …) mediante
configuración, **sin tocar la lógica de los componentes**.

El enunciado y las maquetas están en [`docs/`](docs/).

## Estructura

- `frontend/` — React 19 + Vite + TypeScript + Tailwind v4. Paquete `@nach/frontend`.
- `backend/` — Express 5 + TypeScript + Mongoose. Paquete `@nach/backend`.
- `docs/` — enunciado (`.md` + `.docx`) y maquetas (`images/`).
- Monorepo con **pnpm workspaces**. Un solo repositorio git.

## Comandos (desde la raíz)

```bash
pnpm install            # instalar todo
pnpm dev                # levantar front y back en paralelo
pnpm lint               # eslint en ambos paquetes
pnpm typecheck          # tsc --noEmit en ambos
pnpm test               # vitest en ambos
pnpm build              # build de producción de ambos
pnpm format             # prettier --write .
```

Por paquete: `pnpm --filter @nach/frontend <script>`.

## Convenciones

- **Gestor de paquetes: pnpm** (no npm/yarn). Dependencias a la última estable.
- **TypeScript** en todo. Evitar `any`.
- **White-label primero**: cero colores o textos literales en componentes.
  Los colores se consumen como tokens de Tailwind (`bg-brand-primary`), que
  mapean a CSS variables inyectadas por marca. Los textos vienen de la config
  de marca. Añadir una marca = añadir un archivo de config, nunca editar un
  componente.
- **Backend en capas**: `routes → controllers → services`. `app.ts` construye la
  app (testeable con Supertest); `server.ts` conecta Mongo y abre el puerto.
- **Cifrado**: AES simétrico con clave por variable de entorno. Nunca hardcodear
  claves ni subir `.env` (ver `.env.example`).
- **Tests**: Vitest en ambos lados. Front con Testing Library; back con Supertest.
  Priorizar: lógica de cifrado, hook de voz, y render multi-marca.

## Git / commits

- **Conventional Commits** obligatorio (lo valida commitlint en `commit-msg`):
  `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`…
- `pre-commit` corre lint-staged (Prettier + ESLint --fix sobre lo staged).
- No hacer commit/push salvo que el usuario lo pida.

## Estado

Fase 0 (dev harness) **completa**: tooling, linting, tests dummy y CI en verde.
La lógica de la prueba (pantalla de bienvenida, voz, cifrado, contador,
theming por marca) es la siguiente fase.
