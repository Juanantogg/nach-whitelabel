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

## 16. Endurecimiento de pnpm contra ataques a la cadena de suministro de npm

- **Contexto (2026-07-04):** 2025-2026 concentró una oleada de ataques de
  supply-chain a npm (maintainers comprometidos por phishing publicando versiones
  maliciosas de paquetes legítimos con millones de descargas; worms auto-propagados
  tipo *Shai-Hulud*; payloads que se ejecutan en `postinstall`). El vector típico:
  una versión comprometida se publica y se instala en las **primeras horas**, antes
  de que npm la despublique; el daño corre en un script de instalación. El repo no
  tenía ninguna defensa de instalación configurada (sin `.npmrc`, sin settings de
  seguridad de pnpm), pese a usar pnpm 11 que ya trae mitigaciones.
- **Decisión:** fijar **explícita y versionadamente** en `pnpm-workspace.yaml` las
  defensas de supply-chain de pnpm 11 (aunque ya sean default-on, para que no
  dependan de defaults ni se pierdan en un bump), y **subir el `packageManager` a
  `pnpm@11.10.0`** (última estable):
  1. **`minimumReleaseAge: 1440`** — cuarentena de 24 h: no se resuelven versiones
     publicadas hace menos de un día. Saca al proyecto de la ventana crítica en la
     que vive un paquete comprometido antes de ser detectado/despublicado. Es la
     mitigación que más mueve la aguja.
  2. **`allowBuilds: {}`** (map vacío) + `strictDepBuilds` (default true) — ningún
     paquete puede ejecutar scripts de build/`postinstall`; una dep nueva con
     script hace **fallar** el install en vez de ejecutarlo en silencio. Verificado
     que hoy **ninguna** dependencia del repo tiene scripts de instalación, así que
     el bloqueo total no rompe nada.
  3. **`blockExoticSubdeps: true`** — bloquea subdependencias con specs exóticos
     (git/url/tarball) en el árbol transitivo, vector de inyección.
- **Por qué `pnpm@11.10.0` y no quedarse en 11.0.0:** las 4 defensas base ya están
  en 11.0.0, pero **11.0.4** hace que fijar `minimumReleaseAge` active el modo
  *estricto* (`minimumReleaseAgeStrict`: falla en vez de auto-excluir versiones
  inmaduras en silencio) y **11.1.3** añade la revalidación del lockfile contra la
  cuarentena antes de bajar tarballs (cierra el hueco de lockfiles resueltos en otra
  máquina/CI comprometida). 11.10.0 es la última estable e incluye ambas + fixes.
- **Compatibilidad con el evaluador (no usa pnpm):** el campo `packageManager` +
  **Corepack** (incluido en Node ≥ 16) resuelven la versión exacta de pnpm sin
  instalación manual (`corepack enable && pnpm install`); fallback `npm i -g pnpm`.
  El endurecimiento es config de **instalación local/CI**, NO afecta al runtime ni
  a la app desplegada: si el evaluador solo abre la URL de producción, nunca toca
  pnpm. Instalar desde el **lockfile commiteado** (`--frozen-lockfile`, verificado)
  no dispara la cuarentena — esta solo aplica al **resolver** versiones nuevas.
  Documentado en el README (sección Requisitos).
- **Descartado:** `.npmrc` con settings de pnpm (en pnpm 11 `.npmrc` es solo
  registry/auth; las settings pnpm migraron a `pnpm-workspace.yaml` — ponerlas en
  `.npmrc` daría falsa protección); `onlyBuiltDependencies`/`neverBuiltDependencies`
  (eliminadas en pnpm 11, reemplazadas por `allowBuilds`; un config viejo con esas
  claves sería un no-op silencioso); `allowBuilds: []` como array (sintaxis vieja;
  en 11 es map); `dangerouslyAllowAllBuilds` (ejecutaría todos los scripts, lo
  contrario de lo buscado); `frozen-lockfile=true` global (rompería el flujo de dev
  al añadir deps; ya es auto-true en CI, y en local se usa vía flag).

### 16.a — Defensa en profundidad: auditoría, CI endurecido y Dependabot (2026-07-04)

- **Contexto:** el endurecimiento de pnpm (arriba) cierra la puerta de la
  **instalación**, pero los ataques masivos a npm entran por más sitios: (a) usar
  una dependencia con un CVE ya publicado; (b) una **GitHub Action comprometida**
  que roba el `GITHUB_TOKEN`/secretos del pipeline (vector real del ataque
  *tj-actions/changed-files*, 2025); (c) actualizaciones ciegas. El repo ya tenía
  gitleaks (pre-commit + CI) contra filtración de secretos y `--frozen-lockfile`
  en CI, pero nada contra (a), (b) ni (c).
- **Decisión — cuatro capas añadidas:**
  1. **`pnpm audit --audit-level=moderate` en CI** (bloqueante): falla el build
     ante advisories conocidos de nivel moderate o superior. Defensa directa
     contra depender de una versión con vulnerabilidad publicada.
  2. **`pnpm audit` en el hook `pre-push`** (avisa, NO bloquea): red local
     temprana. No bloquea porque un CVE transitivo sin patch no debe impedir el
     push; el CI es la red dura. Mismo patrón que gitleaks en `pre-commit`.
  3. **CI endurecido:** `permissions: contents: read` a nivel workflow (el
     `GITHUB_TOKEN` deja de heredar permisos de escritura amplios), y todas las
     **GitHub Actions pinneadas por SHA de commit** en vez de por tag (`@v4`). Una
     tag puede re-apuntarse a código malicioso si comprometen al maintainer; un
     SHA es inmutable. El comentario junto a cada SHA anota la versión legible.
  4. **Dependabot** (`.github/dependabot.yml`) para dos ecosistemas — `npm` y
     `github-actions` — con PRs semanales agrupados (minor+patch juntos, majors
     sueltos). Mantiene deps y los propios SHA de las Actions al día sin
     actualizaciones ciegas; se combina con `minimumReleaseAge` (la cuarentena
     sigue aplicando a lo que Dependabot proponga).
