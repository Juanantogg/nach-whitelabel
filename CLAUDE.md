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

## Decisión: identidad de marca abierta (S3 manda) — brand_config

**Contexto (2026-07-03):** el diseño inicial de `brand_config` fijaba
`brandKeySchema = z.enum(['shopinbaz','elektra'])` y dos marcas bundleadas como
catálogo cerrado. Eso contradice el modelo real "añadir una marca = subir un
JSON a S3, sin tocar código": el enum obligaba a editar código por cada marca.

**Decisión:** la identidad de marca es **abierta**. `BrandKey = string` (sin
enum). En producción manda el bucket S3: el subdominio se usa tal cual para
pedir `<key>.json`; la red de seguridad es el `brandConfigSchema` (Zod con
`.default()` por campo), no una lista hardcodeada. El único bundle de runtime es
**un `default.json` genérico** como fallback offline. `shopinbaz.json`/
`elektra.json` pasan a ser **seeds** en el repo (para subir a S3 y como fixtures
del test multi-marca), NO catálogo importado en runtime.

**Consecuencia:** el `ThemeProvider` recibe una `BrandConfig` **ya resuelta** por
prop (síncrono, testeable); `resolveBrand` + `loadBrand` corren fuera (main.tsx).
`loadBrand` siempre intenta S3 por key y cae al default genérico ante cualquier
fallo. Nunca rompe la app.

**Por qué:** cumple de verdad el principio de arquitectura escalable del
enunciado (marca nueva = un JSON, cero código) y elimina la doble fuente de
verdad (enum vs bucket).
