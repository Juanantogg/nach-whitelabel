# Runbook de infra AWS — feature `deploy`

Registro de **todos los comandos AWS** y pasos manuales usados para montar la
infra de deploy. Sirve para auditar, reproducir y (al terminar la prueba)
**destruir** todo. Se va actualizando conforme avanzamos.

> Decisiones que respaldan esto: ADR 9, 11, 13, **17**, **18**, **19** en
> [`docs/decisiones.md`](../../docs/decisiones.md).

## Contexto de la cuenta

| Dato | Valor |
|---|---|
| Cuenta AWS | `026225422252` |
| Usuario IAM (CLI) | `nach-whitelabel-cli` (AdministratorAccess) |
| Región por defecto | `us-east-1` (cercana a México; obligatoria para ACM+CloudFront) |
| Dominio | `garcia3apps.com` (DNS en **Namecheap BasicDNS**; apex = parking/redirect de Namecheap — NO se toca) |

> ⚠️ **Nota (2026-07-05):** existen DOS dominios en la cuenta de Namecheap,
> `garcia3apps.com` y `garcia3apps.com.mx`, ambos con nameservers de Namecheap.
> La infra va sobre **`.com`** (el que está en línea con la página principal). Los
> CNAME de validación ACM se crearon primero por error en la zona `.com.mx` y se
> movieron a la zona `.com`. El certificado ACM se emitió para `.com` desde el
> principio, así que es correcto y NO se rehace. Cuidado de no confundir las dos
> zonas en el panel de Namecheap.

## Convención de entornos (ADR 17)

| Entorno | Rama | Front | Backend |
|---|---|---|---|
| dev | `dev` | `dev.garcia3apps.com` | `api-dev.garcia3apps.com` |
| prod | `main` | `elektra.` / `shopinbaz.garcia3apps.com` | `api.garcia3apps.com` |
| (común) | — | `brands.garcia3apps.com` (config+assets de marca) | — |

Orden de construcción: **dev completo primero**, validar, luego clonar a prod y
automatizar con GitHub Actions.

---

## Paso 1 — Instalar AWS CLI

```bash
brew install awscli
aws --version   # aws-cli/2.35.15 Python/3.14.6 Darwin/25.5.0
```

## Paso 2 — Configurar credenciales

Usuario IAM `nach-whitelabel-cli` creado en consola (AdministratorAccess), access
key generada para CLI. Configurado en local (el secret NO se registra aquí):

```bash
aws configure
#   AWS Access Key ID:     (AKIA... del usuario nach-whitelabel-cli)
#   AWS Secret Access Key: ****
#   Default region name:   us-east-1
#   Default output format: json
```

Verificación:

```bash
aws sts get-caller-identity
# { "UserId": "AIDAQMGZIF6WHBH57LGY6",
#   "Account": "026225422252",
#   "Arn": "arn:aws:iam::026225422252:user/nach-whitelabel-cli" }
```

---

## Paso 3 — Certificado ACM (us-east-1, SANs dev+prod)

Un solo certificado con validación DNS cubre los 6 subdominios (dev y prod), para
no repetir la validación después.

```bash
aws acm request-certificate \
  --region us-east-1 \
  --domain-name dev.garcia3apps.com \
  --subject-alternative-names \
      api-dev.garcia3apps.com \
      elektra.garcia3apps.com \
      shopinbaz.garcia3apps.com \
      api.garcia3apps.com \
      brands.garcia3apps.com \
  --validation-method DNS \
  --tags Key=Project,Value=nach-whitelabel Key=ManagedBy,Value=cli
```

**Resultado — CertificateArn:**
`arn:aws:acm:us-east-1:026225422252:certificate/8872b2af-dc95-497c-8966-3a29fbe1ea82`

Obtener los CNAME de validación:

```bash
CERT_ARN="arn:aws:acm:us-east-1:026225422252:certificate/8872b2af-dc95-497c-8966-3a29fbe1ea82"
aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query 'Certificate.DomainValidationOptions[].{Dominio:DomainName,Nombre:ResourceRecord.Name,Valor:ResourceRecord.Value}' \
  --output json
```

