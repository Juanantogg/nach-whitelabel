# Review — brand_config

**Veredicto:** APROBADO

Fase REFACTOR (TDD) validada. La implementación GREEN cumple el contrato de
`design.md` al pie de la letra, respeta el white-label estricto y deja el árbol
limpio. `./init.sh full` en verde. No hay cambios de producción pendientes.

## Estado de verificación

- `pnpm --filter @nach/frontend test` → **7 files, 32 tests passed** (31 brand + 1 App).
- `pnpm --filter @nach/frontend lint` → **0 errores, 1 warning** (react-refresh en
  ThemeProvider.tsx; ver hallazgo #1, aceptado).
- `pnpm --filter @nach/frontend typecheck` → limpio (`tsc -b --noEmit`).
- `./init.sh full` → **OK** (deps + lint + typecheck + test + build). Build de
  producción del frontend correcto (16 módulos, CSS+JS emitidos).
- Nota: el bloqueo de `require-await` en `loadBrand.test.ts` que reportaba
  `implementation.md` **ya está resuelto**: los mocks usan `Promise.resolve(...)`
  con `json: () => Promise.resolve(...)`, sin `async` vacío. Lint limpio de errores.

## Checklist

- **TDD:** [x] Los 6 archivos de test existían en RED por imports no resueltos
  (evidencia en `tests.md`) y ahora pasan sin que el implementer relajara ninguna
  aserción. Comparados 1:1 con `tests.md`: valores, firmas y nombres intactos. Las
  aserciones son reales (no falsos verdes): comprueban valores concretos
  (`170 59 255` vs `242 74 45`), rutas de asset, textos de marca y ramas de
  fallback. Implementación mínima y razonable, sin código muerto.
- **White-label:** [x] CERO hex/`rgb(`/literales en `.tsx` de producción
  (grep vacío). Los valores concretos viven solo en `data/*.json` (correcto: es
  data, no componente). `ThemeProvider`/`BrandShowcase` leen textos y rutas vía
  `useBrand()`; colores vía CSS vars `--brand-*` inyectadas por `applyBrandToDom`
  y tokens `@theme inline` en `index.css`. Añadir marca = añadir `<key>.json` +
  registrarla en `registry.ts`, sin tocar componentes (acceptance #8 cubierto por
  test). El límite 15 queda como `NAME_MAX_LENGTH` (constante compartida, no
  config) y se testeará en welcome_screen, según diseño.
- **Backend:** [x] N/A — feature 100% frontend (`layer: frontend`).
- **Calidad:** [x] Sin `any` en producción; tipos derivados de Zod
  (`z.infer`). Sin `console.*`, sin `eslint-disable`, sin dependencias nuevas no
  discutidas (Zod v4 ya estaba justificado en `research.md`/`tests.md`). Sin
  duplicación evidente. Los únicos `as unknown as typeof fetch` están en mocks de
  test (aceptable).
- **Documentación (ADR):** [x] La decisión de theming/white-label, la carga
  S3+fallback y la selección por entorno están registradas en
  `docs/decisiones.md` (secciones 2, 3 y 5 con contexto/porqué/alternativas), y el
  `README.md` (líneas 68-73) sigue coherente con lo implementado.

## Validaciones específicas del encargo

1. **Contrato del diseño:** [x] Exports, firmas, módulos y valores coinciden
   exactamente con `design.md`: `brandConfigSchema`/`parseBrandConfig`/`BrandConfig`/
   `BrandKey` (schema.ts), `BUNDLED_BRANDS`/`BRAND_KEYS`/`DEFAULT_BRAND_KEY`
   (registry.ts), `resolveBrand(input)` puro con deps inyectadas, `loadBrand(key, deps)`,
   `applyBrandToDom(config)`, `ThemeProvider`+`useBrand()`, `NAME_MAX_LENGTH=15`+
   `S3_BASE_URL`. `.prefault({})` en bloques anidados (Zod v4) implementa
   correctamente el requisito "JSON parcial → config completa".
2. **9 acceptance cubiertos:** [x] #1,#3 schema.test; #5 registry.test; #4
   resolveBrand.test (9 casos, prod/dev, subdominio, `?brand=`, `VITE_DEFAULT_BRAND`,
   claves inexistentes); #2,#3 loadBrand.test (dev sin red, JSON válido, rechazo
   CORS, 404, JSON malformado→fallback); #6 applyBrandToDom.test; #7,#8,#9
   ThemeProvider.test (render multi-marca con el MISMO componente). Ninguno falso.
