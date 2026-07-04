# Review — consecutive_counter

**Veredicto:** APPROVED

Fase REFACTOR del TDD. Se valida el GREEN de `consecutive_counter` contra su
acceptance (`feature_list.json`), su `design.md`, sus `tests.md` y las
convenciones de `AGENTS.md`/`CLAUDE.md`. No se editó código de producción.

## Checklist

- **TDD:** [x] — RED real registrado en `tests.md` (10 tests nuevos en rojo:
  5 env + 5 names; el #3 round-trip verde como red anti-regresión). GREEN actual
  32/32. El implementer NO relajó los tests: las aserciones de secuencia (n1<n2,
  números provenientes del service), falla-cerrado (`createRecordMock` no invocado
  en el 16-chars) y 500 se conservan intactas. El ajuste de mock en
  `crypto.routes.test.ts` (L39-41) solo desacopla el service de Mongo; ninguna
  aserción de cifrado se ablandó (200 / IV nuevo / `/^\d+$/` preservados).
  Implementación mínima y sin código muerto: `stubCounter` eliminado, techo de 256
  reemplazado por 15.

- **White-label:** [x] — N/A. Feature de backend puro, sin UI ni literales de marca.

- **Backend:** [x] — Capas respetadas: `routes → controllers → services`; la
  reserva del consecutivo y la persistencia viven en
  `services/counter.service.ts:12`, el controller solo orquesta y mapea errores
  (`controllers/crypto.controller.ts:56-97`). `app.ts` sigue testeable con
  Supertest sin arrancar Mongo (service mockeado). `validateEnv` es pura y NO
  aborta al importar `env.ts` (`config/env.ts:61`); el `process.exit(1)` vive solo
  en `server.ts:11`. La clave privada se lee solo de env (`env.ts:17`,
  `crypto.controller.ts:34`) y no aparece en logs de error (solo se loguea
  `result.error.issues`, no la clave).

- **Calidad:** [x] — `pnpm --filter @nach/backend lint` limpio, `typecheck` sin
  errores, `test` 32/32, y `./init.sh full` (deps+lint+typecheck+test+build)
  en verde. Sin `any` (grep limpio). Sin `console.log` de debug; los tres
  `console.*` restantes están en `server.ts` (boot/fail-fast), pendientes de pino
  en `backend_hardening` — anotado, no bloqueante. Sin dependencias nuevas fuera
  de `zod`, que la propia acceptance nombra explícitamente. Modelos Mongoose
  registrados de forma idempotente (`models.X ?? model(...)`) para sobrevivir a
  `vi.resetModules()`. Imports ESM con `.js` como el resto del repo. Comentarios
  en español.

## Acceptance con evidencia

1. **Consecutivo sin colisiones ni huecos por diseño** [x] —
   `counter.service.ts:15-19`: `Counter.findOneAndUpdate({_id}, {$inc:{seq:1}},
   {new:true, upsert:true})`. `$inc` atómico a nivel de documento serializa las
   concurrentes; `upsert` arranca en frío (primer número = 1). Red extra:
   `record.model.ts:15` `sequence` con `unique: true, index: true`.
2. **Persistencia Mongo/Mongoose que sobrevive reinicios** [x] — dos colecciones
   Mongoose (`counter.model.ts`, `record.model.ts`); el número vive en `counters`,
   no en memoria. El `stubCounter` en memoria fue eliminado del controller.
3. **Lógica en services, testeable con Supertest sobre app.ts** [x] —
   `createRecord(name): Promise<number>` en services; endpoints probados con
   Supertest y service mockeado (`names.routes.test.ts`).
4. **Fail-fast del entorno con Zod (MONGODB_URI + CRYPTO_PRIVATE_KEY PEM) que
   aborta el arranque** [x] — `env.ts:33-42` (regex `^mongodb(\+srv)?://` para la
   URI; `.refine(loadsAsPem)` carga la clave de verdad, no solo el prefijo);
   `server.ts:8-12` aborta con `process.exit(1)` antes de `connectDb()`/`listen()`.
5. **Validación de payload (longitud ≤ 15) con 400 falla-cerrado** [x] —
   `crypto.controller.ts:81-84`: `name.length > 15 → 400 invalid_payload`, tras
   descifrar y ANTES de `createRecord` (no persiste). Techo de 256 eliminado.
6. **Tests de secuencia, validación de entorno y rechazo de payload (RED antes)**
   [x] — `names.routes.test.ts` (grupos 1-2), `env.validate.test.ts` (grupo 3),
   RED evidenciado en `tests.md`.

## Puntos de atención (verificados)

- `createRecord` reserva el número (`$inc`) ANTES de `Record.create` y propaga los
  errores de Mongo (no hay try/catch que los trague en el service). El controller
  los mapea a `500 internal_error` sin filtrar detalle (`crypto.controller.ts:90`).
  Test #4 lo confirma.
- Longitud: `> 15 → 400` ANTES del service; test #5 verifica que `createRecord`
  NO se invoca (falla-cerrado); test #6 confirma que 15 exacto → 200.
- `validateEnv` no aborta al importar `env.ts`; el `env` de conveniencia mantiene
  su forma (`cryptoPrivateKey`, no `cryptoSecret`) — `env.test.ts` sigue verde.
- `sequence` con índice único (`record.model.ts:15`) y `name` maxlength 15
  (`record.model.ts:16`) como defensa en profundidad.

## Hallazgos

### Bloqueantes
- Ninguno.

### Menores
- Ninguno que impida aprobar.

### Notas para otras features
- `server.ts` conserva 3 `console.*` (boot / fail-fast / error de arranque). Es lo
  correcto para esta fase; su migración a `pino` es acceptance explícita de
  `backend_hardening` (`feature_list.json`, decisión "pino + pino-http"). No
  bloquea.
- El fallo tras reservar contador y antes de `Record.create` puede dejar un número
  "gastado" (hueco). El design lo justifica (§ "Nota de diseño"): preferible a una
  colisión, y "sin huecos" aplica al camino feliz/concurrencia. Aceptado.
- La atomicidad real del `$inc` contra Mongo es un test de integración opcional
  (mongodb-memory-server), no obligatorio para el GREEN según el design. No se
  añadió; correcto.

## Documentación (ADR)
- [x] Las decisiones de esta feature (contador atómico persistido, fail-fast de
  env con Zod, longitud ≤ 15) están ya registradas en `docs/seguridad.md` (§1, §5,
  tabla de mejoras #4/#7) y en `docs/decisiones.md` (arquitectura en capas +
  contador consecutivo). Siguen coherentes; no hay decisión nueva sin registrar.

## Verificación

```
pnpm --filter @nach/backend test       →  Test Files 6 passed (6) · Tests 32 passed (32)
pnpm --filter @nach/backend typecheck  →  tsc --noEmit  (sin errores)
pnpm --filter @nach/backend lint       →  eslint .      (limpio)
./init.sh full                         →  deps + lint + typecheck + test + build  → OK
                                          (backend 32/32, frontend 52/52, build OK)
```

El único warning de `./init.sh` (react-refresh en `ThemeProvider.tsx`) es
preexistente de `brand_config`, ajeno a esta feature.

## Conclusión

**APROBADO.** El leader puede pasar a `security-auditor` (toca descifrado de datos
del usuario, manejo de la clave privada de env y persistencia del nombre en claro)
y luego al gate pre-commit humano.