### 3.1 — CNAMEs de validación a crear en Namecheap (MANUAL)

Namecheap → `garcia3apps.com` → Advanced DNS → Host Records → Add New Record.
Type = `CNAME Record`. En **Host** va solo la parte antes de `.garcia3apps.com`
(Namecheap añade el dominio; NO incluir el punto final). En **Value**, quitar
también el punto final.

| Host | Value |
|---|---|
| `_9ecf009ffdc29bf6679b9beb3cae524a.dev` | `_b9087a6ff4acd10d7338217c7213aea7.jkddzztszm.acm-validations.aws` |
| `_926a82827d1f32d3d3ccf1fa2d05d5a2.api-dev` | `_34fbedda2cc4f56fbf97430fd176c016.jkddzztszm.acm-validations.aws` |
| `_bacc8d68fcb4f08562ca08ebaa62596c.elektra` | `_5fbb83418e700c7fde6aefb8de5c5c16.jkddzztszm.acm-validations.aws` |
| `_a52364b72c6bfa5b76f63953c5adfa72.shopinbaz` | `_744735d42cdde964dad03fc48e5448dc.jkddzztszm.acm-validations.aws` |
| `_5f20c94784418c3190a15ff6e2cefe75.api` | `_a0f104c8a0b384567ceca0a29e4f30a5.jkddzztszm.acm-validations.aws` |
| `_fe99b5adb05ec83f5f9300e37d5aecb8.brands` | `_ebdbc4f3e7c70705e5e0fb2b7ed3a456.jkddzztszm.acm-validations.aws` |

Comprobar validación (pasa a `ISSUED` cuando propaga, minutos a ~1 h):

```bash
aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query 'Certificate.Status' --output text   # -> ISSUED
```

---

## Paso 4 — Front dev (bucket S3 + CloudFront + DNS)

Front estático de `dev.garcia3apps.com`. Bucket privado servido por CloudFront con
OAC (patrón recomendado; no expone S3 directo).

### 4.1 Bucket privado del front dev
```bash
BUCKET="dev.garcia3apps.com"
aws s3api create-bucket --bucket "$BUCKET" --region us-east-1
aws s3api put-bucket-tagging --bucket "$BUCKET" \
  --tagging 'TagSet=[{Key=Project,Value=nach-whitelabel},{Key=Env,Value=dev},{Key=ManagedBy,Value=cli}]'
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

### 4.2 Origin Access Control (compartido front + brands)
```bash
aws cloudfront create-origin-access-control --origin-access-control-config '{
  "Name":"nach-s3-oac","Description":"OAC buckets privados nach","SigningProtocol":"sigv4",
  "SigningBehavior":"always","OriginAccessControlOriginType":"s3"}'
```
**OAC Id:** `E2EF0EB660ONNE`

### 4.3 Distribución CloudFront dev
Config en `scratchpad/cf-dev.json`. Claves: alias `dev.garcia3apps.com`, cert ACM,
`redirect-to-https`, CachePolicy `CachingOptimized` (658327ea-...), OAC, y
CustomErrorResponses 403/404 → `/index.html` (200) para la SPA. PriceClass_100.
```bash
aws cloudfront create-distribution --distribution-config file://scratchpad/cf-dev.json
```
- **Distribution Id:** `E2F4MOT22AV6BH`
- **CloudFront domain:** `dm0fl84zoos86.cloudfront.net`

### 4.4 Bucket policy — solo esta distribución lee (OAC)
```bash
# scratchpad/bucket-policy-dev.json: Principal cloudfront.amazonaws.com,
# Condition AWS:SourceArn = arn:aws:cloudfront::026225422252:distribution/E2F4MOT22AV6BH
aws s3api put-bucket-policy --bucket dev.garcia3apps.com --policy file://scratchpad/bucket-policy-dev.json
```

### 4.5 Build y subida del front dev
```bash
# Build con el flag de entorno dev (ADR 18: habilita ?brand=)
cd frontend
VITE_APP_ENV=dev VITE_API_URL=https://api-dev.garcia3apps.com pnpm build

