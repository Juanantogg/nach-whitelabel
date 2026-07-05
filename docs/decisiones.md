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

## 11. Gestión de secretos en producción: clusters separados + Parameter Store

- **Contexto:** en desarrollo el backend lee sus secretos de un `backend/.env`
  local (gitignoreado): `MONGODB_URI` (un cluster Atlas M0 de dev) y
  `CRYPTO_PRIVATE_KEY` (el PEM del cifrado híbrido). Para el deploy hay que decidir
  **dónde viven esos mismos secretos en producción**, sin que toquen el repo ni el
  bundle. AWS ofrece dos servicios: **Secrets Manager** (de pago, ~$0.40/secreto/mes
  + coste por API call, con rotación automática) y **Systems Manager Parameter
  Store** (SecureString **gratis** en su tier estándar, cifrado con KMS, integrado
  con App Runner).
- **Decisión:**
  - **Clusters de base de datos SEPARADOS dev vs prod.** El de dev es de uso local
    (Network Access laxo, credencial de dev); el de prod tiene **usuario y
    contraseña propios** y Network Access **restringido** (idealmente a los rangos
    de App Runner, nunca `0.0.0.0/0`). Una credencial de dev filtrada no da acceso
    a los datos de prod.
  - **Secretos de prod en AWS Parameter Store como SecureString** (no Secrets
    Manager). Van ahí **tanto `MONGODB_URI`** (la del cluster de prod, completa)
    **como `CRYPTO_PRIVATE_KEY`** (el PEM) — la clave privada es tan sensible como
    la base de datos. App Runner los inyecta como variables de entorno en runtime;
    ninguno se escribe en el repo ni viaja en el bundle del front.
- **Por qué:**
  - **Parameter Store SecureString es gratis** y suficiente para esta prueba: cifra
    en reposo con KMS y se integra nativamente con App Runner. La rotación
    automática de Secrets Manager es su única ventaja real aquí, y no justifica el
    coste recurrente en un montaje que además se apaga tras la evaluación (ADR 9).
  - Separar clusters es defensa en profundidad: el `.env` de dev es el eslabón más
    expuesto (se comparte, se pega en chats, tiene red abierta), así que **nunca**
    debe compartir credencial ni datos con producción.
  - Coherente con el principio ya establecido de que la clave privada solo vive en
    el servidor por variable de entorno (ADR 6, `seguridad.md`): en prod esa
    variable la sirve Parameter Store, no un archivo.
- **Descartado:**
  - **AWS Secrets Manager:** de pago; su rotación automática no aporta a una prueba
    técnica de vida corta. Coste sin beneficio proporcional.
  - **Reutilizar el cluster de dev en producción:** acoplaría la seguridad de prod
    a una credencial de dev laxa y potencialmente expuesta.
  - **Secretos como env vars en texto plano en la consola de App Runner** (sin
    Parameter Store): visibles a cualquiera con acceso de lectura a la config del
    servicio; SecureString las mantiene cifradas.
- **Higiene operativa:** si una credencial de dev se expone (p.ej. al compartir la
  connection string), se **rota** en Atlas (Database Access → Edit Password) y se
  actualiza el `.env` local; el cluster de prod no se ve afectado por ser
  independiente.

## 12. Identidad de marca abierta (S3 manda) y carga por entorno

- **Contexto (2026-07-03):** el diseño inicial de `brand_config` fijaba
  `brandKeySchema = z.enum(['shopinbaz','elektra'])` y dos marcas bundleadas como
  catálogo cerrado. Eso contradice el modelo real "añadir una marca = subir un JSON
  a S3, sin tocar código": el enum obligaba a editar código por cada marca.