3. **Resiliencia:** [x] `loadBrand` envuelve fetch+parse en `try/catch` y cubre
   `!res.ok` → fallback bundleado; nunca lanza al render. `resolveBrand` siempre
   devuelve una `BrandKey` válida (cadena `?? DEFAULT_BRAND_KEY`). Zod rellena
   defaults en JSON parcial (verificado por test del JSON remoto parcial).
4. **Calidad TS:** [x] Sin `any`, tipos derivados de Zod, sin código muerto.
5. **Assets:** [x] Existen `frontend/public/brands/{shopinbaz,elektra}/{logo,illustration}.svg`
   (placeholders SVG mínimos, marca-coherentes). No quedan como deuda de carga; el
   refinamiento visual de la ilustración final es propio de welcome_screen, pero
   las rutas del diseño resuelven a un asset real hoy.

## Hallazgos

1. **[Menor / aceptado] `ThemeProvider.tsx:30` — warning `react-refresh/only-export-components`.**
   Causa: se co-exportan el componente `ThemeProvider` y el hook `useBrand()` en el
   mismo archivo. Es warning (no error), no bloquea lint ni build, y el patrón es
   idiomático de React Context. **Recomendación:** aceptable dejarlo así en esta
   feature. Si se quiere eliminar limpiamente en un refactor posterior, el patrón
   canónico es separar el Context+hook a `frontend/src/brand/useBrand.ts` (o
   `brandContext.ts`) y dejar `ThemeProvider.tsx` exportando solo el componente;
   el test importa ambos, así que habría que ajustar imports del test (tarea del
   tester, no del implementer). No es requisito para aprobar: el warning está en
   `warn` a propósito y no compromete la calidad del GREEN.

## Cambios requeridos

Ninguno. APROBADO.

---

## Re-revisión tras refactor de tests (lente "arquitectura escalable")

**Veredicto final: APROBADO (se mantiene).**

El tester desacopló los tests de MECANISMO de los DATOS de marca sin relajar
cobertura ni introducir falsos verdes. 34 tests (antes 32).

### Verificación

- `pnpm --filter @nach/frontend test` → **7 files, 34 tests passed**.
- `pnpm --filter @nach/frontend lint` → **0 errores, 1 warning** (react-refresh,
  ya evaluado y aceptado).
- `pnpm --filter @nach/frontend typecheck` → limpio.

### Cobertura de las anclas de dato (lo que pedía el encargo)

- **shopinbaz ES morado / elektra ES rojo:** garantizado por DOS sitios:
  1. `registry.test.ts` (sin cambios): aserciones duras
     `BUNDLED_BRANDS.shopinbaz.colors.primary === '170 59 255'` y
     `elektra.colors.primary === '242 74 45'`, más `DEFAULT_BRAND_KEY === 'shopinbaz'`.
  2. `ThemeProvider.test.tsx`: 2 tests "ANCLA" con literales intencionales
     (`170 59 255` / `242 74 45`), títulos e ilustraciones concretos por marca.
     Si alguien confunde las marcas o cambia su identidad de dato, estos tests
     rompen. Esta es la red que sostiene la parte "genérica".

### Los 9 acceptance siguen cubiertos con aserciones reales

- #1,#3 (`schema.test.ts`): defaults anclados contra `parseBrandConfig({})` — NO
  tautológico: verifica `undefined` == `{}`, que un parcial respeta lo provisto e
  iguala el resto al default (`config.colors === defaults.colors`), y el rechazo
  de color inválido con literal `'morado'`. Prueba el MECANISMO, no el copy.
