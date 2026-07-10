# nach-whitelabel

Aplicación web **white-label** desarrollada como prueba técnica para **Nach**
(cliente **Upax**). Captura el nombre del usuario (input o voz), lo procesa de
forma **cifrada** en un backend que genera un **número consecutivo**, y lo
muestra de vuelta en el frontend — todo re-tematizable por marca mediante
configuración.

> 📄 Enunciado completo y maquetas en [`docs/`](docs/).

## 🌐 Entornos desplegados (AWS)

La app corre en producción sobre AWS (S3 + CloudFront para el front, App Runner +
MongoDB Atlas para el backend). El white-label se demuestra con **subdominio por marca**:

| Entorno | Front | Backend (API) |
| --- | --- | --- |
| **Producción — Elektra** | https://elektra.garcia3apps.com | https://api-elektra.garcia3apps.com |
| **Producción — Shopinbaz** | https://shopinbaz.garcia3apps.com | https://api-shopinbaz.garcia3apps.com |
| **Desarrollo** | https://dev.garcia3apps.com · [?brand=elektra](https://dev.garcia3apps.com/?brand=elektra) · [?brand=shopinbaz](https://dev.garcia3apps.com/?brand=shopinbaz) | https://api-dev.garcia3apps.com |

> **Multi-tenant real:** Elektra y Shopinbaz comparten el **mismo** bundle de front (se
> auto-tematiza por subdominio), pero cada una tiene su **backend y su base de datos
> aislados** — un cliente de una empresa nunca toca los datos de la otra (ver
> [ADR 20](docs/decisiones.md)). En dev puedes previsualizar marcas con
> `?brand=elektra` / `?brand=shopinbaz` (solo dev).
>
> Config y assets de marca se sirven desde `https://brands.garcia3apps.com` (S3+CloudFront).
> Detalle completo de la infra y su despliegue en
> [`progress/deploy/`](progress/deploy/) (runbooks de dev y prod).

## Stack

| Capa       | Tecnología                                              |
| ---------- | ------------------------------------------------------- |
| Frontend   | React 19 · Vite · TypeScript · Tailwind CSS v4          |
| Backend    | Node.js · Express 5 · TypeScript · Mongoose (MongoDB)   |
| Testing    | Vitest · Testing Library (front) · Supertest (back)     |
| Tooling    | pnpm workspaces · ESLint · Prettier · Husky · commitlint |
| CI/CD      | GitHub Actions (CI + deploy a AWS por OIDC, sin secretos) |
| Infra      | AWS S3 · CloudFront · App Runner · Parameter Store · MongoDB Atlas |

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

## Arquitectura

Front y back usan **patrones distintos** (no comparten uno único, a propósito):
cada lado adopta el que mejor encaja con su naturaleza.

### Backend — arquitectura en capas (MVC sin vista / _MSC_)

Flujo `routes → controllers → services → models`. Al ser una **API REST** no hay
Vista (devuelve JSON, no renderiza HTML), así que el patrón es **por capas** con
una capa de _Service_ que un MVC de manual no tiene:

| Capa | Responsabilidad | Ejemplo |
| --- | --- | --- |
| **routes** | declaran los endpoints | `routes/records.routes.ts` |
| **controllers** | traducen HTTP ⇄ dominio (status, errores); **cero** lógica de negocio | `controllers/records.controller.ts` |
| **services** | lógica de negocio pura, sin Express (testeable aislada) | `services/counter.service.ts` (consecutivo atómico) |
| **models** | esquema + persistencia (Mongoose) | `models/record.model.ts` |

Además `app.ts` (construye la app) está separado de `server.ts` (conecta Mongo y
abre el puerto) → los endpoints se testean con **Supertest sin abrir puerto ni
depender de Mongo** ([ADR 7](docs/decisiones.md)).

### Frontend — feature-based + Container/Presentational con hooks (MVVM-like)

Organización **por feature** (no por tipo de archivo) y separación estricta entre
lógica y render. Los **custom hooks actúan como ViewModel**: concentran el estado
y el flujo, y la UI solo consume y pinta.

| Rol (≈ MVVM) | Aquí | Ejemplo |
| --- | --- | --- |
| **Model** | cifrado + capa de red | `crypto/`, `api/` |
| **ViewModel** | custom hooks (estado + flujo, aislados de la UI) | `useNameSubmission`, `useVoiceRecorder`, `useRecords` |
| **View** | componentes `.tsx` (solo props + render) | `WelcomeScreen`, `NameField`, `ResultView` |

Ejemplo: `useNameSubmission` posee la máquina de estados
`idle → loading → success → error` y el flujo `fetchPublicKey → encryptName →
POST → decryptNumber`; `WelcomeScreen` solo consume `{ status, numero, submit }`
y **no sabe cómo se cifra nada**. El **theming white-label se inyecta por Context**
(`ThemeProvider` + `useBrand()`), como otra fuente de datos del ViewModel — por eso
los componentes no tienen ni un hex ni un literal.

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
- **CI/CD con `staging` y deploy por rama** ([ADR 21](docs/decisiones.md)): el flujo es
  `feature → staging → dev → main`. `staging` solo corre CI (integra features sin disparar
  deploys); `dev` despliega a dev y `main` a producción. Las tres ramas están **protegidas**
  (solo por PR, con CI verde). GitHub Actions despliega el front (S3 + CloudFront) y el
  backend se auto-despliega en App Runner; la autenticación con AWS es por **OIDC**, sin
  credenciales de larga duración en el repo.

## Convención de commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `chore:`, `refactor:`, `test:`, `ci:`… Validado automáticamente.

## Estado del proyecto

El backlog y el estado de cada feature (`pending` / `in_progress` / `done` /
`blocked`) se llevan en **[`feature_list.json`](feature_list.json)**; el progreso
de la sesión activa y la evidencia por feature, en **[`progress/`](progress/)**.
