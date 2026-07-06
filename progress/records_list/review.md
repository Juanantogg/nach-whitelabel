# Review — records_list

**Veredicto:** APPROVED

Fase REFACTOR del TDD. Revisión de la feature `records_list` (fullstack: endpoint
`GET /records`, pantalla `/records`, React Router, bloque de textos `text.records`).

## Checklist

- **TDD:** [x] — Los tests existían en RED (tests.md documenta el fallo por ausencia de
  código/dependencia, no por typo) y ahora pasan en GREEN. El implementer NO relajó los
  tests: las aserciones del contrato siguen intactas (no-`_id`/`__v`/`updatedAt`, 500
  `internal_error`, sin rate-limit con `RATE_LIMIT_MAX=2` → ninguna 429, nombre completo
  Juan/Ana sin enmascarar, grep de hex en el `.tsx`). Implementación mínima, sin código
  muerto ni sobre-ingeniería.
- **White-label:** [x] — CERO literales de texto y CERO hex en `RecordsList.tsx`,
  `useRecords.ts`, `fetchRecords.ts` (grep confirmado). Todos los textos vienen de
  `useBrand().text.records`; todos los colores por tokens `bg-brand-*`/`text-brand-*` y
  `border-brand-surface`, exactamente el set de WelcomeScreen (ningún token nuevo). El
  bloque `text.records` en schema.ts tiene `.prefault({})` + `.default()` por los 6 campos
  → marca nueva = un JSON, ninguna seed existente rota. Ilustración/estilo también por
  marca (`assets.logo` con fallback a DEFAULT_BRAND, mismo patrón que welcome). No toca la
  pantalla de captura.
- **Backend:** [x] — Capas `routes → controllers → services` respetadas: lógica de query
  en `record.service.ts`, traducción a HTTP en el controller, router fino. `app.ts`
  testeable con Supertest (separado de server.ts). `/records` montado en el bloque de
  LECTURA (tras `/crypto`, antes del bloque con `makeLimiter()`), SIN rate-limit, coherente
  con la política existente (`/health`, `/crypto`). Contrato correcto:
  `{ sequence, name, createdAt }`, `sort({ sequence:-1 })`, `.limit(100)` (MAX_RECORDS),
  `.lean()`, proyección `_id:0`. 500 `internal_error` sin fuga de detalle. `Record` por
  default-import de mongoose (patrón ESM del repo). Sin claves/secretos.
- **Calidad:** [x] — `./init.sh full` en VERDE: lint + typecheck + test (backend 63 /
  frontend 280) + build + smoke (`SMOKE_OK`). Sin `any` (usa `as unknown as LeanRecordDoc[]`
  acotado en el service, justificado por el tipado laxo de `.lean()`), sin `console.log`.
  Única dependencia nueva `react-router-dom`, discutida y aprobada en ADR 27. Reutiliza
  `apiFetch`/`ApiError` (cero fetch a mano), stdlib (`Date.toISOString`). Componente-por-
  carpeta con barrel, comentarios en español, nombres coherentes con el repo.

## Puntos verificados adicionales

- **ADR 26 (nombre completo):** el listado muestra el nombre sin enmascarar; test lo afirma
  (Juan/Ana). Coherente con alias voluntarios / no-PII-sensible. El endpoint no expone
  `_id`/`__v`/`updatedAt` (proyección + test). Sin fuga en el 500.
- **ADR 27 (React Router):** `/` → WelcomeScreen, `/records` → RecordsList. `BrowserRouter`
  en `main.tsx` DENTRO de `ThemeProvider` (ambas rutas comparten marca), como pide el design.
  Cero `<Link>`/`<a href>`/`to=` hacia `/records` en welcome/App (grep confirmado). Flujo de
  welcome intacto (App.test.tsx envuelto en MemoryRouter, previsto por el tester).
- **Estados del hook:** loading/error/empty/success completos y usados por la UI. Accesibilidad:
  loading en `aria-live="polite"`, error en `role="alert"`, cabeceras `<th scope="col">`.
  `empty` como estado propio (decisión #2 del design). Guarda anti-set-tras-desmontar.
- **Riesgo ESM runtime:** smoke cubre la carga del nuevo service (`SMOKE_OK`). Import por
  default de mongoose correcto; sin imports sospechosos.
- **Documentación:** ADR 26 y 27 registrados en `docs/decisiones.md` con contexto/decisión/
  porqué/descartado. Decisión de diseño relevante documentada. No requiere entrada en README.

## Sugerencias no bloqueantes

Ninguna. La implementación es la mínima razonable y limpia. `createdAt` se proyecta y viaja
en el contrato pero la UI no lo pinta todavía; es una decisión de diseño explícita (#1,
"el front decide si lo muestra") y dato gratis, no código muerto.

## Cambios requeridos

Ninguno.