- **Por qué:** cubre las cuatro puertas de entrada (instalación, deps vulnerables,
  pipeline, mantenimiento) con esfuerzo bajo y sin tocar código de producción. Al
  momento de montarlo `pnpm audit` no reporta ninguna vulnerabilidad, así que las
  capas bloqueantes arrancan en verde.
- **Descartado (para esta prueba):** OpenSSF Scorecard, firma de commits
  (GPG/sigstore), SLSA provenance, registry proxy privado (Verdaccio) — defensas
  de organización grande que añaden ruido sin sumar en el criterio de evaluación.
  `pnpm audit` a nivel `low` (demasiado ruidoso: rompería el build por avisos
  informativos sin fix). Bloquear el push con el audit local (fricción sin valor:
  el CI ya es bloqueante).

## 17. Infra de deploy: DNS en Namecheap, entornos dev/prod por rama, CI con Actions

- **Contexto (2026-07-05):** al arrancar la feature `deploy` se verificó el terreno
  real de DNS, que difiere de lo que asumió el ADR 9. `garcia3apps.com` usa el
  **BasicDNS de Namecheap** (nameservers `dns1/dns2.registrar-servers.com`), y su
  **apex ya sirve una web en producción en Firebase Hosting** (`199.36.158.100`). El
  ADR 9 daba por hecho una *hosted zone en Route 53*; migrar el DNS a Route 53
  obligaría a replicar todos los registros del apex (o la web principal caería) y
  añade coste, sin beneficio para esta prueba. Además el usuario quiere **dos
  entornos por rama** (`dev` y `prod`) y, si hay tiempo, **deploy automático con
  GitHub Actions**. El repo hasta ahora no usaba ramas.
- **Decisión — DNS (revisa el ADR 9):**
  - El DNS **se queda en Namecheap BasicDNS**; NO se delega a Route 53. Solo se
    **añaden registros de subdominio** (CNAME) apuntando a CloudFront (front) y App
    Runner (back). El apex y la web de Firebase **no se tocan**.
  - Subdominios **nombrados** (nunca wildcard), coherente con el ADR 9:
    - `dev.garcia3apps.com` → front del entorno **dev**.
    - `elektra.garcia3apps.com`, `shopinbaz.garcia3apps.com` → front **prod** (marca por host).
    - `api-dev.garcia3apps.com` → backend dev; `api.garcia3apps.com` → backend prod.
    - `brands.garcia3apps.com` → bucket S3 de config+assets de marca (ADR 3, 13).
  - **Certificado ACM con DNS validation por CNAME en Namecheap**, en `us-east-1`
    (requisito de CloudFront). SAN por subdominio, sin wildcard (ADR 9).
- **Decisión — entornos por rama:**
  - Rama **`dev`** → despliega el entorno **dev** (`dev.` + `api-dev.`).
  - Rama **`main`** → despliega **prod** (`elektra.`/`shopinbaz.` + `api.`).
  - Recursos **separados por entorno**: buckets, distribuciones CloudFront, servicios
    App Runner, clusters Atlas (ya exigido por el ADR 11) y parámetros de Parameter
    Store, con sufijo `-dev`/`-prod`.
- **Decisión — orden de ejecución (incremental):** se monta **primero el entorno dev
  completo a mano** y se valida de punta a punta (front en CloudFront + HTTPS + CORS
  contra el back en App Runner). Solo entonces se **clona a prod** y se **automatiza
  con GitHub Actions** (push/PR a `dev`→deploy dev, a `main`→deploy prod). La
  automatización es el último tramo, no el primero: cada paso deja algo observable.
- **Por qué:**
  - Namecheap-solo elimina el riesgo sobre el apex en producción y el coste de la
    hosted zone, y cumple igual el objetivo del ADR 9 (subdominio por marca con el
    dominio real). El único precio es que los registros DNS se tocan a mano en el
    panel de Namecheap (no hay API de DNS cómoda), aceptable para pocos subdominios.
  - dev/prod por rama es la práctica estándar y demuestra pipeline real; separar
    recursos por entorno evita que un deploy de dev pise prod.
  - Construir dev primero valida toda la cadena (ACM/CORS/mixed-content, el riesgo
    vigilado del ADR 9) con un solo entorno antes de duplicar esfuerzo.
- **Descartado:** delegar el DNS a Route 53 (riesgo sobre el apex de Firebase +
  coste, sin beneficio); wildcard `*.garcia3apps.com` (ya descartado en ADR 9:
  interfiere con el apex y otros usos); montar dev y prod a la vez (más superficie de
  error antes de validar un entorno); empezar por la automatización de CI (frágil de
  depurar sin un entorno ya funcionando a mano).

## 18. `?brand=` en el deploy dev vía `VITE_APP_ENV` (staging ≠ prod)

- **Contexto (2026-07-05):** al montar el entorno `dev` (`dev.garcia3apps.com`, feature
  `deploy`/ADR 17) surge que ese entorno es un **build de producción** (`import.meta.env.DEV
  === false`), así que `resolveBrand` (ADR 5/12) resuelve la marca **solo por subdominio**:
  `dev.garcia3apps.com` → key `dev` → inexistente → `default`, y `?brand=elektra` se
  **ignora**. En local sí se puede previsualizar marcas con `?brand=`, pero en el deploy
  dev no, que es justo donde el evaluador querría alternar marcas sin subdominios reales.
  El ADR 5 descartó `?brand=` **en producción** a propósito (no forzar marca por URL en el
  entorno real), pero NO contempló un entorno intermedio de staging.
