# Review — welcome_screen (Rev.4 — conjunto de la sesión)

**Veredicto:** APPROVED

Segunda revisión que cubre el CONJUNTO actual de la feature (la base ya se aprobó
en la Rev. previa). Foco en lo añadido/cambiado después: `features/welcome/**`,
`loadBrand` + `devSeeds`, schema (+5 textos de flujo), seeds apuntando al bucket
(ADR 13), assets default y cableado (`App`/`main`).

En la primera pasada de esta revisión se RECHAZÓ por 2 tests en rojo
(`ThemeProvider.test.tsx` afirmaba rutas locales de ilustración tras cambiar las
seeds a URLs del bucket). El **tester lo corrigió**: los asserts ahora derivan el
`src` esperado de la seed importada (`config.assets.illustration`) y añaden una
aserción de que las ilustraciones difieren entre marcas
(`ThemeProvider.test.tsx:90-91`, `:107-108`); no se relajó la prueba (los anclas
de color `170 59 255`/`242 74 45` y de título propietario siguen literales) y
`default.json` quedó intacto. Verificado por el reviewer.

## Verificación obligatoria (`./init.sh full` — front+back)

- `pnpm lint` (ambos paquetes) → OK, sin warnings.
- `pnpm typecheck` (ambos, `tsc -b --noEmit`) → OK.
- `pnpm test` → OK: **frontend 140/140**, **backend 32/32** (20 archivos front).
- `pnpm build` → OK: frontend vite build (262.42 kB / 80.40 kB gz) + backend tsc.
- `smoke` (carga runtime del backend) → OK.
- `./init.sh full` → **verde completo** (deps + lint + typecheck + test + build +
  smoke). `dist/` regenerado por el build se limpió al terminar (árbol sin `dist`).

### Comprobación empírica: las seeds NO entran en `dist/` (ADR 12.a/13)

Build limpio + grep sobre `dist/`:
- `brands.garcia3apps.com/elektra|shopinbaz` (URL completa de asset de seed) → 0
  ocurrencias en el JS bundle.
- Título propietario `"Préstamo Elektra"` → 0 ocurrencias en todo `dist/`.
- `elektra`/`shopinbaz` en el JS bundle → 0 ocurrencias.
- La ÚNICA aparición de `brands.garcia3apps.com` en el JS es la constante
  `S3_BASE_URL` (`https://brands.garcia3apps.com`, sin key) —
  `brand/core/constants.ts:13`—, configuración legítima que debe ir en el bundle
  para que `loadBrand` sepa dónde pedir los JSON.
- El único match de `elektra`/`shopinbaz` en todo `dist/` es el comentario del
  SVG `dist/brands/default/illustration.svg` (fallback bundleado esperado, ADR 13).

Conclusión: el tree-shaking de la guarda `import.meta.env.DEV` (`loadBrand.ts:22`,
`devSeeds.ts`) excluye las seeds del bundle de producción. `dist/` limpiado tras
la comprobación.

## Checklist

- **TDD:** [x] — RED real previo documentado en `tests.md` (5 módulos ausentes +
  2 asserts de schema + 4 casos de dev en `loadBrand`). Tests nuevos fieles a
  `tests.md` y exigentes: orden exacto `fetchPublicKey→encryptName→apiFetch→
  decryptNumber` (`useNameSubmission.test.ts:116`), payload EXACTO
  `{encryptedKey,iv,ciphertext}` (`:131`), caché del PEM (`:144`), error sin
  filtrar `422`/`decrypt` (`:213`); matriz dev/prod × S3/seed/default de
  `loadBrand.test.ts` fiel a la tabla de `tests.md`. El fix del test de ancla no
  relaja: deriva el esperado de la fuente de verdad (la seed) y añade la
  aserción de diferencia entre marcas. Implementación mínima, sin código muerto.

- **White-label:** [x] — Cero hex/`rgb()` en `features/welcome/**` (grep limpio).
  Cero literales en JSX: todo vía `useBrand()` (`text.*`, `assets.*`, `voice.*`).
  Colores solo por tokens `bg-brand-*`/`text-brand-*` + CSS vars
  (`--brand-radius`, `--brand-title-weight`). Contador `counterTemplate` →
  "0/15 caracteres" con `NAME_MAX_LENGTH` (`NameField.tsx:33-35`); límite 15 en
  DOM (`maxLength`) y en handler + `onResult` de voz (`clampToMax`). Marca nueva =
  un JSON: los 5 textos de flujo añadidos al schema tienen `.default()`
  (`schema.ts:44-48`), JSON parcial sigue válido. Coherencia ADR 13: seeds al
  bucket, `default.json` conserva assets bundleados (SVG válidos), `assets.*` son
  `z.string()` sin regex de ruta. Multi-marca real con seeds parseadas. Sin doble
  fuente de verdad.

- **loadBrand:** [x] — Cadena de fallback conforme a ADR 12.a. Dev: S3 → seed →
  default; Prod: S3 → default (seeds ignoradas) — verificado en la matriz de
  `loadBrand.test.ts` (casos 5a-c: prod cae al default, NO a la seed). Nunca
  lanza (`fetchFromS3`/`loadSeed` capturan todo → `null`; siempre retorna
  `BrandConfig`). `devSeeds` fuera del bundle de prod: confirmado empíricamente
  por grep de `dist/` (arriba).

- **Backend:** [x] (no tocado) — Contrato front↔back verificado contra
  `crypto.controller.ts`: front POSTea `{encryptedKey,iv,ciphertext}` y el back
  responde `{iv,ciphertext}` directo, justo lo que consume `decryptNumber`.
  Capas y `app.ts`/`server.ts` intactas; clave privada solo desde env. Smoke OK.

- **Calidad:** [x] — Sin `any`, sin `console.*` en el código nuevo. Convención:
  componente-por-carpeta PascalCase con barrel; `useNameSubmission` como hook
  suelto en `features/welcome/`. Sin dependencias nuevas. Accesibilidad básica:
  `role="alert"` en error, `aria-label` de voz desde marca, `aria-hidden` en el
  icono SVG, placeholder de marca. Reutiliza cripto/voz/api existentes.
  `main.tsx` monta `<ThemeProvider config={brand}>` con la marca resuelta dentro
  del `ErrorBoundary`; el árbol carga en runtime (build + smoke OK).

- **Documentación (ADR):** [x] — `docs/decisiones.md` incorpora ADR 12, 12.a
  (fallback dev) y 13 (assets en bucket) con contexto/decisión/porqué/descartados,
  coherentes con el código. `CLAUDE.md` compactado a puntero + protocolo (estilo,
  no bloquea). ADRs previos siguen coherentes.

## Observaciones menores (no bloquean)

1. `useNameSubmission.ts:66` — `errorMessage` se puebla con la propia clave
   (`'network'`/`'generic'`), duplicando `errorKind`; la UI solo lee `errorKind`.
   Forma parte del contrato de `tests.md` y lo ejercita el test `:213`, así que
   no es código muerto, pero es redundante. Revisable a futuro.

Nada que requiera cambios de comportamiento. Aprobado para el gate pre-commit.
