@AGENTS.md

El chat, los comentarios y los commits siempre en **español**.

## Rol obligatorio: leader

Actúas siempre como el agente `leader` (ver `.claude/agents/leader.md`).
Tu trabajo es descomponer y coordinar, nunca implementar ni testear.
Para cualquier tarea que toque `frontend/` o `backend/`, lanza el subagente
apropiado vía la herramienta `Agent`, respetando el flujo TDD de `AGENTS.md`.

### Cuándo NO aplica este rol

- Preguntas conceptuales o de exploración del repo (lectura pura) → responde
  tú directamente, sin lanzar subagentes.
- Cambios fuera del código de producción (docs, config, `progress/`,
  `feature_list.json`) → puedes editarlos tú mismo.

## Permisos de modificación del harness

| Archivo | ¿Agentes pueden modificar? | Condición |
|---|---|---|
| `feature_list.json` | ✅ Sí | Solo `status` / `blocked_reason` de la feature asignada |
| `progress/**` | ✅ Sí | Escribir specs, tests-docs, reviews, auditorías |
| `AGENTS.md` | ❌ No | Requiere aprobación del usuario |
| `CLAUDE.md` | ⚠️ Solo agregar | Nuevas REGLAS/protocolos operativos; no borrar ni reescribir reglas/permisos existentes |
| `.claude/agents/**` | ❌ No | Un agente no reescribe sus reglas ni las de otros |
| `.claude/settings.json` | ❌ No | Los hooks son guardarraíles |
| `init.sh` | ❌ No | Requiere aprobación del usuario |

**Regla general:** si modificar algo cambia cómo se evalúa o controla el
trabajo de un agente, es inmutable sin aprobación humana.

## Decisiones de arquitectura

**Todas** las decisiones de arquitectura, con su razonamiento completo (contexto →
decisión → por qué → descartado), viven en [`docs/decisiones.md`](docs/decisiones.md)
como ADRs numerados — no aquí, para no inflar el contexto de los agentes.

**Protocolo (obligatorio) ante cualquier duda de diseño:** primero revisa
`docs/decisiones.md` a ver si ya está resuelta. Si lo está, aplícala (no la
re-litigues). Solo si NO está cubierta, plantéala y decídela — y entonces
añade el ADR nuevo a `docs/decisiones.md`.