- **Decisión:** introducir una variable de build **`VITE_APP_ENV`** con valores
  `dev` | `prod` (default `prod` si ausente), inyectada por el pipeline según la rama
  (rama `dev` → `dev`, `main` → `prod`). `resolveBrand` acepta `?brand=` cuando
  **`isDev === true` O `appEnv === 'dev'`**; en prod (`appEnv==='prod'`) sigue
  **solo-subdominio**, exactamente como hoy. Se añade `appEnv` a `ResolveBrandInput`
  (inyectado, la función sigue pura) y `main.tsx` lo lee de `import.meta.env.VITE_APP_ENV`.
  Los tres entornos quedan:
  - **local** (`isDev`): `?brand=` > `VITE_DEFAULT_BRAND` > default.
  - **deploy dev** (`appEnv==='dev'`): `?brand=` > `VITE_DEFAULT_BRAND` > default.
  - **prod** (`appEnv==='prod'`): subdominio; `?brand=` ignorado.
- **Por qué:** dev es staging, no producción — forzar la marca por URL ahí es deseable
  (previsualizar sin subdominios reales), mientras que prod conserva la garantía del ADR 5
  (URLs limpias, sin forzar marca por query). Un flag de build mantiene un solo
  código-fuente y decide el comportamiento por entorno; la función sigue pura y testeable
  (el flag entra inyectado, como `isDev`). No revisa el ADR 5, lo **extiende** con el caso
  que no cubría.
- **Descartado:**
  - **`?brand=` en todos los deploys (precedencia sobre subdominio):** contradice el ADR 5
    (en `elektra.garcia3apps.com` alguien forzaría `?brand=shopinbaz`).
  - **Subdominios de marca reales en dev (`elektra-dev.`, `shopinbaz-dev.`):** más fiel a
    prod pero infla CNAMEs, SANs del certificado y distribuciones/config de CloudFront por
    cada marca, sin aportar sobre `?brand=` para el objetivo (previsualizar marcas en dev).
  - **Derivar el entorno del hostname en runtime** (`if hostname startsWith 'dev.'`):
    acopla la lógica de marca al esquema DNS y no cubre el caso local; un flag de build es
    explícito y desacoplado.

## 19. `loadBrand` sin header `Accept` para evitar el preflight CORS contra S3/CloudFront

- **Contexto (2026-07-05):** con el deploy dev funcionando y el bucket de marcas ya
  servido por CloudFront (`brands.garcia3apps.com`, ADR 13/17), el front en
  `dev.garcia3apps.com` fallaba al cargar `elektra.json` con **CORS: "No
  'Access-Control-Allow-Origin' header is present"**. La causa NO era la config CORS de
  CloudFront (que sí devuelve `access-control-allow-origin: *` en el GET, variando por
  `Origin`), sino que `fetchFromS3` en `loadBrand.ts` mandaba
  `headers: { Accept: 'application/json' }`. Un `Accept` con valor no-estándar convierte
  el fetch cross-origin en una petición **no-simple**, disparando un **preflight
  `OPTIONS`**. El origen es un bucket S3 privado con OAC que **no maneja `OPTIONS`**, así
  que el preflight devolvía **403 `Error from cloudfront`** y el navegador abortaba antes
  del GET. Verificado por curl: `OPTIONS` → 403; `GET` simple con `Origin` → 200 +
  `access-control-allow-origin: *`.
- **Decisión:** **eliminar el header `Accept: 'application/json'`** del fetch de
  `fetchFromS3`. Sin headers no-estándar, la petición es una **CORS "simple"** (GET sin
  headers que fuercen preflight) → no hay `OPTIONS`, solo el GET, que ya trae CORS. El
  header no aportaba nada: S3 ignora `Accept` y sirve el objeto tal cual; el código ya
  hace `res.json()`.
- **Por qué:** arregla el problema con un cambio mínimo en el front, sin añadir
  complejidad de infra (no hay que hacer que CloudFront/S3 respondan `OPTIONS`). Mantener
  el fetch como petición simple es además lo correcto para servir assets estáticos
  públicos desde un CDN.
- **Descartado:**
  - **Manejar el preflight `OPTIONS` en CloudFront** (CloudFront Function o CORS config de
    S3 que responda OPTIONS): más piezas de infra para habilitar un preflight que no hace
    falta si la petición es simple. Complejidad sin beneficio.
  - **Poner CORS config en el bucket S3:** irrelevante con OAC — el navegador habla con
    CloudFront, no con S3 directo; el CORS lo pone la ResponseHeadersPolicy de CloudFront.
  - **Dejar el `Accept` y añadir `OPTIONS` a AllowedMethods de la distribución:** el
    OPTIONS seguiría yendo al origen S3 (403); no lo resuelve.

## 20. Prod multi-marca: front compartido, pero backend y datos AISLADOS por empresa

- **Contexto (2026-07-05):** al planificar el entorno de producción surge la pregunta de
  cuánta infra comparten Elektra y Shopinbaz. En el mundo real ambas son marcas de **Grupo
  Salinas pero EMPRESAS DISTINTAS**: sus datos de clientes (nombres + números consecutivos)
  no pueden mezclarse (privacidad, cumplimiento, y un contador consecutivo es por-empresa,
  no global). El white-label ya permite que el **front** sea común (mismo bundle, la marca
  se elige por subdominio, ADR 5), pero el **backend procesa datos** y ahí el aislamiento
  importa. Se consideraron dos modelos: (a) un backend compartido multi-tenant que enruta a
  la BD por host, (b) un backend por empresa con su propia BD.
- **Decisión — la frontera de aislamiento va entre "sin datos" y "con datos":**
  - **Compartido (sin datos de cliente):**
    - **Front:** UN bucket S3 + UNA distribución CloudFront con DOS aliases
      (`elektra.garcia3apps.com`, `shopinbaz.garcia3apps.com`) sirviendo el MISMO bundle
      (`VITE_APP_ENV=prod`); `resolveBrand` lee el subdominio y auto-tematiza (ADR 5/18).
      Añadir una marca = un alias + un CNAME + su JSON en el bucket de marcas, cero infra.
    - **Bucket de marcas** `brands.garcia3apps.com` (config/assets públicos): común, ya lo es.
    - **Certificado ACM:** el mismo (ya cubre todas las SANs).
  - **AISLADO por empresa (toca datos):**
    - **Backend:** UN App Runner POR MARCA (`nach-elektra-prod`, `nach-shopinbaz-prod`),
      mismo código, distinta config/secretos. `elektra.` pega a su backend, `shopinbaz.` al
      suyo (vía su propio `api.` o subdominio de API por marca).
    - **Base de datos:** UN cluster Atlas POR EMPRESA. Los registros de Elektra nunca tocan
      la BD de Shopinbaz. Contadores consecutivos independientes.
    - **Secretos:** namespaces separados en Parameter Store (`/nach/elektra/*`,
      `/nach/shopinbaz/*`), cada backend con su instance role al suyo.
