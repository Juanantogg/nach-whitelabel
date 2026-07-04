# Decisiones de diseño (ADR)

Registro de decisiones de arquitectura de **nach-whitelabel**, con su *porqué*.
Es el criterio de evaluación "README con explicación de decisiones" del enunciado
([`ExamenPractico_Front.md`](ExamenPractico_Front.md)). El `README.md` enlaza aquí
y da la versión resumida; este archivo guarda el razonamiento completo.

> Convención: cada decisión indica **contexto → decisión → por qué → alternativas
> descartadas**. Se añaden decisiones nuevas conforme se implementan features; no
> se reescriben las existentes (solo se marcan como *reemplazada por…* si cambian).

---

## 1. Monorepo con pnpm workspaces

- **Contexto:** front y back comparten el contrato de cifrado y la forma de la API.
- **Decisión:** un único repo (`frontend/` + `backend/`) con pnpm workspaces.
- **Por qué:** se clona y evalúa de una vez, con historia de commits unificada; el
  contrato de cifrado vive cerca de sus dos extremos.
- **Descartado:** dos repos separados (coordinar versiones del contrato sería ruido
  para una prueba).

## 2. White-label: qué exige el enunciado y cómo lo cumplimos

- **Contexto:** el enunciado exige cambiar dinámicamente **textos, colores y estilos
  visuales** por configuración (JSON/env/props), sin tocar la lógica de los
  componentes. Las maquetas muestran la misma pantalla en shopinbaz (morado) y
  elektra (rojo/naranja), con ilustraciones distintas.
- **Decisión:** los componentes consumen tokens de Tailwind que apuntan a **CSS
  variables `--brand-*`**; un `ThemeProvider` las inyecta en `:root` en runtime.
  Textos, estilos e ilustración salen de la config de marca, no del componente.
- **Por qué:** añadir una marca = añadir una config, nunca editar un componente —
  que es exactamente lo que evalúa el enunciado.
- **Descartado:** hex literales o textos hardcodeados en JSX (romperían el
  white-label); estilos por marca duplicados en CSS (la fuente de verdad es el JSON).

## 3. De dónde se carga la config de marca: S3 + fallback bundleado

- **Contexto:** hicimos falta decidir *dónde vive* el JSON de cada marca y cómo
  evitar un JSON corrupto. Se consideró un dashboard con backend que capturara la
  config y la persistiera.
- **Decisión:** **sin dashboard ni backend de config.** En producción el front hace
  `fetch` del JSON desde **S3**; en desarrollo y tests usa una o dos marcas
  **bundleadas en el repo** como fallback (sin depender de red).
- **Por qué:**
  - El enunciado pide config por JSON/env/props, no un CRUD de administración.
  - Un dashboard añade backend de escritura, formularios y persistencia — mucho
    scope para un problema (config por marca) que un JSON resuelve.
  - La red real contra "JSON corrupto" **no** es una UI: es un **schema Zod** que
    valida el JSON. Un bucket acepta encantado un JSON mal formado; el schema no.
  - S3 permite cambiar la config **sin re-desplegar el front**, y usa AWS, que es el
    stack del cliente.
- **Descartado:** dashboard + Mongo (fuera del enunciado, mete backend por la puerta
  de atrás); bucket como única fuente sin fallback (acoplaría dev y tests a la red).

## 4. Validación resiliente de la config con Zod

- **Contexto:** el JSON de S3 puede estar incompleto, o el fetch puede fallar
  (404, CORS, red caída). La app no debe romperse por config.
- **Decisión:** un `brandConfigSchema` de **Zod** valida el JSON. Los campos ausentes
  se rellenan **campo a campo con `.default()`** (un JSON parcial sigue dando una
  marca usable). Si el fetch falla del todo, se usa la **marca por defecto bundleada**.
- **Por qué:** el theming nunca deja la app en blanco; degradación elegante.
- **Descartado:** rechazar el JSON entero ante un campo faltante (menos resiliente).

## 5. Selección de la marca activa: por entorno

- **Contexto:** hay varias formas de decidir qué marca mostrar (subdominio, link
  directo `?brand=`, switcher en vivo). No chocan, pero cada una añade superficie.
- **Decisión:** reglas **distintas por entorno**, sin cadena de precedencia larga:
  - **Producción → solo el subdominio** (`elektra.dominio`), que decide qué JSON
    pedir en S3. Las URLs de cliente quedan limpias, sin query params.
  - **Desarrollo / tests → `?brand=elektra` (solo dev) > `VITE_DEFAULT_BRAND`**, con
    la primera marca bundleada como último fallback.
  - El subdominio **no** se lee en dev; `?brand=` **no** se lee en prod (se activa
    solo bajo `import.meta.env.DEV`).