# Subida: assets con hash immutable (cache largo) + index.html no-cache
BUCKET="dev.garcia3apps.com"
aws s3 sync dist/ "s3://$BUCKET/" --delete --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" --content-type "text/html"
```

> Tras cada re-deploy del front, invalidar el cache de CloudFront:
> `aws cloudfront create-invalidation --distribution-id E2F4MOT22AV6BH --paths "/*"`

### 4.6 CNAME en Namecheap (usuario)
`dev` CNAME → `dm0fl84zoos86.cloudfront.net`.

**Validado:** 301 http→https, 200 https + SSL ok, SPA fallback (ruta inexistente →
200 index.html), asset JS 200, `?brand=` habilitado.

---

## Paso 5 — Bucket de marcas (`brands.garcia3apps.com`)

Sirve los `<key>.json` y assets de marca (ADR 3, 13). Bucket PRIVADO + CloudFront +
OAC (mismo patrón que el front), con CORS porque el front lo consume cross-origin.

### 5.1 Bucket privado de marcas
```bash
BUCKET="brands.garcia3apps.com"
aws s3api create-bucket --bucket "$BUCKET" --region us-east-1
aws s3api put-bucket-tagging --bucket "$BUCKET" \
  --tagging 'TagSet=[{Key=Project,Value=nach-whitelabel},{Key=ManagedBy,Value=cli}]'
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

### 5.2 CloudFront de marcas
Config en `scratchpad/cf-brands.json`. Como la de dev pero SIN CustomErrorResponses
(no es SPA). **OJO**: el `ViewerCertificate` es obligatorio si hay alias (el primer
intento falló con `InvalidViewerCertificate` por omitirlo). El CORS se configura
después (ver 5.6, quedó mal en el primer intento).
```bash
aws cloudfront create-distribution --distribution-config file://scratchpad/cf-brands.json
```
- **Distribution Id:** `E2SBK7WB7ZWQTJ`
- **CloudFront domain:** `d72j3wo8g1sly.cloudfront.net`

### 5.3 Bucket policy (solo esta distribución, OAC)
```bash
aws s3api put-bucket-policy --bucket brands.garcia3apps.com --policy file://scratchpad/bucket-policy-brands.json
# Condition AWS:SourceArn = arn:aws:cloudfront::026225422252:distribution/E2SBK7WB7ZWQTJ
```

### 5.4 Subir JSON + assets de marca
Estructura: `<key>.json` en raíz, assets en `<key>/<asset>` (ADR 13). JSON con cache
corto (300s) para actualizar config sin re-deploy; assets con cache 1 día.
```bash
BUCKET="brands.garcia3apps.com"
for b in elektra shopinbaz; do
  aws s3 cp frontend/src/brand/seeds/$b.json "s3://$BUCKET/$b.json" \
    --content-type application/json --cache-control "public,max-age=300"
done
# Ilustraciones y logos por marca (desde .tmp-variantes/):
aws s3 cp .tmp-variantes/illustration-elektra.svg   "s3://$BUCKET/elektra/illustration.svg"   --content-type image/svg+xml --cache-control "public,max-age=86400"
aws s3 cp .tmp-variantes/illustration-shopinbaz.svg "s3://$BUCKET/shopinbaz/illustration.svg" --content-type image/svg+xml --cache-control "public,max-age=86400"
aws s3 cp .tmp-variantes/logo-elektra.svg           "s3://$BUCKET/elektra/logo.svg"           --content-type image/svg+xml --cache-control "public,max-age=86400"
aws s3 cp .tmp-variantes/shopinbaz-777e5d12.svg     "s3://$BUCKET/shopinbaz/logo.svg"         --content-type image/svg+xml --cache-control "public,max-age=86400"
```

### 5.5 CNAME en Namecheap (usuario)
`brands` CNAME → `d72j3wo8g1sly.cloudfront.net`.

### 5.6 La saga CORS (3 diagnósticos hasta la solución determinista)

El fetch cross-origin del front (`dev.`) al JSON de marca (`brands.`) falló hasta
resolver DOS causas encadenadas. Registro completo para no repetir el error:

