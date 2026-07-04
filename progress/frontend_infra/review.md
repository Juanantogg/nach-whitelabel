# Review — frontend_infra

**Veredicto:** APPROVED

Fase REFACTOR del TDD. Andamiaje de `@nach/frontend` (env tipado, capa `api/*`,
`ErrorBoundary` raíz) más el refactor de `fetchPublicKey` para centralizar el
acceso al backend. Revisado contra `design.md` (11 criterios) y `tests.md`.

## Resultado de la verificación (ejecutada por el reviewer)

`./init.sh full` → verde de punta a punta:
- **lint**: exit 0. Único warning `react-refresh/only-export-components` en
  `frontend/src/brand/ThemeProvider.tsx:30` — PREEXISTENTE, ajeno a esta feature.
- **typecheck**: front + back sin errores.
- **test**: frontend 94/94, backend 32/32.
- **build**: front (`tsc -b && vite build`) y back OK.
- **smoke** backend: OK.

## Checklist
- **TDD**: [x] RED→GREEN legítimo. Los 4 tests nuevos fallaban por módulo
  inexistente (evidencia en `tests.md`), hoy pasan. NINGÚN test fue alterado
  para pasar: `fetchPublicKey.test.ts` no tiene cambios locales (último commit
  270cb3b, de otra feature) y sigue verde; los `*.test.*` nuevos cubren
  acceptance sin relajarse. Implementación mínima y razonable, sin código muerto.
- **White-label**: [x] El único componente con UI es `ErrorBoundary` y su
  fallback es NEUTRO por diseño (última línea de defensa, puede dispararse sin
  marca resuelta — decisión aprobada en design.md §Riesgos 4). NINGÚN hex en
  `className`: los `#ffffff`/`#1a1a1a` están en `style={{}}` inline como respaldo
  de contraste, tal como el design lo justifica. Copy neutro en español.
- **Backend**: [x] N/A (feature de frontend). Clave privada no aplica; el front
  solo pide la pública en runtime.
- **Calidad**: [x] Cero `any`, cero `console.log` de debug (solo un
  `console.error` de diagnóstico en `componentDidCatch`, correcto). Sin deps
  nuevas (reutiliza `zod` ya presente). `apiFetch` usa `fetch`/`Headers`
  nativos (Web API), sin librería añadida. Sin duplicación:
  `fetchPublicKey` delega en `apiFetch`, no reimplementa el fetch. `index.ts`
  reexporta lo público correcto.
- **Documentación**: [x] Feature de andamiaje sin decisión de arquitectura nueva
  no registrada; hereda y respeta la filosofía "no romper en blanco" ya
  documentada de `brand_config` (CLAUDE.md / decisiones). No requiere ADR nuevo.

## Conformidad con el design (contratos)
- `env.ts`: `Env`, `validateEnv(source?)`, `env`, `isDev` — firmas exactas.
  `validateEnv` es pura, `source` inyectable, usa `safeParse` → NUNCA lanza;
  `env` cae a `{ apiUrl: '' }` si algo fallara (resiliencia OK). Trailing slash
  recortado, `VITE_DEFAULT_BRAND` vacío → `undefined`.
- `ApiError`: `instanceof Error`, `readonly status`, preserva `cause` vía
  `ErrorOptions`. Convención `status 0` = red.
- `apiFetch<T>(path, init?, {fetchFn?, apiUrl?})`: base URL desde `env.apiUrl`,
  una sola barra, `Accept: application/json` mergeado sin pisar headers del
  llamador, `ApiError(0)` en rechazo de red, `ApiError(status)` en `!res.ok`.
- `fetchPublicKey`: firma y retorno (`body.publicKey`) intactos; delega en
  `apiFetch`; ya NO lee `import.meta.env` (usa `env.apiUrl`); conserva el
  MENSAJE exacto `No se pudo obtener la clave pública (HTTP N)` re-mapeando el
  `ApiError` HTTP y propagando `cause`; un fallo de red (status 0) se propaga
  tal cual. Su suite sigue verde sin tocarse.
- `ErrorBoundary`: class component, `getDerivedStateFromError` +
  `componentDidCatch`, prop `fallback` (nodo o render-prop), fallback neutro por
  defecto. `main.tsx` lo monta DENTRO de `<StrictMode>` envolviendo `<App />`.
- `resolveBrand.ts`: NO tocado (sin cambios en git). Sin colaterales.

## Notas menores (no bloqueantes, para futuras features)
- `env.isDev` y `env.defaultBrand` se exportan pero aún no se consumen desde
  `main.tsx`; el design los marcaba como cableado opcional / de welcome_screen.
  No es código muerto (son API pública de la fuente única y `env` sí se usa),
  pero conviene cablearlos cuando welcome_screen los necesite para no dejar la
  centralización a medias. No requiere acción en esta feature.

## Legitimidad RED→GREEN
Confirmado: ningún test fue modificado para pasar. Los tests nuevos partieron de
"módulo inexistente" (RED real, evidencia en tests.md) y el implementer creó el
código mínimo. `fetchPublicKey.test.ts` no tiene diff local y valida el refactor.
