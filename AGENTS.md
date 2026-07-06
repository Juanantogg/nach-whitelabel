# AGENTS.md — nach-whitelabel

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
- **Cifrado**: híbrido asimétrico. El backend guarda la clave **privada** (por
  variable de entorno, nunca sale del servidor) y sirve la **pública**; el front
  cifra con la pública (Web Crypto API, sin secreto en el bundle) y el back
  descifra con la privada. Nunca hardcodear claves ni subir `.env` (ver
  `.env.example` y `docs/seguridad.md`).
- **Tests**: Vitest en ambos lados. Front con Testing Library; back con Supertest.
  Priorizar: lógica de cifrado, hook de voz, y render multi-marca.

## Git / commits

- **Conventional Commits** obligatorio (lo valida commitlint en `commit-msg`):
  `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`… El **subject NO
  puede empezar en mayúscula** (regla `subject-case`) — usa minúscula tras los dos puntos.
- `pre-commit` corre lint-staged (Prettier + ESLint --fix sobre lo staged).
- No hacer commit/push salvo que el usuario lo pida.

### Flujo de ramas y deploy (ADR 21 — OBLIGATORIO)

El repo tiene un pipeline CI/CD con cuatro niveles de rama. **Respetarlo es innegociable:**

```
feature ─PR→ staging ─PR→ dev ─PR→ main
           (solo CI)   (deploy dev)  (deploy prod: elektra + shopinbaz)
```

- **`main`, `dev`, `staging` están PROTEGIDAS en GitHub:** el **push directo FALLA**
  (rechazado por branch protection). Todo cambio entra **solo por Pull Request** con el
  **CI en verde** (`quality` + `secret-scan`). No intentes `git push origin main|dev|staging`
  — no funcionará. Trabaja en una **feature branch** y abre PR.
- **`staging`** = rama de integración: **solo corre CI, NO despliega**. Es donde caen los PRs
  de features nuevas, para acumular trabajo sin disparar deploys.
- **Mergear a `dev` despliega el entorno dev. Mergear a `main` despliega PRODUCCIÓN**
  (front prod + auto-redeploy de los backends elektra/shopinbaz en App Runner). Un push a
  `dev`/`main` tiene efectos en producción — trátalo con el mismo cuidado que cualquier
  acción con impacto: solo bajo petición explícita del usuario.
- **Promoción siempre por PR:** `feature→staging`, luego `staging→dev`, luego `dev→main`.
  El gate humano está en aprobar cada PR de promoción.
- **Nota sobre squash-merge:** el repo usa squash. Con ramas de larga vida (staging/dev/main)
  esto hace que diverjan en SHAs aunque el contenido sea idéntico → un PR de promoción puede
  dar conflicto espurio. Se reconcilia realineando la rama de atrás a la de delante (reset a
  la rama destino). Ver `progress/deploy/runbook-prod.md`.
- El deploy del front se hace por **GitHub Actions con OIDC** (rol `GitHubActionsNachDeploy`,
  sin secretos en el repo). El backend se **auto-despliega** por App Runner (no lo tocan las
  Actions). Detalle en ADR 21 y `progress/deploy/`.

## Harness multi-agente

El repo se trabaja con un sistema de orquestación de subagentes (TDD estricto).

- **`init.sh`** — health check: `./init.sh` (deps + lint + typecheck) y
  `./init.sh full` (+ test + build).
- **`feature_list.json`** — backlog con estado (`pending` → `in_progress` →
  `done` / `blocked`) y `layer` (frontend/backend/fullstack) por feature.
- **`.claude/settings.json`** — hooks: `PostToolUse` (lint + typecheck tras
  editar), `Stop` (`init.sh full` al cerrar), `PreToolUse` (bloquea escribir `.env`).
- **`.claude/agents/`** — 7 subagentes (ver tabla). El detalle vive en cada
  `.claude/agents/<nombre>.md`.
- **`progress/`** — evidencia por feature (`progress/<feature>/`), commiteada
  junto al código. `progress/current.md` es el índice efímero de sesión.

### Directorio de agentes

| Agente | Rol | Fase TDD | Entregable |
|---|---|---|---|
| **leader** | Orquesta, descompone, commitea | — | `progress/current.md` |
| **researcher** | Verifica mejores prácticas / APIs en web | pre | `research.md` |
| **designer** | Arquitectura, contratos, layout, tokens de marca | pre | `design.md` |
| **tester** | Escribe tests que FALLAN desde acceptance | **RED** | tests + `tests.md` |
| **implementer** | Mínimo código para pasar los tests | **GREEN** | `frontend/**` / `backend/**` |
| **reviewer** | Valida y limpia | **REFACTOR** | `review.md` |
| **security-auditor** | Audita cifrado/claves (solo si aplica) | post | `security.md` |

### Flujo (TDD)

```
tarea → (researcher) → (designer) → ⏸ aprobación humana si requires_approval
      → tester (RED) → implementer (GREEN) → reviewer (REFACTOR)
      → security-auditor (si toca cifrado/datos)
      → ⏸ HUMANO valida pre-commit (SIEMPRE) → commit → done
```

**RED antes que GREEN es innegociable.** El implementer nunca modifica los
tests para hacerlos pasar. El leader nunca escribe código de producción.
**El leader nunca commitea sin el OK humano** en el gate pre-commit: presenta
resumen + `git diff --stat` + veredictos + mensaje propuesto, y espera.

**El GREEN de backend no está verificado hasta que el módulo CARGA en runtime,
no solo hasta que los tests pasan.** Los tests de endpoint mockean los services y
no importan los modelos reales, así que un import roto en ESM (p.ej. un named
export que no existe, `import { models } from 'mongoose'`) pasa lint + typecheck +
vitest y solo revienta en `pnpm dev`. Por eso: cuando una feature de backend añade
modelos/servicios que los tests mockean, el implementer confirma la carga en
runtime antes de dar el GREEN (`pnpm --filter @nach/backend smoke`, cableado
también en `init.sh full`).

## Estado

Fase 0 (dev harness + harness de agentes) **completa**: tooling, linting, tests
dummy, CI en verde y sistema multi-agente. La lógica de la prueba (bienvenida,
voz, cifrado, contador, theming por marca) es la siguiente fase — ver
`feature_list.json`.
