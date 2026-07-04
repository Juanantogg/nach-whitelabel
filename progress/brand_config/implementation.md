# Implementation (GREEN) — brand_config

## Rev.2.1 — ajuste del tratamiento del apex en resolveBrand (GREEN acotado)

Ajuste GREEN de alcance reducido tras decisión del usuario: `resolveBrand`
distingue "subdominio de marca" de "apex / www / host ajeno" contando labels
contra un dominio base INYECTADO. **43/43 tests verde, lint y typecheck exit 0.**

Cambios (solo 2 archivos de producción, sin tocar tests):

- `constants.ts` — NUEVA `BASE_DOMAIN = 'garcia3apps.com'` (dominio base de la
  app en prod; punto único de config, lo inyecta `main.tsx` al llamar
  `resolveBrand`).
- `resolveBrand.ts` — `ResolveBrandInput` gana `baseDomain: string`. Nueva
  helper `brandFromSubdomain(hostname, baseDomain)`:
  - `hostname` no termina en `.<baseDomain>` (host ajeno) → `DEFAULT_BRAND_KEY`.
  - prefijo (lo anterior a `.<baseDomain>`) vacío (apex), con `.` (multi-label)
    o `'www'` → `DEFAULT_BRAND_KEY`.
  - exactamente un label extra (`elektra.<base>`, `banco_azteca.<base>`) → ese
    label tal cual (key abierta, sin filtrar contra catálogo).
  DEV sin cambios (`?brand=` > `VITE_DEFAULT_BRAND` > `DEFAULT_BRAND_KEY`;
  `baseDomain` se ignora). Sigue siendo función pura, nunca lanza, string no
  vacío.

`main.tsx`/`App.tsx` aún no cablean `resolveBrand` (deuda diferida a
welcome_screen); la constante `BASE_DOMAIN` queda lista y coherente. Arranque
intacto.

---

## Rev.2 (identidad de marca abierta, S3 manda) — migración GREEN

Fase GREEN de la migración a la arquitectura Rev.2 (re-diseño aprobado). Se
migró el código de producción de Rev.1 (catálogo cerrado de 2 marcas) al modelo
abierto (key = string, 1 default genérico de runtime, seeds fuera del runtime),
sin tocar ningún test. **40 tests de brand + 1 preexistente (App) → 41 verde.**

### Archivos migrados / creados (producción)

Bajo `frontend/src/brand/`:

- `schema.ts` — ELIMINADO `brandKeySchema = z.enum([...])`; ahora
  `export type BrandKey = string` (identidad abierta). El resto del schema
  intacto (campos, `.default()`/`.prefault()`, `rgbChannels`, `parseBrandConfig`).
  Defaults del schema alineados con la marca NEUTRA (`data/default.json`):
  `key='default'`, `name='Marca'`, `title='¡Te damos la bienvenida!'`,
  `primary='124 92 252'`, assets bajo `/brands/default/` (recomendación de
  neutralidad del design; los tests no dependen del literal exacto).
- `registry.ts` — ELIMINADOS `BUNDLED_BRANDS` y `BRAND_KEYS`. Ahora expone
  `DEFAULT_BRAND` (desde `data/default.json`, parseado) y
  `DEFAULT_BRAND_KEY = 'default'`. Único import de runtime: `data/default.json`
  (nada de `seeds/`).
- `data/default.json` — NUEVO. Marca genérica neutra (violeta `124 92 252`,
  textos sin nombre de cliente). Único bundle de runtime.
- `data/shopinbaz.json` / `data/elektra.json` — ELIMINADOS de `data/` (ya vivían
  como `seeds/` creados por el tester; el catálogo runtime desaparece).
- `resolveBrand.ts` — quitado `asBrandKey`/filtrado por catálogo. Prod: devuelve
  el subdominio TAL CUAL (`hostname.split('.')[0]`), con guard
  `|| DEFAULT_BRAND_KEY` si sale vacío. Dev: `?brand=` > `VITE_DEFAULT_BRAND` >
  `DEFAULT_BRAND_KEY`, sin descartar keys. Firma `ResolveBrandInput` sin cambios.
- `loadBrand.ts` — `loadBrand(key: string, deps?)`. Fallback ante CUALQUIER fallo
  (dev/sin s3, `!res.ok`/404, reject, JSON malformado/Zod, key inexistente) →
  `DEFAULT_BRAND` (ya no `BUNDLED_BRANDS[key]`). Quitado `bundledFor`.
- `ThemeProvider.tsx` — firma `brand: BrandKey` → `config: BrandConfig`. El
  Provider ya no resuelve ni carga: recibe la config por prop, la expone por
  `useBrand()` y aplica `applyBrandToDom(config)` en `useEffect`. Quitados el
  import de `BUNDLED_BRANDS` y el `useMemo`. `useBrand()` sin cambios.
- `applyBrandToDom.ts`, `constants.ts` — sin cambios.

Assets: creado `frontend/public/brands/default/{logo,illustration}.svg` (SVG
placeholder neutro). Los de `shopinbaz`/`elektra` se conservan (los seeds y el
test multi-marca referencian sus rutas). `main.tsx`/`App.tsx` NO usaban
`ThemeProvider` todavía → sin cambios de integración (la orquestación
`resolveBrand` + `loadBrand` la conectará welcome_screen/deploy).

`seeds/{shopinbaz,elektra}.json` los creó el tester como fixtures; ningún módulo
de runtime los importa (verificado: `registry.ts` importa solo `data/default.json`).

### Evidencia GREEN (Rev.2)

```
pnpm --filter @nach/frontend test
 Test Files  7 passed (7)
      Tests  41 passed (41)   # 40 de brand + 1 preexistente (App)

pnpm --filter @nach/frontend typecheck   # exit 0, limpio
pnpm --filter @nach/frontend lint        # exit 0
  1 warning (no error): react-refresh/only-export-components en
  ThemeProvider.tsx — co-export de useBrand() junto al componente (patrón
  idiomático de Context, requerido por el import del test). Regla en `warn`,
  no bloquea.
```

---

## Rev.1 (histórico — catálogo cerrado, superado por Rev.2)

Fase GREEN inicial: schema Zod con defaults por campo, registry con catálogo de
2 marcas (`BUNDLED_BRANDS`/`BRAND_KEYS`), `resolveBrand` con filtrado contra
catálogo, `loadBrand` con fallback `BUNDLED_BRANDS[key]`, `ThemeProvider` con
prop `brand`. Superado por el re-diseño Rev.2 (identidad de marca abierta).