- #4 (`resolveBrand.test.ts`): `OTHER_BRAND_KEY` = marca del registry ≠ default,
  modela "resuelve a marca concreta y NO a la default". Cubre prod (subdominio,
  apex, subdominio desconocido, `?brand=` ignorado), dev (`?brand=` > env >
  primera, clave inexistente, subdominio no leído). Correcto: la identidad de la
  marca concreta se ancla en registry, aquí se prueba el flujo de selección.
- #5 (`registry.test.ts`): sin cambios, anclas duras de las 2 marcas.
- #2,#3 (`loadBrand.test.ts`): sin cambios (dev sin red, JSON válido, rechazo,
  404, malformado → fallback).
- #6 (`applyBrandToDom.test.ts`): sin cambios.
- #7,#8,#9 (`ThemeProvider.test.tsx`): `it.each` contra `BUNDLED_BRANDS[key]`
  prueba que el MISMO componente refleja los datos de la marca inyectada
  (mecanismo) + 2 anclas de dato #9/#5. Cubre render multi-marca y "cambiar de
  marca no toca el componente".

### Conclusión

Ninguna aserción se "generizó de más": cada acceptance conserva una verificación
real y, para los datos de identidad de marca, hay anclas explícitas con literales
intencionales. El refactor mejora la escalabilidad (añadir una marca no obliga a
reescribir los tests de mecanismo) sin sacrificar la garantía de que las marcas de
ejemplo son correctas. Se mantiene **APROBADO**. Sigue sin haber cambios de
producción requeridos; el único warning (react-refresh) permanece aceptado.

---

## Re-revisión Rev.2 — identidad de marca abierta (S3 manda)

**Veredicto final: APROBADO.**

Migración del catálogo cerrado (Rev.1) al modelo abierto validada contra
`design.md` Rev.2 y la decisión de `CLAUDE.md`. `./init.sh full` en verde.

### Estado de checks

- `./init.sh full` → **OK** (deps + lint + typecheck + test + build).
- Test: **7 files, 41 tests passed** (40 brand + 1 App). Build de producción
  frontend correcto (16 módulos).
- Lint: **0 errores, 1 warning** (react-refresh en ThemeProvider.tsx, ya
  evaluado y aceptado en revisiones previas).
- Typecheck: limpio.

### Validación punto por punto del encargo

1. **Enum eliminado de verdad:** [x] `grep` confirma que NO existen en runtime
   `BUNDLED_BRANDS`, `BRAND_KEYS` ni `brandKeySchema`. `schema.ts` declara
   `export type BrandKey = string`. El único `z.enum` que queda es
   `buttonVariant: z.enum(['solid','soft'])` (enum de ESTILO, no catálogo de
   marcas — correcto, no aplica). No hay lista hardcodeada de marcas como
   catálogo en runtime.
2. **1 solo default genérico:** [x] `registry.ts` expone `DEFAULT_BRAND`
   (parseado de `data/default.json`) + `DEFAULT_BRAND_KEY = 'default'`. `data/`
   solo contiene `default.json`. `seeds/{shopinbaz,elektra}.json` existen y NO se
   importan en runtime: `grep seeds/` fuera de tests solo aparece en un comentario
   JSDoc de `registry.ts` (no es import). Registry importa únicamente
   `data/default.json`. `registry.test.ts` incluso asserta que
   `BUNDLED_BRANDS`/`BRAND_KEYS` ya no son propiedades del módulo.
3. **resolveBrand sin filtrado:** [x] Prod devuelve `hostname.split('.')[0]` tal
   cual (`banco_azteca.garcia3apps.com → 'banco_azteca'`, testeado explícitamente;
   `elektra → 'elektra'`; apex `garcia3apps.com → 'garcia3apps'` verbatim, será
   loadBrand/S3 quien caiga al default). Guard `|| DEFAULT_BRAND_KEY` solo si el
   primer label sale vacío (hostname `''`). Dev: `?brand= || defaultBrand ||
   DEFAULT_BRAND_KEY`, sin filtrar keys (testeado con `?brand=marca-que-no-existe`
   → se devuelve tal cual). Eliminado `asBrandKey`.