- **Por qué:** el aislamiento por **compute** (no solo por BD) hace imposible por
  construcción que un bug de enrutado cruce datos entre dos empresas distintas — el peor
  incidente posible aquí. El código es idéntico (cero duplicación de lógica); lo único que
  cambia por marca es env + secretos + a qué Atlas apunta, exactamente como el white-label
  ya trata el front. El front compartido, en cambio, no toca datos y es justo el patrón que
  el enunciado premia (una marca nueva = configuración, no código).
- **Consecuencia sobre "prod = ¿hacer dev dos veces?":** NO para el front (un CloudFront con
  dos aliases, una pasada). SÍ se duplica el par backend+BD, pero es la duplicación
  *correcta* y barata en esfuerzo (mismo `apprunner.yaml`, distinto servicio/secretos). Los
  GitHub Actions parametrizan esa repetición (marca → env) para no montarla a mano dos veces.
- **Descartado:**
  - **Backend compartido multi-tenant** (enruta BD por host en un solo App Runner): menos
    infra, pero el compute es multi-empresa y un fallo de enrutado cruzaría datos de clientes
    entre Elektra y Shopinbaz; exige lógica multi-DB en el backend (más superficie de bug)
    para AHORRAR un servicio que en App Runner es barato. No compensa frente al aislamiento.
  - **BD compartida con discriminador por marca** (una colección con campo `brand`): descarta
    de plano — un solo error de filtro `WHERE brand=` expone datos entre empresas; contadores
    y aislamiento de cumplimiento imposibles de garantizar.
  - **Front separado por marca** (dos buckets/distribuciones): rompe el white-label (el
    sentido es que el MISMO front sirva ambas por subdominio); duplica sin aislar nada útil.

### 20.a — El front deriva el backend del host en runtime (no build-time), plantilla `api-<key>`

- **Contexto (2026-07-05):** el ADR 20 comparte el front entre marcas. Observación válida del
  usuario: un front compartido es una **superficie común** — un error lógico o un
  `VITE_API_URL` mal horneado podría hacer que un cliente de Elektra hable con el backend de
  Shopinbaz (cruce de datos entre empresas). Hoy el front hornea `VITE_API_URL` en build-time
  (una URL fija por bundle), así que en prod un solo bundle no puede tener dos URLs de API.
- **Decisión:** en **producción**, el front **deriva la URL del backend del host en runtime**,
  con una **plantilla determinista**: `https://api-<key>.garcia3apps.com`, donde `<key>` es la
  MISMA key de marca que `resolveBrand` extrae del subdominio (`elektra.garcia3apps.com` →
  `api-elektra.garcia3apps.com`). Sin condicionales por marca, sin mapa configurable: el host
  de la página determina el backend de forma física. En **dev/local** se mantiene
  `VITE_API_URL` (build-time), como hoy. La resolución vive en `config/env` o un helper
  `resolveApiUrl(hostname, appEnv, baseDomain, viteApiUrl)` puro y testeable, análogo a
  `resolveBrand`; `apiUrl` se sigue inyectando en `fetchPublicKey`/`apiFetch` (no cambia su
  contrato).
- **Por qué:** reduce el riesgo residual del front compartido a casi cero — como el backend
  se deriva del `hostname` real del navegador con una plantilla sin ramas, un cliente en
  `elektra.` **no puede** pegar a `shopinbaz.` aunque hubiera un bug de marca (tendría que
  estar físicamente en otro host). Reusa la key ya resuelta (una sola fuente de verdad de
  "qué marca es esta página"). Escala a marca nueva sin tocar código (misma plantilla).
  Mantiene el white-label (un solo front) sin el riesgo de cruce que preocupaba.
- **Descartado:**
  - **`VITE_API_URL` build-time en prod:** un solo valor por bundle no sirve a dos marcas; y
    si se derivara por lógica en vez de por host, reaparece el riesgo de cruce.
  - **`api.<marca>.garcia3apps.com` (anidado):** requiere reemitir el cert con SANs nuevas y
    anida subdominios; `api-<key>` es plano y el cert actual ya lo contempla para las marcas
    conocidas (para marcas futuras se amplía el cert, igual que cualquier subdominio nuevo).
  - **apiUrl en el `<key>.json` de marca:** mete la URL del backend en config pública y acopla
    front↔config; una entrada mal puesta en el JSON cruzaría marcas — justo el error lógico
    que esta decisión busca evitar. El backend es infraestructura, no configuración de marca.
- **Nota:** en dev el backend es `api-dev.` (un único backend, datos de dev), así que la
  plantilla `api-<key>` NO aplica en dev — por eso dev sigue con `VITE_API_URL`. La derivación
  por host solo se activa en prod (`appEnv==='prod'`), coherente con cómo `resolveBrand` trata
  los entornos.

## 21. Pipeline CI/CD: rama `staging` de integración + deploy del FRONT por Actions (backend auto por App Runner)

- **Contexto (2026-07-05):** con dev y prod funcionando, se automatiza el deploy. El ADR 17
  planteó `dev`→dev y `main`→prod, pero al operar salió un problema real: **cada push a una
  rama con backend dispara un redeploy de App Runner** (que tarda ~5-8 min y a veces falla
  opacamente — se sufrió con shopinbaz, 4 CREATE_FAILED). Mandar cada PR de feature
  directo a `dev` provocaría re-deploys constantes e innecesarios del backend.
