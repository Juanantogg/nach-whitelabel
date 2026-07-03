# nach-whitelabel

Aplicación web **white-label** desarrollada como prueba técnica para **Nach**
(cliente **Upax**). Captura el nombre del usuario (input o voz), lo procesa de
forma **cifrada** en un backend que genera un **número consecutivo**, y lo
muestra de vuelta en el frontend — todo re-tematizable por marca mediante
configuración.

> 📄 Enunciado completo y maquetas en [`docs/`](docs/).

## Stack

| Capa       | Tecnología                                              |
| ---------- | ------------------------------------------------------- |
| Frontend   | React 19 · Vite · TypeScript · Tailwind CSS v4          |
| Backend    | Node.js · Express 5 · TypeScript · Mongoose (MongoDB)   |
| Testing    | Vitest · Testing Library (front) · Supertest (back)     |
| Tooling    | pnpm workspaces · ESLint · Prettier · Husky · commitlint |
| CI         | GitHub Actions (lint · typecheck · test · build)        |

## Requisitos

- **Node.js** ≥ 20
- **pnpm** ≥ 11 (`corepack enable` o `npm i -g pnpm`)

## Puesta en marcha

```bash
pnpm install                 # instala front + back
cp .env.example .env         # configura variables (Mongo URI, clave de cifrado)
pnpm dev                     # levanta frontend y backend en paralelo
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001 (health-check en `/health`)

## Scripts (raíz)

| Comando          | Acción                                        |
| ---------------- | --------------------------------------------- |
| `pnpm dev`       | Front y back en paralelo                       |
| `pnpm build`     | Build de producción de ambos                   |
| `pnpm lint`      | ESLint en ambos paquetes                       |
| `pnpm typecheck` | Chequeo de tipos (sin emitir)                  |
| `pnpm test`      | Tests (Vitest) en ambos                        |
| `pnpm format`    | Formatea todo el repo con Prettier             |

Para un paquete concreto: `pnpm --filter @nach/frontend <script>`.

## Estructura

```
nach-whitelabel/
├─ frontend/          # React + Vite + Tailwind  (@nach/frontend)
├─ backend/           # Express + Mongoose        (@nach/backend)
├─ docs/              # enunciado + maquetas
├─ .github/workflows/ # CI
└─ .husky/            # git hooks (pre-commit, commit-msg)
```

## Decisiones de diseño

- **Monorepo (pnpm workspaces).** Front y back comparten el contrato de cifrado y
  la API; un único repo se clona y evalúa de una sola vez, con historia de
  commits unificada.
- **White-label vía tokens de tema.** Los componentes usan clases Tailwind que
  apuntan a **CSS variables** (`--brand-*`). Cada marca define sus valores y un
  `ThemeProvider` los inyecta en runtime → cambiar de marca **no toca la lógica
  de ningún componente**. Textos y assets también vienen de la config de marca.
- **Backend en capas** (`routes → controllers → services`) con `app` separada de
  `server`, lo que permite testear endpoints con Supertest sin abrir puerto ni
  depender de MongoDB.
- **Calidad automatizada.** Conventional Commits (commitlint), Prettier + ESLint
  en cada commit vía Husky + lint-staged, y CI que corre lint, typecheck, test y
  build en cada push/PR.

## Convención de commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `chore:`, `refactor:`, `test:`, `ci:`… Validado automáticamente.

---

> Estado actual: **dev harness (Fase 0) completo**. La implementación de la
> funcionalidad (captura por voz, cifrado, contador consecutivo y theming por
> marca) es la siguiente fase.