- **Decisión:** la identidad de marca es **abierta**. `BrandKey = string` (sin enum).
  En producción manda el bucket S3: el subdominio se usa tal cual para pedir
  `<key>.json`; la red de seguridad es el `brandConfigSchema` (Zod con `.default()`
  por campo), no una lista hardcodeada. El único bundle de runtime es un
  **`default.json` genérico** como fallback offline. `shopinbaz.json`/`elektra.json`
  pasan a ser **seeds** en el repo (para subir a S3 y como fixtures del test
  multi-marca), NO catálogo importado en runtime.
- **Consecuencia:** el `ThemeProvider` recibe una `BrandConfig` **ya resuelta** por
  prop (síncrono, testeable); `resolveBrand` + `loadBrand` corren fuera (main.tsx).
- **Por qué:** cumple el principio de arquitectura escalable del enunciado (marca
  nueva = un JSON, cero código) y elimina la doble fuente de verdad (enum vs bucket).
  Refina la ADR 5 (selección por entorno) con la key abierta.

### 12.a — `loadBrand`: cadena de fallback por entorno (2026-07-04)

- **Contexto:** durante `welcome_screen` se detectó que en desarrollo `loadBrand`
  devolvía SIEMPRE el `default.json` (guarda `if (isDev) return DEFAULT_BRAND`), así
  que `?brand=elektra` resolvía la key pero nunca se veía elektra/shopinbaz en el
  navegador. Las seeds solo servían como fixtures de test.
- **Decisión:** `loadBrand` unifica una cadena de fallback por entorno:
  - **Dev:** intenta `fetch` de S3 por key → si falla (red/CORS/404/Zod), busca una
    **seed bundleada** por key (`seeds/<key>.json`) → si tampoco existe, `default`.
  - **Prod:** intenta S3 por key → si falla, `default` (las seeds NO entran).
  Las seeds se importan **solo en dev** (tras `import.meta.env.DEV`), de modo que el
  tree-shaking las excluye del bundle de producción.
- **Por qué:** permite previsualizar cada marca en dev (`?brand=elektra`) sin
  desplegar, mantiene "dev intenta S3 primero" (más fiel a prod) y no contamina el
  bundle de producción con las seeds.

## 13. Assets de marca en el bucket, NO en el build

- **Contexto (2026-07-04):** las seeds `elektra.json`/`shopinbaz.json` apuntaban a
  rutas locales `/brands/<key>/logo.svg` inexistentes en `public/`. Se planteó
  enlazar al CDN real de Elektra (`dh3yyy4wyj8lf.cloudfront.net`).
- **Decisión:** siendo white-label de verdad, los assets de una marca viven en el
  **mismo bucket S3/CloudFront que su `<key>.json`**, NO bundleados. Convención:
  `https://brands.garcia3apps.com/<key>/<asset>`. Las seeds del repo solo apuntan a
  esas URLs absolutas; subir los SVG al bucket es parte de `deploy`.
- **Excepción — `default.json`:** es el fallback OFFLINE, así que es la ÚNICA marca
  cuyos assets SÍ van bundleados en `public/brands/default/`.
- **Consecuencia:** `assets.logo`/`illustration` en el schema son `z.string()` sin
  validación de formato (aceptan URL absoluta o ruta local). En `deploy`/
  `backend_hardening` la CSP (`img-src`) debe allowlistar `brands.garcia3apps.com`.
- **Por qué:** coherente con "marca nueva = un JSON (+ sus assets) en S3, cero código
  y cero rebuild". Evita meter binarios de marca en el bundle (misma doble fuente de
  verdad que ya se eliminó para el JSON) y no depende de CDNs ajenos.
- **Descartado:** enlazar al CDN de Elektra (infra de terceros: hotlinking 403, CSP,
  cambios de ruta fuera de control, propiedad del asset); bundlear los SVG de marca
  en `public/` (los mete en el build, rompe el principio white-label).

## 14. UX del dictado por voz: degradación e indicación de captura