- **Decisión — cuatro niveles de rama con una de integración sin deploy:**
  ```
  feature ─PR→ staging ─PR→ dev ─PR→ main
             (solo CI)   (deploy dev) (deploy prod)
  ```
  - **`staging`:** rama de integración donde caen los PRs de features. Corre **solo CI**
    (lint/test/typecheck/audit/gitleaks) — **NO despliega nada, ni front ni backend**.
    Acumula varias tareas estables antes de promocionar. Ningún App Runner la observa.
  - **`dev`:** al mergear `staging`→`dev`, se despliega el entorno dev.
  - **`main`:** al mergear `dev`→`main`, se despliega prod (elektra + shopinbaz).
  - Promoción **siempre por PR** (revisable/auditable), no push directo.
- **Decisión — qué despliega el pipeline:**
  - Las **GitHub Actions despliegan SOLO el FRONT** (build con las env del entorno →
    `aws s3 sync` → `cloudfront create-invalidation`). Un workflow que, según la rama
    (`dev` o `main`), apunta al bucket/distribución correspondiente. Para `main` (prod),
    el mismo build sirve a elektra y shopinbaz (front compartido, ADR 20) → un solo
    bucket/distribución, una invalidación.
  - El **BACKEND se auto-despliega solo**: los App Runner ya tienen
    `AutoDeploymentsEnabled=true` observando su rama (dev→`dev`, elektra/shopinbaz→`main`).
    Al hacer push a esas ramas, App Runner detecta el commit y redeploya su servicio sin
    intervención de las Actions. El pipeline **no llama a App Runner** (ni `start-deployment`
    ni espera RUNNING).
- **Por qué:**
  - `staging` sin deploy es la pieza que resuelve el problema real: integrar features sin
    machacar App Runner con redeploys por cada PR. Los deploys ocurren solo en las
    promociones deliberadas (staging→dev, dev→main).
  - Separar "Actions despliega el front" de "App Runner auto-despliega el backend" mantiene
    el pipeline simple y sin tener que manejar en CI los fallos/tiempos de App Runner (que
    son opacos). Cada capa hace lo suyo; menos superficie que mantener.
  - Deploy por push tras merge (no `workflow_dispatch` manual) mantiene el flujo automático
    una vez el PR se aprueba; el control humano está en aprobar el PR de promoción.
- **Consecuencia — CI en todas las ramas:** el workflow de CI (`ci.yml`) hoy solo dispara en
  `main`; hay que ampliarlo a `staging` y `dev` (push + PR) para que la calidad se valide en
  cada nivel. El workflow de deploy es separado y dispara en push a `dev`/`main`.
- **Descartado:**
  - **PRs de feature directo a `dev`:** redeploys de App Runner por cada PR (el problema).
  - **Actions controlando el deploy del backend** (`start-deployment` + esperar RUNNING):
    mete en el pipeline los tiempos y fallos opacos de App Runner; el auto-deploy nativo ya
    lo cubre sin ese acoplamiento.
  - **Deploy manual (`workflow_dispatch`) en dev/main:** un paso manual extra sin ganancia;
    el gate humano ya está en el PR de promoción.
  - **Front separado por marca en prod:** ya descartado (ADR 20) — un solo build/bucket sirve
    ambas, así que el deploy de prod es una sola operación, no dos.

### 21.a — Branch protection: `main`, `dev` y `staging` solo por PR (2026-07-05)

- **Decisión:** las tres ramas del flujo (`main`, `dev`, `staging`) tienen **branch
  protection en GitHub: prohibido el push directo, solo se actualizan vía Pull Request**
  con el CI en verde. Ningún cambio entra a estas ramas sin pasar por un PR revisable.
- **Por qué:** hace cumplir el flujo del ADR 21 por construcción — sin protección, un push
  directo a `dev`/`main` saltaría staging y dispararía un deploy sin revisión. La protección
  garantiza que feature→staging→dev→main sea el ÚNICO camino, y que cada promoción pase el CI.
- **Config aplicada por rama:** `required_pull_request_reviews` (PR obligatorio),
  `required_status_checks` (CI debe pasar: quality + secret-scan), y bloqueo de push directo
  (`enforce_admins` para que aplique también al owner). Como es un repo de un solo
  desarrollador, los approvals requeridos se dejan en 0 (no hay otro revisor), pero el PR y
  el CI verde siguen siendo obligatorios — el gate real es el CI, no un segundo par de ojos.
- **Nota:** al ser owner único, se puede mergear el propio PR; la protección impide el push
  directo y exige el PR + CI, que es lo que se busca (trazabilidad + calidad, no un segundo
  aprobador que no existe).

## 22. Dictado universal: fallback a Whisper vía backend (Groq `whisper-large-v3-turbo`) — feature `voice_universal`

> **⚠️ SUPERSEDIDO en parte por el ADR 23 (2026-07-05).** La arquitectura de *fallback*
> (nativo preferente + Groq solo en Firefox/Brave) se revierte: Groq pasa a ser el motor
> ÚNICO. Lo que SIGUE VIGENTE de este ADR: el endpoint `POST /voice/transcribe`, el
> proveedor Groq `whisper-large-v3-turbo` (webm directo, `language: 'es'`), la gestión de
> la `GROQ_API_KEY` y el descarte de transformers.js/Transcribe. Ver ADR 23.

- **Contexto (2026-07-05):** el dictado usa la Web Speech API nativa, que funciona en
  Chrome/Edge/Safari pero NO en Firefox (no implementa la API) ni en Brave (bloquea el
  servicio de reconocimiento de Google → `errorCode === 'network'`). `voice_reliability`
  (ADR 14) ya degrada elegante ocultando el micrófono donde no hay forma de dictar. El
  enunciado (`docs/ExamenPractico_Front.md`) permite explícitamente "APIs nativas, librerías
  o **servicios de IA**". Se quiere dictado FUNCIONAL en los 4 navegadores. Research completo
  con fuentes primarias 2026 en `progress/voice_universal/research.md` (sección "Research A vs B").