- **Por qué:** el white-label real es "un subdominio (o deploy) por marca", así que
  el subdominio es la fuente natural en producción. En local no hay subdominios, y
  `?brand=` deja al evaluador cambiar de marca con `localhost:5173/?brand=elektra`
  sin editar la env ni recargar config. Cada entorno tiene una regla inequívoca.
- **Descartado:**
  - **`?brand=` en producción:** innecesario y ensucia las URLs de cliente; peor,
    permitiría forzar una marca por URL en el entorno real.
  - **Switcher en runtime:** UI extra que el enunciado no pide; el cambio de marca
    en vivo se demuestra en el deploy vía los subdominios.

## 6. Cifrado: requisito del enunciado vs decisión propia

- **Contexto:** el enunciado solo exige que el nombre viaje **encriptado**, se
  desencripte en el back, y que el número consecutivo vuelva **encriptado**.
- **Decisión:** implementarlo como **cifrado híbrido asimétrico** — la clave privada
  vive en el servidor (variable de entorno), el back sirve la pública, el front cifra
  con la pública vía Web Crypto API. Detalle en [`seguridad.md`](seguridad.md).
- **Por qué:** ningún secreto viaja en el bundle del front; es la forma correcta de
  cifrar cliente→servidor sin compartir un secreto simétrico.
- **Nota de honestidad:** el híbrido asimétrico es **decisión nuestra**, no una
  exigencia literal del enunciado. Se documenta como tal para no confundir requisito
  con elección de arquitectura.

## 7. Backend en capas y app testeable

- **Decisión:** `routes → controllers → services`, con `app.ts` (construye la app)
  separado de `server.ts` (conecta Mongo y abre puerto).
- **Por qué:** los endpoints se testean con Supertest sin abrir puerto ni depender de
  MongoDB; la lógica de negocio (contador consecutivo, cifrado) vive en services.

## 8. Metodología: TDD estricto

- **Decisión:** RED → GREEN → REFACTOR. Un agente *tester* escribe tests que fallan
  desde los criterios de aceptación; el *implementer* escribe el mínimo código para
  pasarlos, sin tocar los tests.
- **Por qué:** el enunciado pide pruebas unitarias y valora buenas prácticas; TDD las
  garantiza por construcción y deja evidencia del proceso.

## 9. Deploy en AWS (extra): subdominio por marca y reparto lógica/infra

- **Contexto:** el cliente usa AWS. Se dispone de un dominio propio, `garcia3apps.com`,
  que ya sirve la web principal en producción. El subdominio-por-marca comunica el
  white-label real de un vistazo (`elektra.garcia3apps.com`), pero requiere infra.
- **Decisión — reparto lógica/infra:** la **lógica** de selección por subdominio y de
  carga desde S3 vive en `brand_config`, testeada con hostname y S3 **mockeados**
  (cero infra). La **infra real** es la feature `deploy`, opcional.
- **Decisión — arquitectura de `deploy`:**
  - **Front:** S3 (estático) + CloudFront.
  - **Subdominios NOMBRADOS** (`elektra.`, `shopinbaz.`) en el DNS de `garcia3apps.com`,
    **nunca un wildcard `*.garcia3apps.com`** → no interfiere con el apex ni con otros
    usos del dominio. La web principal existente no se toca.
  - **Certificado ACM con SAN por subdominio** (no wildcard), en `us-east-1` (CloudFront).
  - **Backend:** Express en **AWS App Runner** (corre el Express tal cual, sin adaptador
    serverless). Base de datos en **MongoDB Atlas M0** (gratis).
  - **JSON de marca** en un bucket S3 de lectura pública con CORS.
- **Por qué:** el core de la prueba nunca depende de que AWS esté montado (fallback
  bundleado en `brand_config`), pero el deploy ya habla el stack del cliente y luce el
  multi-tenant por host con el dominio real.
- **Costes:** front (S3/CloudFront), ACM y S3 de config → free tier / gratis. Route 53
  hosted zone → ~$0.50/mes. Atlas M0 → gratis. **App Runner NO es free tier
  (~$5-25/mes)** → **apagar/eliminar tras la evaluación** (recordatorio en el README).
- **Riesgo vigilado:** HTTPS + CORS front↔back impecables; el evaluador abre DevTools,
  y un error de CORS o mixed-content resta más de lo que suma el subdominio.
- **Plan B:** si el tiempo aprieta, URL por defecto de CloudFront + `?brand=` (sin tocar
  DNS). `brand_config` funciona igual por su fallback.

## 10. Alcance: lo que NO se hace y por qué

- **Sin dashboard de administración de marcas** — ver decisión 3.
- **Sin sistema de usuarios/cuentas.** El nombre + número consecutivo es el flujo de
  demostración del cifrado, no un registro de usuarios. No hay login ni sesión.
- **Listado de registros generados** (nombre + nº consecutivo desde Mongo) es un
  **extra opcional** posterior al core; se llama "registros", no "usuarios", para no
  inventar un dominio que el enunciado no plantea.