**Diagnóstico 1 — header `Accept` fuerza preflight (ADR 19).** En el navegador,
`fetch(elektra.json)` daba "No 'Access-Control-Allow-Origin' header". `loadBrand.ts`
mandaba `headers: { Accept: 'application/json' }`, que hace la petición NO-simple →
dispara preflight `OPTIONS` → S3 privado con OAC no maneja OPTIONS → 403. **Fix
(ADR 19, vía TDD):** quitar el header `Accept` → petición CORS-simple, sin preflight.

**Diagnóstico 2 — envenenamiento de cache (causa raíz).** Tras el fix del `Accept`
SEGUÍA fallando en el navegador, aunque `curl -H Origin` sí recibía el header. Causa:
la CachePolicy **`CachingOptimized` NO incluye `Origin` en la cache key**, así que
CloudFront cachea UNA respuesta por URL (a veces sin CORS) y la reparte a todos. El
`vary: Origin` es solo un hint para el navegador, NO controla el cacheo de CloudFront.
La config quedó además incoherente al improvisar (OriginRequestPolicy CORS-S3Origin +
bucket sin CORS + ResponseHeadersPolicy compitiendo). → se lanzó al researcher para el
patrón canónico (informe en `research-cors.md`).

**Solución (Opción B del research) ✅** — una sola fuente de CORS + `Origin` en la
cache key:
```bash
# 1. CachePolicy con Origin en cache key + gzip/brotli
aws cloudfront create-cache-policy --cache-policy-config file://scratchpad/cache-policy-cors.json
#   -> CachePolicyId e9016d82-d216-4f7e-a43c-93164895bfb4  (whitelist Headers=[Origin])
# 2. ResponseHeadersPolicy CORS *
aws cloudfront create-response-headers-policy --response-headers-policy-config file://scratchpad/rhp-cors.json
#   -> ResponseHeadersPolicyId dd39b7d3-43fa-485e-8188-76f7bd067f1a
# 3. update-distribution: set CachePolicyId + ResponseHeadersPolicyId, del OriginRequestPolicyId, Compress=true
aws cloudfront update-distribution --id E2SBK7WB7ZWQTJ --distribution-config file://scratchpad/brands.new.json --if-match <ETag>
# 4. invalidar (imprescindible: borra respuestas envenenadas)
aws cloudfront create-invalidation --distribution-id E2SBK7WB7ZWQTJ --paths "/*"
```

**Policies definitivas de `E2SBK7WB7ZWQTJ`:** `CachePolicy=e9016d82` (custom, Origin
en key), `ResponseHeadersPolicy=dd39b7d3` (CORS `*`), `OriginRequestPolicy=NINGUNA`,
bucket sin CORS config.

**Verificado:**
- curl con Origin ×3: `access-control-allow-origin: *` SIEMPRE, incluso en `Hit from cloudfront` ✅
- Playwright `dev.garcia3apps.com/?brand=elektra`: fetch OK 200, **0 errores de consola**,
  `--brand-primary = 242 74 45` (rojo Elektra), logo/ilustración/textos correctos ✅
- `?brand=shopinbaz`: fetch OK 200, 0 errores, `--brand-primary = 170 59 255` (morado) ✅

---

## Recursos creados (referencia rápida)

| Recurso | Id / valor |
|---|---|
| ACM cert (us-east-1) | `...certificate/8872b2af-dc95-497c-8966-3a29fbe1ea82` (ISSUED) |
| OAC (compartido) | `E2EF0EB660ONNE` |
| Bucket front dev | `dev.garcia3apps.com` (privado) |
| CloudFront dev | `E2F4MOT22AV6BH` → `dm0fl84zoos86.cloudfront.net` |
| Bucket marcas | `brands.garcia3apps.com` (privado) |
| CloudFront marcas | `E2SBK7WB7ZWQTJ` → `d72j3wo8g1sly.cloudfront.net` |
| CachePolicy CORS | `e9016d82-d216-4f7e-a43c-93164895bfb4` |
| ResponseHeadersPolicy CORS | `dd39b7d3-43fa-485e-8188-76f7bd067f1a` |