- **Decisión:** añadir un **fallback** (no un reemplazo) basado en **Whisper vía backend**,
  proveedor **Groq `whisper-large-v3-turbo`**. El front graba con `MediaRecorder`
  (`audio/webm;codecs=opus`) y hace un único `POST` multipart a un endpoint propio
  (`POST /voice/transcribe`); el backend reenvía el `Blob` **sin transcodificar** a Groq (que
  acepta `webm` directo) con `language: 'es'` y devuelve `{ text }`. La `GROQ_API_KEY` es
  secreto de entorno (Parameter Store en prod, validado por Zod al boot pero **opcional**:
  su ausencia no tumba el arranque, solo desactiva el fallback), **nunca en el bundle ni en el
  repo**. El fallback se activa SOLO cuando el camino nativo no sirve (`isSupported === false`
  en Firefox, o `voiceUnavailable === true` en Brave); Chrome/Safari siguen con Web Speech
  nativo. Deps nuevas de backend aprobadas: `groq-sdk` (aísla el proveedor tras el service) y
  `multer` (parseo multipart con límite de tamaño integrado). Una única clave de texto nueva en
  el schema de marca: `voice.transcribingLabel` (con `.default()`, ninguna marca edita su JSON).

- **Por qué fallback y no único método (decidido con el usuario, 2026-07-05):** hacer Groq el
  ÚNICO motor metería una dependencia de red + API key + free tier externo en el camino que hoy
  es gratis, instantáneo e infalible (Chrome/Safari, la mayoría de evaluadores), con peor
  latencia (se pierden los parciales en vivo de `interimResults`) y jubilando la UX nativa ya
  `done` (`voice_ux`, `voice_reliability`). El valor de la feature es **rescatar Firefox/Brave**,
  y el fallback lo logra sin degradar a nadie más. Usar lo nativo donde funciona y caer al
  servicio de IA donde no, es la decisión de ingeniería defendible ante el evaluador. La
  presentación se unifica en `NameField` para que el usuario no perciba qué motor corre debajo.

- **Por qué Groq/Whisper-backend frente a las alternativas:** fiabilidad idéntica en los 4
  navegadores (el trabajo lo hace el servidor); **sin transcodificar** (Groq acepta webm/opus
  directo → se elimina la Web Audio API y el troceo PCM que hacía caro a Transcribe); encaja con
  la infra existente (~35 líneas de endpoint en el backend ya en App Runner, key por el mismo
  patrón Parameter Store que `CRYPTO_PRIVATE_KEY`); coste ~nulo (free tier Groq 2.000 req/día);
  latencia de cientos de ms; y el service aísla el proveedor tras `transcribeAudio(...)` →
  cambiar a OpenAI sería tocar solo ese archivo.

- **Alternativas descartadas** (detalle en `progress/voice_universal/research.md`):
  - **(B) transformers.js (Whisper WASM/WebGPU en el navegador):** 0 backend y 0 secreto, pero
    castiga justo a Firefox/Linux (sin WebGPU estable en 2026 → WASM lento) con una descarga de
    modelo de 78-145 MB antes del primer texto — peor experiencia en el navegador a rescatar — y
    mete complejidad WASM/WebGPU + ampliación de la CSP para el CDN de HuggingFace.
  - **Amazon Transcribe (streaming):** descartado antes (2026-07-04, usuario): exige PCM crudo
    transcodificado + proxy WebSocket de larga duración en App Runner + coste $0.024/min.
  - **OpenAI `gpt-4o-mini-transcribe`:** alternativa válida y ~igual de simple; Groq gana por
    free tier más generoso y menor latencia. El endpoint queda agnóstico, así que Groq no cierra
    la puerta a cambiar de proveedor.

## 23. Groq como motor de voz ÚNICO y flujo grabar→enviar — feature `voice_groq_default` (supersede parte del ADR 22)

- **Contexto (2026-07-05):** el ADR 22 decidió Web Speech nativo como preferente y Groq solo
  como **fallback** para Firefox/Brave. Probándolo en runtime apareció un defecto de UX del
  fallback reactivo: en Brave el nativo **arranca**, muere con `error === 'network'`, y solo
  **la 2ª pulsación** cae a Groq — la 1ª se desperdicia. El problema es estructural: no se puede
  saber **a priori** si un Chromium tiene el servicio de reconocimiento de Google disponible
  (Brave lo bloquea, Chrome no), así que la detección solo ocurre **después** de fallar una vez.
  El "baile" nativo↔fallback es intrínseco a decidir entre dos motores en caliente.

- **Decisión (con el usuario, 2026-07-05):** **Groq pasa a ser el motor de voz único** en los 4
  navegadores. Se **elimina** `useVoiceInput` (Web Speech) y toda su UX en vivo. El motor de
  grabación+transcripción (antes `useVoiceFallback`) pasa a ser el **motor principal** y se
  renombra a `useVoiceRecorder`. La UX del botón cambia a **grabar → enviar en 2 clics**: el icono
  refleja la acción del PRÓXIMO clic (micrófono para empezar a grabar; icono "enviar" nuevo, SVG
  inline avión de papel, para parar la grabación y subir el audio a Groq); durante la subida el
  botón queda ocupado (`aria-busy`) con `voice.transcribingLabel`.

- **Qué se ELIMINA:** `frontend/src/voice/useVoiceInput.ts` y su test; toda la UX nativa en
  `NameField` (toggle `isListening`, `voiceUnavailable`, `interimResults`, no-speech sintético,
  ocultar/deshabilitar mic por soporte, `aria-pressed`). Los tests de `voice_ux`/`voice_reliability`
  que afirman sobre esos comportamientos se retiran con justificación.

- **Qué se CONSERVA sin cambios:** el endpoint backend `POST /voice/transcribe` (Groq, multer,
  rate-limit), la capa de red `frontend/src/api/transcribeVoice.ts`, y el schema de marca `voice.*`
  (cero clave nueva: "grabando" reusa `voice.listeningLabel`).

- **Por qué motor único:** el valor de tener dos motores (nativo gratis/instantáneo en Chrome/Safari)
  no compensa el "baile" de la 1ª pulsación en Brave ni la complejidad de orquestar dos hooks. Un
  motor único da comportamiento idéntico y predecible en los 4 navegadores; la presentación
  (grabar→enviar) es explícita y no depende de detectar soporte en caliente.

