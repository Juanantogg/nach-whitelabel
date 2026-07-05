# Research — deploy / CORS S3(privado+OAC) + CloudFront cross-origin

> Fecha: 2026-07-05. Fuentes primarias: docs de AWS CloudFront + S3 y re:Post
> knowledge-center (URLs al final). Objetivo: que el navegador reciba SIEMPRE
> `Access-Control-Allow-Origin` correcto, sin lotería de caché.

## Preguntas

1. ¿Cuál es el patrón canónico AWS para S3(privado+OAC)+CloudFront+CORS cross-origin?
2. ¿Combinación (A) CORS-en-bucket + OriginRequestPolicy CORS-S3Origin, o (B) SIN CORS
   en bucket + ResponseHeadersPolicy? ¿Cuál es determinista y por qué?
3. ¿Es imprescindible que la CachePolicy incluya `Origin` en la cache key? ¿O basta `vary`?
4. ¿S3 privado con OAC responde al preflight OPTIONS? ¿Cómo se maneja? ¿Con fetch simple
   desaparece el preflight?
5. Comandos AWS CLI exactos para arreglar la distribución `E2SBK7WB7ZWQTJ` y el bucket.
6. Con fetch simple y `ACAO: *`, ¿importa `AllowedOrigins` del bucket? ¿`*` vs echo del Origin?

---

## Hallazgos (fuentes primarias)

- **La causa raíz diagnosticada es correcta y está documentada por AWS.** El header
  `vary: Origin` es una pista para el **navegador**, NO controla el cacheo de CloudFront.
  CloudFront decide qué cachea/varía **solo** por la *cache key* (definida en la
  CachePolicy). AWS: "By default, CloudFront doesn't consider headers when caching your
  objects... If your origin returns two objects and they differ only by the values in the
  request headers, CloudFront caches only one version of the object." Con `CachingOptimized`
  (`658327ea`) el `Origin` NO está en la cache key ⇒ CloudFront guarda **una** respuesta por
  URL y la sirve a todos; si la primera se cacheó sin (o con otro) `Access-Control-Allow-Origin`,
  el navegador falla mientras `curl` puede acertar según qué haya en esa PoP. Eso es el
  "envenenamiento de caché" que ves. Fuente: header-caching.html (§overview).