- **Contexto (2026-07-04):** al probar la pantalla de bienvenida en runtime con
  navegadores reales aparecieron tres comportamientos de la `SpeechRecognition` API
  que la primera integración (feature `voice_ux`) no cubría: Firefox no implementa
  la API; Brave la implementa pero **bloquea el servicio de reconocimiento de Google**
  y devuelve `error='network'`; y Chrome a veces cierra la sesión (`onend`) **sin
  emitir resultado ni error**, dejando al usuario sin saber que no se captó nada.
  Además, con `interimResults:false` el dictado exigía "varios intentos" y no daba
  feedback en vivo. (El micrófono que no captaba resultó ser hardware —tapa del
  portátil abajo—, no la app: descartado como causa.)
- **Decisión (feature `voice_reliability`):**
  1. **`interimResults:true`** en `useVoiceInput` (se mantiene `continuous:false`):
     transcripción parcial en vivo, más tolerante a pausas. El clamp de 15 sigue en
     `NameField`, que recorta cada emisión; la firma de `onResult` (recibe `string`)
     no cambia.
  2. **Ocultar el micrófono (no deshabilitarlo)** cuando no hay forma de dictar:
     (a) navegador sin soporte (`!isSupported`, p.ej. Firefox) y (b) servicio
     bloqueado (`error='network'`). Para (b) el hook expone un **latch de sesión
     `voiceUnavailable`** que se activa al primer `network` y NO se resetea en
     `start()` (un navegador que bloquea el servicio lo bloquea siempre; no se
     persiste entre recargas). `NameField` rinde el mic solo si
     `isSupported && !voiceUnavailable`. **Esto revisa la decisión previa de
     `voice_ux`** (que deshabilitaba el botón con `voice.unsupported`); ese texto
     permanece en el schema pero deja de renderizarse.
  3. **Aviso de sesión sin captura:** si el reconocimiento termina sin haber emitido
     ninguna transcripción, el hook sintetiza `status='error' + errorCode='no-speech'`,
     que `NameField` ya mapea al texto de marca `voice.noSpeech` en la región
     `aria-live`. Esto incluye el caso de **`stop()` manual sin haber hablado**
     (confirmado con el usuario): se prefiere la simplicidad y un mensaje veraz
     ("no se capturó nada") a una excepción que distinga parada manual de fin natural.
- **Por qué:** el input manual es siempre el camino garantizado, así que ocultar el
  mic nunca rompe el formulario; mostrar un botón inerte confunde más que ayuda. Un
  latch dedicado es aditivo (no muta `isSupported`, que es feature-detection pura) y
  trivial de mockear. Reusar `no-speech` para "cerró sin captar" da al usuario el
  mismo aviso conocido sin ampliar el schema ni el contrato del hook. Cero texto
  nuevo de marca, cero literales/hex en componentes.
- **Descartado:** deshabilitar el botón con `voice.unsupported` (deja un control
  muerto, no comunica la razón mejor que su ausencia); volver `isSupported=false`
  tras `network` (mezcla "sin API" con "servicio bloqueado", ensucia su semántica);
  derivar la ocultación de `errorCode` (es efímero, se limpia al reintentar, no da el
  latch de sesión); un `VoiceStatus`/campo nuevo para "cerró sin captura" (amplía el
  contrato para el MISMO mensaje visible); `continuous:true` (mantiene el mic abierto,
  exige gestionar reinicios, no aporta para un nombre corto); una excepción para que
  `stop()` manual no avise (complejidad sin valor claro).

## 15. Endurecimiento del backend: CORS por allowlist, error handler y logging (feature `backend_hardening`)

- **Contexto (2026-07-04):** al cablear los endpoints reales de cifrado/contador,
  el front y el back se sirven en dominios distintos en producción (subdominio por
  marca en CloudFront ↔ Express en App Runner), así que la conexión cross-origin es
  real. `app.ts` no tenía `cors`/`helmet`, ni había manejador de errores centralizado,
  graceful shutdown ni logging estructurado (se usaba `console.*`). Detalle del "por
  qué" de cada regla en `docs/seguridad.md` §3-4.