- **Trade-off aceptado (explícito):** Chrome/Safari **ahora también** dependen de Groq + backend +
  `GROQ_API_KEY` + red en el camino **común** (antes solo Firefox/Brave). Se pierden los parciales en
  vivo (`interimResults`) y la latencia sube de ~0 a cientos de ms + red. A cambio: cero baile, un
  solo camino de código, UX uniforme. Si el backend/Groq caen, el **input manual sigue siendo el
  camino garantizado** (mitiga el riesgo).

- **Supersede:** la parte del ADR 22 sobre arquitectura de fallback (nativo preferente); las features
  `voice_ux` y `voice_reliability` (UX nativa completa, ADR 14); y la orquestación nativo↔fallback de
  `voice_universal`. El endpoint y la decisión Groq/Whisper del ADR 22 siguen vigentes.

## 24. Detección de silencio local (Web Audio API) + auto-envío del dictado — feature `voice_auto_send`

- **Contexto (2026-07-05):** tras `voice_groq_default` (ADR 23), el dictado es grabar→enviar de 2
  clics con un único auto-stop **por tiempo** (`MAX_RECORDING_MS = 10 s`). Probando en runtime, el
  usuario detecta el hueco: si pulsas "grabar" y no hablas, a los 10 s se sube un `Blob` vacío/ruido a
  Groq igualmente (coste, latencia, cero resultado). Y el envío normal exige un 2º clic manual.
- **Decisión (con el usuario, 2026-07-05):** añadir **detección de silencio local** con la **Web Audio
  API** (`AudioContext` + `AnalyserNode` sobre el mismo `MediaStream` de `getUserMedia`) al motor
  `useVoiceRecorder`, con dos efectos: (a) **auto-envío** cuando el usuario habló y luego calló
  (silencio sostenido `SILENCE_HANG_MS = 1.5 s` tras haber superado el umbral); (b) **corte con aviso
  `voice.noSpeech` sin subir audio** cuando nunca se habló (`NO_SPEECH_TIMEOUT_MS = 3 s` siempre bajo
  umbral). El auto-stop por tiempo (10 s) se conserva como red superior; el silencio server-side (Groq
  `''`→`no-audio`) como segunda red. La detección se parte en `createSilenceDetector` (lógica temporal
  pura y testeable) + `createAudioLevelMeter` (borde Web Audio, mide RMS normalizado con
  `getByteTimeDomainData`) + cableado en el motor.
- **Distinción (a)/(b):** un flag `hasSpoken` (alguna muestra superó `SPEECH_THRESHOLD ≈ 0.06`) separa
  "auto-enviar" de "no-speech". Sin voz previa el silencio dispara `no-speech`; con voz previa dispara
  `send` tras la ventana de cuelgue.
- **Por qué Web Audio API:** soportada en los 4 navegadores (Chrome/Firefox/Safari/Brave), **100%
  local**, misma familia que `getUserMedia`/`MediaRecorder` que ya funciona; **no depende del servicio
  de reconocimiento de Google** que rompió el dictado en Brave con Web Speech (ADR 22/23) — no
  reintroduce ese problema.
- **Parámetros:** `SPEECH_THRESHOLD`, `SILENCE_HANG_MS`, `NO_SPEECH_TIMEOUT_MS`, `SAMPLE_MS` como
  **constantes nombradas del motor**, NO en el schema de marca (comportamiento común a todas las marcas,
  como el límite de 15). Valores iniciales razonables; se **calibran probando** con micrófono real.
  Invariante: `SILENCE_HANG_MS < NO_SPEECH_TIMEOUT_MS < MAX_RECORDING_MS`.
- **Privacidad:** el análisis de nivel es local; **nada nuevo** sale del navegador y en el caso "nunca
  habló" **ya no se sube** audio (menos datos que antes). Exigencia: `AudioContext.close()` y
  cancelación del bucle de muestreo en toda salida de `recording` (auto-envío, no-speech, stop manual,
  auto-stop por tiempo, unmount) para no dejar el micrófono vivo.
- **Descartado:** (1) detección **server-side** como mecanismo primario — no da auto-envío y sube audio
  vacío; se conserva solo como segunda red. (2) **Librería VAD** (`vad-web` y afines) — dependencia
  nueva + modelo WASM/ONNX para un problema que un umbral RMS + ventana temporal resuelve sin
  dependencias; sobredimensionado.
- **`requires_approval`: false** — UX del frontend; no toca cifrado/claves/contrato/backend, no añade
  dependencias, reduce datos subidos.

## 25. Límite de nombre fijo en 15 (NO configurable por marca) + feedback de longitud unificado — feature `voice_auto_send`

- **Contexto (2026-07-05):** probando el dictado, el usuario nota que "Jesus Garcia Peralta" se
  rellena como "Jesus Garcia Pe" (15 chars exactos): el `clampToMax(15)` corta a media palabra, igual
  que en el teclado, pero en voz el corte sorprende porque no hay feedback claro de que se alcanzó el
  tope. Surge la pregunta de si el límite de 15 debería ser **configurable por marca**.
- **Hallazgo de arquitectura:** el "15" está hardcodeado en TRES sitios independientes —
  `NameField.tsx` (front), `crypto.controller.ts` `MAX_NAME_LENGTH` (validación 400) y
  `record.model.ts` `maxlength` (defensa Mongo). El schema de marca ya tiene `counterTemplate`
  con placeholder `{max}`, pero el valor no se lee de config. Además, **el backend NO lee la config de
  marca** (los JSON de `brand/data`, `brand/seeds` y S3 los consume solo el front); la marca llega al
  backend de forma implícita por la URL (`api-<key>`, backend aislado por marca en prod, ADR 20).