4. **loadBrand:** [x] `key: string`. Fallback SIEMPRE a `DEFAULT_BRAND` ante
   cualquier fallo (dev/sin s3, `!res.ok`/404, reject CORS, JSON malformado/Zod,
   key inexistente). `try/catch` envuelve fetch+parse. Nunca lanza. Cubierto por 6
   tests incluyendo key inexistente (`banco_azteca` → 404 → default).
5. **ThemeProvider por config:** [x] Firma `config: BrandConfig` (ya no `brand=`).
   Ya no importa registry ni resuelve/carga nada; recibe la config por prop, la
   expone por `useBrand()`, aplica `applyBrandToDom` en `useEffect`. `main.tsx`
   sigue montando `<App />` con solo tokens de tema (cero literales) y **arranca
   correctamente** (build OK). La orquestación `resolveBrand`+`loadBrand`+
   `<ThemeProvider config>` NO está cableada aún en main.tsx: el design Rev.2 la
   ubica "en main.tsx o un hook de arranque" y `implementation.md` la difiere
   explícitamente a welcome_screen/deploy. Es deuda CONOCIDA y coherente con el
   alcance de esta feature (que entrega la LÓGICA, no la integración de pantalla).
   Ver hallazgo #2.
6. **Coherencia escalable:** [x] "Añadir marca = subir un JSON a S3, cero código"
   se cumple: no hay punto de runtime que enumere marcas. Una marca nueva se
   resuelve por subdominio (sin filtro), se pide a S3 por key y Zod la valida; si
   no existe, cae al default. Cero edición de código.
7. **Anclas de dato:** [x] Se conservan y ahora apuntan a los seeds:
   `registry.test.ts` asserta `shopinbazSeed.colors.primary === '170 59 255'` y
   `elektraSeed.colors.primary === '242 74 45'`, más que DEFAULT_BRAND es NEUTRO
   (distinto de ambos). `ThemeProvider.test.tsx` mantiene 2 tests "ANCLA" con
   literales intencionales (morado/rojo, títulos e ilustraciones concretos) además
   del `it.each` de mecanismo contra la config parseada del seed. Sin falsos
   verdes: confundir marcas rompe las anclas.

### Deuda / calidad de datos

- **default.json neutro:** [x] No es un clon de shopinbaz. Primary violeta neutro
  `124 92 252` (distinto del morado `170 59 255` y del rojo `242 74 45`), `name`
  genérico "Marca", `title` sin nombre de cliente ("¡Te damos la bienvenida!"),
  assets bajo `/brands/default/`. Un test lo verifica explícitamente.
- **assets default:** [x] Existen `frontend/public/brands/default/{logo,illustration}.svg`
  (SVG placeholder neutro, coherentes con el violeta del default).

### Hallazgos

1. **[Menor / aceptado] react-refresh warning en `ThemeProvider.tsx`.** Idéntico a
   revisiones previas: co-export de `useBrand()` con el componente. Warning, no
   error; no bloquea. Recomendación de split a módulo aparte sigue vigente como
   mejora opcional futura, no requisito.
2. **[Deuda conocida / no bloqueante] `main.tsx` aún no cablea la orquestación.**
   `main.tsx` monta `<App/>` sin `resolveBrand`/`loadBrand`/`<ThemeProvider>`.
   Está documentado en `implementation.md` como diferido a welcome_screen/deploy y
   el design Rev.2 lo permite ("main.tsx o un hook de arranque"). Esta feature
   entrega la lógica testeada, no la pantalla. **Acción sugerida (para
   welcome_screen):** en `main.tsx` (o hook de arranque), resolver
   `key = resolveBrand({hostname, search, isDev, defaultBrand})`, `config = await
   loadBrand(key, {isDev, s3BaseUrl})` y montar `<ThemeProvider config={config}>`.
   No es cambio requerido para aprobar brand_config.