- **Patrón CANÓNICO AWS para CORS con origen S3** (header-caching.html, §"Configure
  CloudFront to respect CORS settings" y §"Select the headers to base caching on"):
  1. Activar **CORS en el bucket S3** (el origen es quien decide `Access-Control-Allow-Origin`).
  2. Configurar CloudFront para **reenviar el header `Origin`** al origen **mediante una
     CACHE POLICY** (no basta reenviarlo: al ir en la cache policy, entra en la cache key).
     Cita literal: *"To configure CloudFront to cache responses based on CORS, you must
     configure CloudFront to forward headers by using a cache policy."*
  3. Recomendación explícita AWS: evitar reenviar headers con origen S3 **salvo** que
     necesites CORS — entonces reenvía exactamente `Origin` (y para cachear OPTIONS,
     además `Access-Control-Request-Headers` y `Access-Control-Request-Method`).
  Fuente: header-caching.html.

- **re:Post "No Access-Control-Allow-Origin" (guía oficial de resolución)** confirma los 5
  pasos, en este orden: (1) poner CORS en el origen S3; (2) reenviar `Origin` al origen;
  (3) usar OriginRequestPolicy `CORS-S3Origin`; (4) **crear una CACHE POLICY que INCLUYA el
  header `Origin` en la cache key** — cita: *"It's a best practice to include the origin
  header as part of the cache policy to avoid intermittent CORS errors"*; (5) **invalidar la
  caché** tras el cambio. Fuente: repost.aws/knowledge-center/no-access-control-allow-origin-error.

- **ResponseHeadersPolicy (RHP) CORS** (understanding-response-headers-policies.html): es
  una alternativa válida donde **CloudFront** añade los headers CORS (no el origen). Puntos
  clave verificados:
  - `AccessControlAllowOrigins` admite orígenes específicos o `*`. **CloudFront hace echo
    del Origin de la petición SOLO si ese Origin coincide con la lista** de la política
    (comportamiento estándar de RHP; la política define el conjunto permitido y CF devuelve
    el valor correcto). Aun así, **para que la respuesta cacheada sea correcta por-origen,
    el `Origin` debe estar en la cache key** — RHP no crea variación de caché por sí sola.
  - `OriginOverride`: si `true`, los headers CORS de la política **pisan** los del origen;
    si `false`, respeta los del origen. Con S3 sin CORS, el origen no manda CORS, así que da
    igual, pero conviene `true` para determinismo.
  - La RHP **debe estar adjunta al cache behavior** (crearla no basta).
  Fuente: understanding-response-headers-policies.html, modifying-response-headers.html.

- **Preflight OPTIONS contra S3 privado + OAC**: S3 **sí** responde a OPTIONS *si el bucket
  tiene CORS config* (docs S3: "In response to preflight OPTIONS requests, Amazon S3 returns
  requested headers"). PERO con **OAC** el OPTIONS que CloudFront reenvía al origen se firma
  igual que GET/HEAD, y el `AllowedMethods` del behavior debe incluir OPTIONS (ya lo tienes).
  Si el bucket **no** tiene CORS, S3 no emite headers CORS en OPTIONS ⇒ preflight roto. Con la
  **RHP** (opción B), CloudFront responde el preflight con los headers de la política sin
  tocar S3. Fuente: ManageCorsUsing.html + understanding-response-headers-policies.html.

- **Con fetch SIMPLE no hay preflight — confirmado.** Un `fetch()` GET sin credenciales, sin
  headers no-estándar (Accept/Content-Type simples), es una "petición simple" según Fetch/CORS
  (WHATWG): el navegador **no** dispara OPTIONS; hace el GET directo y solo exige
  `Access-Control-Allow-Origin` en la **respuesta del GET**. El front ya se cambió a fetch
  simple ⇒ **no hay preflight que resolver**; el problema se reduce a que el GET devuelva
  siempre el ACAO correcto (que es exactamente lo que arregla meter `Origin` en la cache key).

---

## Respuesta directa a cada pregunta

### 1) Patrón canónico
S3 con CORS config + CloudFront reenvía `Origin` **vía CachePolicy** (Origin en cache key) +
invalidar. Alternativa igualmente soportada: CloudFront añade CORS con ResponseHeadersPolicy.
En **ambos** casos `Origin` **debe** estar en la cache key.

### 2) ¿(A) o (B)? — Ambas son deterministas SI incluyen Origin en la cache key. Recomendada: (B).
- **(A) — Origen manda CORS.** CORS en bucket + OriginRequestPolicy `CORS-S3Origin` +
  **CachePolicy custom con `Origin` en la cache key** + SIN ResponseHeadersPolicy.
  Es el patrón "de libro" de AWS. Correcto y determinista. Contras: dos sitios que tocar
  (bucket + CloudFront), y si el bucket pierde la CORS config el CORS se cae en silencio.
- **(B) — CloudFront manda CORS.** SIN CORS en bucket + SIN OriginRequestPolicy +
  **ResponseHeadersPolicy CORS** + **CachePolicy custom con `Origin` en la cache key**.
  **Recomendada para este caso**, porque: (i) una sola fuente de verdad de CORS (elimina la
  competencia S3-vs-RHP que hoy tienes rota); (ii) no dependes de que el bucket tenga CORS;
  (iii) con fetch simple no hay preflight, así que no necesitas que S3 responda OPTIONS;
  (iv) el ADR de este repo dice "config sin secretos, front sin credenciales AWS" — RHP es
  la capa natural.
- **Lo que NO debes hacer (tu estado actual):** mezclar OriginRequestPolicy `CORS-S3Origin`
  (que reenvía Origin+preflight esperando que S3 conteste) **con** una ResponseHeadersPolicy
  **y** un bucket SIN CORS **y** una CachePolicy sin `Origin` en la key. Son 4 piezas
  incoherentes: S3 no emite CORS (no tiene config), la RHP sí, y la cache key no varía por
  Origin ⇒ lotería. Hay que elegir A **o** B, limpio.

### 3) ¿Origin en la cache key es imprescindible? — SÍ. `vary` NO basta.
`vary: Origin` solo instruye al **navegador**. CloudFront **ignora** `Vary` para decidir qué
cachea; solo varía por lo que esté en la **cache key** (CachePolicy). Sin `Origin` en la cache
key, CloudFront cachea UNA respuesta por URL y la reparte a todos los orígenes ⇒ envenenamiento.
Mecanismo real: cache miss ⇒ CF va a origen (o aplica RHP) y **almacena** esa respuesta bajo la
clave = URL (+ lo que declare la CachePolicy). Siguiente petición con la misma clave ⇒ cache
hit ⇒ sirve la copia guardada, **sin re-evaluar el Origin**. Meter `Origin` en la cache key hace
que cada origen distinto sea una clave distinta ⇒ cada uno recibe su ACAO correcto.

### 4) Preflight OPTIONS
- Con **fetch simple (lo que ya tienes)**: **no hay preflight**. Confirmado. No hay que
  resolver OPTIONS para el caso real.
- Si en el futuro se hiciera preflight: opción (B) lo cubre sola (RHP responde OPTIONS en el
  edge); opción (A) requiere CORS en el bucket + que la CachePolicy que cachea OPTIONS reenvíe
  `Origin`, `Access-Control-Request-Headers`, `Access-Control-Request-Method`.

### 5) Comandos — ver bloque "COMANDOS" abajo.

### 6) `*` vs echo del Origin específico
- Con **fetch simple sin credenciales**, `Access-Control-Allow-Origin: *` es **suficiente** y
  válido: el navegador acepta `*` para respuestas sin credenciales.
- En **opción (A)** el `AllowedOrigins` del bucket **sí importa**: si listas orígenes
  específicos, S3 hace **echo** del Origin que coincide (y necesitas `Origin` en cache key); si
  pones `["*"]`, S3 devuelve `*` (aún así conviene `Origin` en la key por si algún día pasas a
  lista específica). En **opción (B)** el bucket es irrelevante (no tiene CORS); la RHP decide.
- **Trade-off `*` vs echo específico:**
  - `*`: más simple, cacheable por-origen no crítico (una sola respuesta sirve a todos), ideal
    para config pública sin secretos. **No** permite credenciales. Recomendado aquí (los JSON/SVG
    de marca son públicos y sin secretos — coincide con el ADR).
  - Echo del Origin específico (lista `[dev, elektra, shopinbaz]`): más restrictivo (solo tus
    dominios pueden leer por CORS), **obligatorio** si algún día usas credenciales, pero **exige
    sí o sí `Origin` en la cache key** o envenenas caché. Menos "abierto".
  - **Recomendación:** como los assets son públicos, usa **`*`** por simplicidad y robustez.
    Aun con `*`, **mantén `Origin` en la cache key** (coste marginal, y te blinda si cambias a
    lista específica). Si prefieres cerrar a tus dominios, usa lista específica en la RHP y
    `Origin` en cache key es innegociable.

---

## COMANDOS (listos para aplicar) — región us-east-1

> Requiere `aws-cli` v2 (ya instalado). CloudFront es global; `--region` no aplica a
> `cloudfront` pero sí a `s3api`. **Enfoque recomendado: opción (B)** (una sola fuente CORS).
> Al final se incluye la variante mínima de (A) por si se prefiere.

### Paso 0 — Snapshot del estado actual (por si hay que revertir)
```bash
aws cloudfront get-distribution-config --id E2SBK7WB7ZWQTJ \
  > /tmp/E2SBK7WB7ZWQTJ.before.json
# El ETag va en .ETag; la config en .DistributionConfig
jq -r '.ETag' /tmp/E2SBK7WB7ZWQTJ.before.json          # -> ETAG_ACTUAL
```

### Paso 1 — Crear CachePolicy custom con `Origin` en la cache key + compresión
```bash
cat > /tmp/cache-policy-cors.json << 'JSON'
{
  "Name": "brands-cors-origin-key",
  "Comment": "CORS: incluye Origin en cache key; gzip+brotli; TTLs assets",
  "DefaultTTL": 86400,
  "MaxTTL": 31536000,
  "MinTTL": 0,
  "ParametersInCacheKeyAndForwardedToOrigin": {
    "EnableAcceptEncodingGzip": true,
    "EnableAcceptEncodingBrotli": true,
    "HeadersConfig": {
      "HeaderBehavior": "whitelist",
      "Headers": { "Quantity": 1, "Items": ["Origin"] }
    },
    "CookiesConfig": { "CookieBehavior": "none" },
    "QueryStringsConfig": { "QueryStringBehavior": "none" }
  }
}
JSON

aws cloudfront create-cache-policy \
  --cache-policy-config file:///tmp/cache-policy-cors.json
# Anota el .CachePolicy.Id devuelto  ->  NEW_CACHE_POLICY_ID
```
> Nota: `Origin` en `HeadersConfig` lo mete en la cache key Y lo reenvía al origen — justo lo
> que exige AWS para CORS. Con opción (B) esto último es inocuo (S3 lo ignora).

### Paso 2A — (Opción B) Crear ResponseHeadersPolicy CORS con `*`
```bash
cat > /tmp/rhp-cors.json << 'JSON'
{
  "Name": "brands-cors-simple",
  "Comment": "CORS para assets publicos de marca (fetch simple, sin credenciales)",
  "CorsConfig": {
    "AccessControlAllowOrigins": { "Quantity": 1, "Items": ["*"] },
    "AccessControlAllowHeaders": { "Quantity": 1, "Items": ["*"] },
    "AccessControlAllowMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] },
    "AccessControlAllowCredentials": false,
    "AccessControlExposeHeaders": { "Quantity": 0, "Items": [] },
    "AccessControlMaxAgeSec": 3600,
    "OriginOverride": true
  }
}
JSON

aws cloudfront create-response-headers-policy \
  --response-headers-policy-config file:///tmp/rhp-cors.json
# Anota el .ResponseHeadersPolicy.Id  ->  NEW_RHP_ID
```
> Si prefieres cerrar a tus dominios en vez de `*`, cambia `AccessControlAllowOrigins.Items`
> a `["https://dev.garcia3apps.com","https://elektra.garcia3apps.com","https://shopinbaz.garcia3apps.com"]`
> y `Quantity` a 3. En ese caso `Origin` en la cache key (Paso 1) es OBLIGATORIO.

### Paso 3 — Editar la config de la distribución y aplicar
```bash
# Extrae solo la DistributionConfig y guarda el ETag
jq '.DistributionConfig' /tmp/E2SBK7WB7ZWQTJ.before.json > /tmp/dist-config.json
ETAG=$(jq -r '.ETag' /tmp/E2SBK7WB7ZWQTJ.before.json)

# --- Edita /tmp/dist-config.json en el DefaultCacheBehavior (y en cualquier
#     CacheBehavior que sirva los assets) ---
#   .DefaultCacheBehavior.CachePolicyId            = "NEW_CACHE_POLICY_ID"
#   .DefaultCacheBehavior.ResponseHeadersPolicyId  = "NEW_RHP_ID"       (opcion B)
#   .DefaultCacheBehavior.OriginRequestPolicyId    = eliminar/vaciar    (opcion B)
#   Mantener AllowedMethods GET,HEAD,OPTIONS (o reducir a GET,HEAD si no hay preflight)
#   Asegurar Compress = true
```
Edición determinista con `jq` (opción B; borra OriginRequestPolicy, pone RHP y CachePolicy):
```bash
jq --arg cp "NEW_CACHE_POLICY_ID" --arg rhp "NEW_RHP_ID" '
  .DefaultCacheBehavior.CachePolicyId = $cp
  | .DefaultCacheBehavior.ResponseHeadersPolicyId = $rhp
  | del(.DefaultCacheBehavior.OriginRequestPolicyId)
  | .DefaultCacheBehavior.Compress = true
' /tmp/dist-config.json > /tmp/dist-config.new.json

aws cloudfront update-distribution \
  --id E2SBK7WB7ZWQTJ \
  --if-match "$ETAG" \
  --distribution-config file:///tmp/dist-config.new.json
```
> Si `del(...OriginRequestPolicyId)` da error de esquema, pon `""` en su lugar.
> Si hay `CacheBehaviors` adicionales que sirven los assets, aplícales lo mismo.

### Paso 4 — Invalidar la caché (imprescindible: borra las respuestas envenenadas)
```bash
aws cloudfront create-invalidation \
  --distribution-id E2SBK7WB7ZWQTJ \
  --paths "/*"
```

### Paso 5 — Verificar (dos orígenes distintos + cache hit repetido)
```bash
for i in 1 2 3; do
  curl -sSI -H "Origin: https://dev.garcia3apps.com" \
    https://brands.garcia3apps.com/elektra.json \
    | grep -iE "access-control-allow-origin|x-cache|vary"
  echo "---"
done
# Debe salir SIEMPRE access-control-allow-origin (: * o el echo), incluso en 'Hit from cloudfront'.
```

---

### Variante mínima — Opción (A) (si se prefiere que el origen mande CORS)
```bash
# 1) CORS en el bucket S3 (privado+OAC no impide CORS config)
cat > /tmp/s3-cors.json << 'JSON'
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://dev.garcia3apps.com","https://elektra.garcia3apps.com","https://shopinbaz.garcia3apps.com"],
      "AllowedMethods": ["GET","HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": [],
      "MaxAgeSeconds": 3600
    }
  ]
}
JSON
aws s3api put-bucket-cors \
  --bucket brands.garcia3apps.com \
  --cors-configuration file:///tmp/s3-cors.json
aws s3api get-bucket-cors --bucket brands.garcia3apps.com   # verificar

# 2) En la distribucion: CachePolicy custom del Paso 1 (Origin en key),
#    OriginRequestPolicy = CORS-S3Origin (88a5eaf4 ya lo tienes),
#    ResponseHeadersPolicy = NINGUNA (quitar la SimpleCORS 60669652).
#    Luego update-distribution (como Paso 3) + invalidacion (Paso 4).
```
> Con lista específica en el bucket, S3 hace echo del Origin ⇒ `Origin` en cache key es
> OBLIGATORIO (ya cubierto por la CachePolicy del Paso 1). Si el bucket usara `["*"]`, S3
> devolvería `*`.

---

## Recomendación para esta feature
- **Enfoque:** Opción **(B)** — ResponseHeadersPolicy CORS con `*` + CachePolicy custom con
  `Origin` en la cache key + compresión gzip/brotli, **sin** OriginRequestPolicy y **sin** CORS
  en el bucket. Con fetch simple no hay preflight, y una sola fuente de CORS elimina la lotería.
  Invalidar `"/*"` al final.
- **Trampas a evitar:**
  - Confiar en `vary: Origin` para el cacheo de CloudFront — NO funciona; solo la cache key varía.
  - Dejar dos fuentes de CORS compitiendo (S3-reenviado + RHP) como ahora — incoherente.
  - Olvidar la invalidación: las respuestas envenenadas siguen en la PoP.
  - Poner `Origin` solo en OriginRequestPolicy pensando que basta — reenviar ≠ cache key. AWS
    exige que vaya en la **CachePolicy**.
- **Deprecaciones relevantes:** el modelo legacy "Forward headers" (ForwardedValues) está
  deprecado a favor de CachePolicy/OriginRequestPolicy/ResponseHeadersPolicy — usa políticas.

## Fuentes
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/header-caching.html
  — Prueba que solo la cache key (no `Vary`) hace variar el cacheo; y que para CORS con S3 hay
  que reenviar `Origin` **mediante cache policy**. Núcleo de la respuesta.
- https://repost.aws/knowledge-center/no-access-control-allow-origin-error
  — Guía oficial de resolución: CORS en origen + reenviar Origin + CORS-S3Origin + **CachePolicy
  con Origin en la key ("avoid intermittent CORS errors")** + invalidar.
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-response-headers-policies.html
  — Semántica de la ResponseHeadersPolicy CORS: AllowOrigins `*`/lista, OriginOverride, y que
  debe adjuntarse al behavior.
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-response-headers.html
  — RHP añade CORS sin tocar el origen; crear la política no basta, hay que adjuntarla.
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html
  — Formato CORS del bucket (AllowedOrigins/Methods/Headers/ExposeHeaders/MaxAgeSeconds) y que
  S3 responde OPTIONS devolviendo los headers solicitados (opción A).
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
  — OAC para S3 privado (contexto del origen).
- https://fetch.spec.whatwg.org/#http-cors-protocol
  — CORS protocol: un GET simple sin headers no-estándar ni credenciales NO dispara preflight.