- **Decisión (con el usuario, 2026-07-05):** **el límite se mantiene FIJO en 15, NO configurable.**
  Solo se añade el **feedback de longitud unificado** (UX): cuando el nombre alcanza los 15 caracteres,
  se muestra un aviso/error de longitud, tanto en escritura manual como en dictado por voz; ambos
  siguen recortando a 15. El "15" se centraliza en una constante única del front (deja de duplicarse en
  literales), pero sigue siendo constante, no config de marca.
- **Por qué NO configurable ahora:** hacerlo bien exigiría que el límite fuese coherente en front Y
  backend — y como el backend valida `≤15` por su cuenta (defensa, no puede confiar en el cliente),
  habría que decidir cómo el backend conoce el límite de cada marca de forma segura (env por backend de
  marca, o que el backend lea su JSON, o que el front lo mande —esto último inseguro—). Es un cambio de
  arquitectura fullstack con su propia superficie de seguridad, desproporcionado para el tiempo
  disponible y para un límite que el enunciado fija en 15. Se deja como posible feature futura
  (`configurable_name_limit`) si se retoma; el placeholder `{max}` del `counterTemplate` ya deja el
  camino preparado en el front.
- **`requires_approval`: false** — el límite no cambia (sigue 15 en los 3 sitios); solo se añade
  feedback de UX en el front. No toca cifrado, validación del backend ni el contrato.

## 26. `records_list`: nombre COMPLETO sin enmascarar (alias voluntario, no PII sensible) — feature `records_list`

- **Contexto (2026-07-05):** la feature `records_list` es un EXTRA fuera del enunciado: una
  pantalla que lista los registros persistidos (`nombre` + `número consecutivo`) leídos de Mongo,
  como **evidencia visible de que el contador persiste** (metí "Juan"→42; recargo→sigue 42/Juan).
  Al mostrar el nombre surge la pregunta de privacidad: `docs/seguridad.md:98-102` exige "no
  persistir material CRIPTOGRÁFICO" (se respeta: no se guarda ni clave de sesión, ni IV, ni
  ciphertext) y que `records_list` "respete la privacidad acordada". Se consideró enmascarar el
  nombre (`J****`, o solo iniciales) por prudencia.
- **Decisión (con el usuario, 2026-07-05):** se muestra el **NOMBRE COMPLETO, sin enmascarar**.
- **Por qué:**
  - Lo persistido **no es PII real**: es un **alias voluntario de ≤15 caracteres** que el usuario
    teclea o dicta únicamente para el saludo ("¿Cómo prefieres que te llamemos?"). No hay cuentas,
    login, email, teléfono ni dato que identifique a una persona (ADR 10: sin sistema de usuarios).
  - Enmascararlo **no aporta seguridad real**: el nombre completo sigue en Mongo en claro
    (`record.model.ts`); ocultarlo solo en la UI sería **teatro de seguridad**, no un control.
  - Enmascarar **rompe el propósito** de la pantalla: es una herramienta de verificación del
    evaluador (comprobar que el nombre que metió se guardó y sobrevive a recargas). `J****` no
    permite verificar nada.
  - La exigencia de `seguridad.md` ("respetar la privacidad acordada") se cumple: la privacidad
    acordada para un alias no sensible voluntario es mostrarlo tal cual; lo que NO se expone es
    material criptográfico, y eso se respeta.
- **Alcance de auditoría:** esta feature **NO** dispara `security-auditor` — no toca cifrado,
  claves ni el contrato de cifrado; solo LEE registros ya persistidos por `consecutive_counter`.
  `GET /records` no descifra nada ni expone secretos.
- **Descartado:**
  - **Enmascarar (`J****`):** teatro de seguridad (el dato sigue en claro en Mongo), y rompe la
    verificación que es el fin de la pantalla.
  - **Solo iniciales:** mismo problema, con menos utilidad aún para el evaluador.

## 27. `records_list`: React Router con ruta `/records` no listada (herramienta del evaluador, no control de acceso) — feature `records_list`

- **Contexto (2026-07-05):** hasta ahora el front renderiza una sola pantalla (`App` → `WelcomeScreen`,
  sin router). `records_list` añade una **segunda pantalla** (el listado). Hay que decidir cómo se
  navega a ella y si debe ser visible.
- **Decisión (con el usuario, 2026-07-05):**
  - Se introduce **`react-router-dom`** (última estable) con dos rutas: **`/` → `WelcomeScreen`** y
    **`/records` → `RecordsList`**.
  - **`/records` NO tiene ningún enlace visible** en la UI (ni `<Link>`, ni botón, ni toggle): es una
    **herramienta del evaluador** accesible **solo escribiendo la URL directamente**.
- **IMPORTANTE — URL no listada ≠ URL protegida:** que la ruta no aparezca en la UI es **discreción,
  no control de acceso**. El endpoint `GET /records` es **público**: cualquiera que conozca o adivine
  `/records` entra y ve los registros. No hay auth porque no hay sistema de usuarios (ADR 10) y los
  datos no son sensibles (ADR 26, alias voluntarios). Esto se documenta explícitamente para no dar la
  falsa impresión de que "no listar" protege algo.
- **Por qué:**
  - Un router es la forma estándar y escalable de tener más de una pantalla; `react-router-dom` es la
    librería de facto en React, mantenida y con tipos. La dependencia nueva se justifica aquí (dos
    pantallas reales), no es bloat.
  - No listar `/records` mantiene la pantalla de bienvenida **limpia y fiel a las maquetas** (que no
    muestran ningún enlace a un listado), sin inventar UI que el enunciado no pide, mientras deja al
    evaluador una vía directa para comprobar la persistencia.
- **Descartado:**
  - **Mostrar el listado tras generar (sin router, con estado):** mezcla dos responsabilidades en una
    pantalla y ensucia el flujo core de bienvenida; un router separa limpio las dos vistas.
  - **Toggle/enlace siempre visible a `/records`:** añade UI fuera de las maquetas y del enunciado; el
    listado es instrumento de verificación, no una feature de producto para el usuario final.
  - **Proteger `/records` con auth:** no hay sistema de usuarios (ADR 10) y los datos no son sensibles
    (ADR 26); montar auth para esto sería scope injustificado.
