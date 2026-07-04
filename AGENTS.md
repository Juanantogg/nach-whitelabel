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
  `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`…
- `pre-commit` corre lint-staged (Prettier + ESLint --fix sobre lo staged).
- No hacer commit/push salvo que el usuario lo pida.

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

## Estado

Fase 0 (dev harness + harness de agentes) **completa**: tooling, linting, tests
dummy, CI en verde y sistema multi-agente. La lógica de la prueba (bienvenida,
voz, cifrado, contador, theming por marca) es la siguiente fase — ver
`feature_list.json`.