### Conclusión

La migración Rev.2 cumple el contrato del diseño y la decisión de arquitectura al
pie de la letra: identidad abierta real, un único default neutro de runtime, seeds
fuera del runtime, resolveBrand/loadBrand sin catálogo, ThemeProvider por config.
Cobertura íntegra de los 9 acceptance reinterpretados con anclas de dato reales y
sin falsos verdes. Sin cambios de producción requeridos. **APROBADO.**

---

## Re-review final Rev.2.1 — apex/www → default por conteo de labels

**Veredicto final consolidado de brand_config: APROBADO.**

Cambio acotado a `resolveBrand` (+ `BASE_DOMAIN` en constants, + dep `baseDomain`
en `ResolveBrandInput`, + helper `brandFromSubdomain`). El resto de la feature
intacto. `./init.sh full` en verde.

### Estado de checks

- `./init.sh full` → **OK** (deps + lint + typecheck + test + build).
- Test: **7 files, 43 tests passed** (42 brand + 1 App).
- Lint: **0 errores, 1 warning** (react-refresh en ThemeProvider.tsx, aceptado).
- Typecheck y build de producción frontend: OK.

### Validación del cambio

1. **Apex/www → default:** [x] `hostname === baseDomain` (apex) y
   `www.<base>` caen a `DEFAULT_BRAND_KEY` (ya NO 'garcia3apps' verbatim → sin 404
   espurio de `garcia3apps.json` en S3). `elektra.<base>` → 'elektra'; key abierta
   intacta (`banco_azteca.<base>` → 'banco_azteca'). Cubierto por tests explícitos.
2. **Heurística de conteo de labels correcta:** [x] `brandFromSubdomain` compara
   por **label boundary**: `suffix = '.' + baseDomain` y `hostname.endsWith(suffix)`.
   Edge case pedido confirmado: `'notgarcia3apps.com'.endsWith('.garcia3apps.com')`
   es **false** → cae a default (NO se trata como subdominio por coincidencia
   parcial de substring). Multi-label (`elektra.otrodominio.com`, o prefijo con
   `.`) → default; prefijo vacío (apex) → default; `www` → default. Todos los
   guards presentes y testeados.
3. **Dev sin cambios:** [x] En dev el subdominio no se lee y `baseDomain` se
   ignora; orden `?brand=` > `VITE_DEFAULT_BRAND` > `DEFAULT_BRAND_KEY` intacto
   (test explícito con `elektra.<base>` en dev → default).
4. **BASE_DOMAIN coherente:** [x] Vive en `constants.ts` ('garcia3apps.com') con
   doc que explica su rol. Se inyecta como dep (no se lee dentro de la función pura
   → testeable). `main.tsx` no roto (build OK); su cableado real sigue diferido a
   welcome_screen (deuda conocida, punto #2 de la re-review Rev.2).
5. **Sin regresiones:** [x] Anclas de dato (shopinbaz morado `170 59 255` /
   elektra rojo `242 74 45` contra seeds), schema, loadBrand, applyBrandToDom,
   ThemeProvider por config, registry con único default neutro: todo intacto. No
   queda residuo del `hostname.split('.')[0]` anterior.

### Conclusión consolidada

brand_config queda APROBADO en su estado final (Rev.2.1). La lógica white-label
—schema Zod con defaults, identidad de marca abierta (S3 manda), único default
neutro de runtime, seeds fuera del runtime, resolveBrand con distinción
apex/subdominio por conteo de labels, loadBrand con fallback siempre al default,
ThemeProvider por config e inyección de CSS vars— cumple el diseño y las
decisiones de arquitectura, con los 9 acceptance cubiertos por 42 tests reales y
anclas de dato sin falsos verdes. Deuda no bloqueante documentada: (1) warning
react-refresh en ThemeProvider.tsx; (2) cableado de la orquestación en main.tsx
diferido a welcome_screen. Ningún cambio de producción requerido para cerrar
brand_config.