- **Decisión:**
  1. **CORS por allowlist desde entorno, nunca `origin:'*'`.** Nueva var
     `CORS_ORIGINS` (lista separada por comas) validada con Zod en `env.ts`, con
     default seguro en dev (`http://localhost:5173`). `methods: ['GET','POST']`,
     `credentials:false` (no hay cookies). Coherente con white-label: cada marca/
     entorno se despliega en un dominio distinto, así que los orígenes permitidos son
     **configurables, no literales**.
  2. **Un origen no permitido se rechaza devolviendo la petición SIN cabeceras CORS
     (`callback(null, false)`), no lanzando un error 500.** El navegador bloquea la
     respuesta por ausencia de `Access-Control-Allow-Origin`; el servidor no trata un
     origen desconocido como fallo interno. Allowlist vacía = nadie cross-origin
     (falla cerrado); peticiones sin cabecera `Origin` (curl, same-origin) se permiten.
  3. **Orden de middlewares en `createApp()` (Express 5):** `helmet` → `cors` →
     `express.json()` → `pino-http` → routers → `errorHandler`. cors/helmet ANTES de
     las rutas. `createApp()` no cambia de firma (lee `env.ts` directo), así los tests
     de Supertest siguen sin argumentos.
  4. **Error handler centralizado** (middleware de 4 args): responde JSON consistente
     `{ error, message }`; el `stack` solo se incluye si `!isProd`; los 5xx en prod
     devuelven un `message` genérico (no filtra internals). Loguea por pino, nunca
     `console.*`. No se añade `asyncHandler`: Express 5 ya reenvía los rechazos async.
  5. **Graceful shutdown en `server.ts`** (no en `app.ts`): SIGTERM/SIGINT →
     `httpServer.close()` (deja de aceptar conexiones) → `disconnectDb()` → `exit(0)`,
     con timeout de seguridad que fuerza `exit(1)` si el cierre se cuelga.
  6. **Logging estructurado con pino + pino-http** en lugar de `console.*`; se migran
     los `console.info/error` de arranque de `server.ts`/`db.ts`.
  7. **`express-rate-limit` en `POST /names`** (incluido, confirmado con el usuario):
     defensa en profundidad contra abuso/fuerza bruta del endpoint de escritura.
  8. **Menores:** `.nvmrc`/`.node-version` acorde a `engines.node`.
- **Corrección (2026-07-04, verificada en runtime):** el "menor" de quitar
  `@types/express` **se descarta**. La premisa era falsa: `express@5.2.1` NO trae
  tipos propios (sin campo `types`/`typings` en su `package.json`, sin `index.d.ts`),
  así que quitar `@types/express` rompe `tsc` (TS7016) en todos los `import ... from
  'express'`. `@types/express` **se mantiene** como devDependency. `@types/cors` sí se
  añade (cors tampoco trae tipos). El resto de la acceptance (cors/helmet/errorHandler/
  shutdown/pino/rate-limit/.nvmrc) queda intacto.
- **Por qué:** el reparto app.ts (testeable con Supertest) vs server.ts (arranque/
  señales) mantiene los endpoints y middlewares verificables sin abrir puerto ni
  Mongo, mientras que shutdown y wiring de pino se observan por smoke/runtime. La
  allowlist configurable es la pieza que habilita el cross-origin real de `deploy`
  sin hardcodear dominios. Rechazar CORS sin cabeceras (en vez de 500) es el
  comportamiento estándar de la librería y no ensucia los logs con errores por cada
  origen desconocido.
- **Descartado:** `origin:'*'` (abre el back a cualquier web, incompatible con datos
  del usuario); lanzar error en el callback de cors para origen no permitido (genera
  5xx espurios y ruido de logs por tráfico legítimo de otros orígenes); `asyncHandler`
  wrapper (innecesario en Express 5); mantener `console.*` (no estructurado, choca con
  la acceptance de logging).
