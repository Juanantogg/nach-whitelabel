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
- **pnpm** `11.10.0` — no hace falta instalarlo aparte: el campo `packageManager`
  del `package.json` lo fija, y **Corepack** (incluido en Node) lo activa con la
  versión exacta. Si no usas Corepack, `npm i -g pnpm` también sirve.

```bash
corepack enable              # activa la versión de pnpm fijada por el repo
```

## Puesta en marcha

```bash
pnpm install                 # instala front + back (usa el lockfile commiteado)
cp .env.example .env         # configura variables (Mongo URI, clave de cifrado)
pnpm dev                     # levanta frontend y backend en paralelo
```

> **Para ejecutar en local** necesitas `MONGODB_URI` y `CRYPTO_PRIVATE_KEY` en tu
> `.env` (el backend hace *fail-fast* y no arranca sin ellas, por diseño de
> seguridad). Los envío en el correo de entrega para que solo tengas que pegarlos;
> no viajan en el repo. Si prefieres generar tu propio par de claves, el
> `.env.example` incluye los comandos `openssl`.

> **Seguridad de dependencias:** el repo endurece pnpm contra ataques a la cadena
> de suministro de npm (ver [ADR 16](docs/decisiones.md)). Instalar desde el
> lockfile commiteado (lo anterior) funciona sin fricción. Solo si **añades una
> dependencia recién publicada** (< 24 h) verás la cuarentena `minimumReleaseAge`;
> es intencional — espera un día o exclúyela puntualmente.

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

> 📋 El registro completo de decisiones (contexto, porqué y alternativas
> descartadas) está en **[`docs/decisiones.md`](docs/decisiones.md)**. Resumen:

- **Monorepo (pnpm workspaces).** Front y back comparten el contrato de cifrado y
  la API; un único repo se clona y evalúa de una vez, con historia unificada.
- **White-label vía tokens de tema.** Los componentes usan clases Tailwind que
  apuntan a **CSS variables** (`--brand-*`); un `ThemeProvider` las inyecta en
  runtime. Textos, colores, estilos e ilustración vienen de la config de marca →
  cambiar de marca **no toca la lógica de ningún componente**.
- **Config de marca en JSON, validada con Zod.** En producción el front la carga
  desde **S3** con fallback a una marca bundleada; Zod valida y rellena defaults,
  así un JSON incompleto o un fetch fallido nunca rompen la app. Sin dashboard ni
  backend de config.
- **Marca activa según el entorno.** En **producción** la fija el **subdominio**
  (`elektra.dominio` → su JSON en S3). En **desarrollo** se usa `?brand=elektra`
  (solo dev) o, si no, `VITE_DEFAULT_BRAND`. Sin switcher: el enunciado no lo pide.
- **Cifrado híbrido asimétrico** (decisión propia sobre el "encriptar" que pide el
  enunciado): clave privada en el servidor, pública en el front, Web Crypto API.
  Ningún secreto en el bundle. Detalle en [`docs/seguridad.md`](docs/seguridad.md).
- **Backend en capas** (`routes → controllers → services`) con `app` separada de
  `server` → endpoints testeables con Supertest sin abrir puerto ni depender de Mongo.
- **TDD estricto** (RED → GREEN → REFACTOR) y **calidad automatizada**: Conventional
  Commits (commitlint), Prettier + ESLint vía Husky + lint-staged, y CI que corre
  lint, typecheck, test y build en cada push/PR.

## Convención de commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `chore:`, `refactor:`, `test:`, `ci:`… Validado automáticamente.

## Estado del proyecto

El backlog y el estado de cada feature (`pending` / `in_progress` / `done` /
`blocked`) se llevan en **[`feature_list.json`](feature_list.json)**; el progreso
de la sesión activa y la evidencia por feature, en **[`progress/`](progress/)**.
