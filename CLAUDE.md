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
| `CLAUDE.md` | ⚠️ Solo agregar | Nuevas decisiones con su "por qué"; no borrar reglas |
| `.claude/agents/**` | ❌ No | Un agente no reescribe sus reglas ni las de otros |
| `.claude/settings.json` | ❌ No | Los hooks son guardarraíles |
| `init.sh` | ❌ No | Requiere aprobación del usuario |

**Regla general:** si modificar algo cambia cómo se evalúa o controla el
trabajo de un agente, es inmutable sin aprobación humana.