---

## Estado

- [x] Paso 3 — ACM **`ISSUED`** ✅
- [x] Paso 4 — Front dev subido, CloudFront + DNS + `?brand=` (ADR 18) ✅
- [x] Paso 5 — Bucket marcas + CloudFront + CORS resuelto (ADR 19 + Opción B) ✅
- [x] `VITE_APP_ENV` (ADR 18) — TDD completo (RED→GREEN→REVIEW) ✅
- [x] `loadBrand` sin `Accept` (ADR 19) — TDD completo ✅
- [ ] **Paso 6 — Backend dev: Atlas M0 + App Runner + Parameter Store**
- [ ] Clonar a prod
- [ ] GitHub Actions (dev→dev, main→prod)

### 🎉 Entorno DEV (front + marcas) — COMPLETO
`dev.garcia3apps.com` sirve el white-label funcionando: `?brand=elektra` /
`?brand=shopinbaz` cargan su tema real desde S3, HTTPS, 0 errores de consola.
Falta el **backend (App Runner)** para que el envío del nombre funcione end-to-end.

---

## Paso 6 — Repo GitHub + flujo de ramas + fix de CI

### 6.1 Repo y ramas (ADR 17)
- Repo **público** `Juanantogg/nach-whitelabel` (creado por el usuario).
- Remote SSH: `git@github.com:Juanantogg/nach-whitelabel.git`.
- `main` (prod) avanzada por fast-forward hasta el trabajo actual; `dev` creada desde `main`.
- Rama por defecto: `main`. Ambas ramas subidas.

### 6.2 Fix de CI — `allowBuilds` bloqueaba esbuild
Al subir, **todos los jobs de CI fallaban** en `pnpm install --frozen-lockfile`:
`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.1` → exit 1. Causa: el
`allowBuilds: {}` del ADR 16 bloquea TODO build, y `esbuild` (bundler nativo transitivo de
Vite/tsx) necesita su postinstall; con `strictDepBuilds` el bloqueo es un fallo, no un aviso.
**Fix:** `allowBuilds: { esbuild: true }` en `pnpm-workspace.yaml` (resto sigue bloqueado;
sintaxis de map verificada con docs pnpm 11). Validado en el CI real vía **PR #7 dev→main**
(quality + secret-scan verdes), squash-merged. `dev` re-alineada a `main`.

> **Nota CI/CD pendiente:** el workflow `.github/workflows/ci.yml` solo dispara en `main`
> (push + PR). Para el flujo dev→prod hay que **añadir `dev` a los triggers** para que el CI
> de calidad corra también en dev. Apuntado para los workflows de deploy.

> **Minutos Actions:** repo PÚBLICO = gratis e ilimitado. Sin preocupación de coste.

> **Dependabot:** activo, 6 PRs abiertos (fallaban por el mismo bug de esbuild; ya arreglado).
> En pausa por decisión del usuario; se revisan/mergean más adelante.

---

## Paso 7 — Backend dev (App Runner + Atlas + Parameter Store) [EN CURSO]

- **Fuente:** App Runner desde el repo GitHub (rama `dev`), vía `apprunner.yaml` (runtime
  gestionado, no Docker). Investigación del patrón pnpm-monorepo en `research-apprunner.md`.
- **Atlas:** se REUSA el cluster de dev local para el `api-dev` desplegado (ADR 11 exige
  separar prod, no dev-local de dev-desplegado). Pendiente: Network Access para App Runner.
- **Secretos:** `MONGODB_URI` + `CRYPTO_PRIVATE_KEY` a Parameter Store SecureString (ADR 11).
- **CORS:** `CORS_ORIGINS` incluirá `https://dev.garcia3apps.com` (env var, no secreto).
- **CNAME:** `api-dev` → App Runner (pendiente).

---

## Cómo destruir todo (al terminar la evaluación)

Se completará al final con los comandos `delete-*` en orden inverso. Recordatorio
clave del ADR 9: **App Runner NO es free tier**, apagarlo/eliminarlo es lo primero.
