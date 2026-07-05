# Runbook de infra AWS — PRODUCCIÓN (elektra + shopinbaz)

Infra del entorno **prod**. Complementa [`runbook.md`](runbook.md) (dev), que sirve de
plantilla: aquí solo se documenta lo **distinto** de prod, referenciando dev para lo común.

> Decisiones que respaldan esto: **ADR 20** (aislamiento por empresa) y **ADR 20.a**
> (front deriva el backend por host) en [`docs/decisiones.md`](../../docs/decisiones.md),
> además de ADR 9, 11, 13, 17.

## Arquitectura de prod (ADR 20)

```
Front COMPARTIDO (sin datos):
  elektra.garcia3apps.com    ─┐
  shopinbaz.garcia3apps.com  ─┴─→ 1 bucket S3 + 1 CloudFront (2 aliases)
                                   mismo bundle; resolveBrand lee el subdominio;
                                   resolveApiUrl deriva api-<key> por host (ADR 20.a)

AISLADO por empresa (con datos):
  elektra.   → api-elektra.garcia3apps.com   → App Runner nach-elektra-prod   → Atlas elektra
  shopinbaz. → api-shopinbaz.garcia3apps.com → App Runner nach-shopinbaz-prod → Atlas shopinbaz
  secretos:  /nach/elektra/*                    /nach/shopinbaz/*  (Parameter Store)

COMÚN (ya existe, de dev):
  brands.garcia3apps.com (config+assets de marca) · certificado ACM · OAC
```

## Qué se comparte con dev (NO se recrea)

| Recurso | Estado |
|---|---|
| Certificado ACM | Ya ISSUED; cubre `elektra.`, `shopinbaz.`, `api.` — falta SAN `api-elektra`/`api-shopinbaz` (ver nota) |
| Bucket de marcas `brands.garcia3apps.com` | Ya existe y sirve elektra/shopinbaz |
| OAC `E2EF0EB660ONNE` | Compartido |
| Connection GitHub `nach-github` | Reusable para los App Runner de prod (rama `main`) |

> ⚠️ **SAN del cert:** el cert actual tiene `api.garcia3apps.com` pero la convención del
> ADR 20.a es `api-<key>` → hacen falta `api-elektra.garcia3apps.com` y
> `api-shopinbaz.garcia3apps.com`. ACM **no permite añadir SANs a un cert existente**.
> **Decisión (opción B):** emitir un **cert NUEVO solo para `api-elektra` + `api-shopinbaz`**,
> dejando el cert de dev intacto (aísla prod de dev también a nivel cert; solo 2 CNAME de
> validación nuevos, no re-valida ni re-configura los CloudFront de dev). Los CloudFront de los
> backends de prod usarán este cert; los aliases de front `elektra.`/`shopinbaz.` ya los cubre
> el cert existente. NO incluir el apex `garcia3apps.com` (es la web Firebase, ADR 17).
> _(Nota: un primer intento emitió un cert con el apex + todas las SANs y se borró por
> precipitado — no re-emitir hasta llegar a este paso.)_

---

## Prerrequisito de código — `resolveApiUrl` (ADR 20.a) [EN CURSO]

Antes de buildear el front de prod, el front debe **derivar el backend del host** en prod
(`<key>.garcia3apps.com` → `https://api-<key>.garcia3apps.com`), manteniendo `VITE_API_URL`
en dev/local. Se implementa vía TDD (tester→implementer→reviewer) como función pura
`resolveApiUrl`, análoga a `resolveBrand`. Estado: _pendiente de arrancar el ciclo_.

---

## Pasos de infra prod

- [x] `resolveApiUrl` + integración en env (código, TDD, ADR 20.a) — commit `8925fc6`
- [x] Cert prod (opción B): `api-elektra` + `api-shopinbaz`
- [x] Front prod: bucket + CloudFront con 2 aliases + build+subida
- [ ] CNAMEs de validación del cert prod (2, cortos) — usuario
- [ ] CNAMEs `elektra`, `shopinbaz` → CloudFront front prod — usuario
- [ ] Secretos `/nach/elektra/*` y `/nach/shopinbaz/*` (2 Atlas ya creados por el usuario)

> **Atlas prod:** el usuario creó **3 PROYECTOS Atlas separados** (`elektra`, `nach-whitelabel`=dev,
> `shopinbaz`), 1 cluster M0 cada uno (todos `Cluster0` por el free tier). Aislamiento mejor
> aún que el ADR 20 (separa usuarios de BD, Network Access y billing por proyecto).
> **Nombre de la BD en la URI (path):** usar `/elektra` y `/shopinbaz` (NO `/nach`) — el nombre
> de BD es libre y no está hardcodeado en el backend (verificado: los modelos fijan colecciones
> `records`/`counters`, la BD sale del path de la URI). Auto-documenta qué BD es de qué marca.
> Ej: `mongodb+srv://...@cluster0.xxx.mongodb.net/elektra?retryWrites=true&w=majority`.
> Los NAMESPACES de Parameter Store sí se llaman `/nach/elektra/*` y `/nach/shopinbaz/*` (es el
> prefijo del proyecto, no el nombre de la BD; no confundir).
- [x] Instance roles IAM por marca (aislados: cada uno solo a su namespace SSM)
- [ ] 2 App Runner (`nach-elektra-prod`, `nach-shopinbaz-prod`) desde rama `main`
- [ ] CloudFront delante de cada backend (`api-elektra.`, `api-shopinbaz.`) + CNAMEs
- [ ] Prueba E2E por marca (aislamiento: elektra no ve datos de shopinbaz)

### P1 — Cert prod (opción B)
```bash
aws acm request-certificate --region us-east-1 \
  --domain-name api-elektra.garcia3apps.com \
  --subject-alternative-names api-shopinbaz.garcia3apps.com \
  --validation-method DNS
```
**Cert ARN prod:** `arn:aws:acm:us-east-1:026225422252:certificate/f9f26036-5615-4255-aee3-72e6f7f76534`
**CNAME de validación (Namecheap, cortos):**
| Host | Value |
|---|---|
| `_2f9526d77350fd502154a3dc841b5f7e.api-elektra` | `_951fc9dc6a094ce4ee923e08e9b53c22.jkddzztszm.acm-validations.aws` |
| `_8519cbfbf7b6a75cd96d9a26798a2c37.api-shopinbaz` | `_ccea35750e210f52368c0aaf6ee4df07.jkddzztszm.acm-validations.aws` |

### P2 — Front prod (1 CloudFront, 2 aliases; cert de dev que ya cubre elektra./shopinbaz.)
```bash
# Bucket NEUTRO (sirve ambas marcas, no es de una): prod-front.garcia3apps.com
aws s3api create-bucket --bucket prod-front.garcia3apps.com --region us-east-1
aws s3api put-public-access-block --bucket prod-front.garcia3apps.com --public-access-block-configuration ...=true
# CloudFront con Aliases=[elektra., shopinbaz.], cert 8872b2af (existente), SPA 403/404→index.html
aws cloudfront create-distribution --distribution-config file://scratchpad/cf-prod-front.json
#   -> Id EGG76TCOPNRIB, domain d2w9hi3u2vufmj.cloudfront.net
aws s3api put-bucket-policy --bucket prod-front.garcia3apps.com --policy file://scratchpad/bucket-policy-prod-front.json
# Build PROD: SIN VITE_API_URL (deriva el backend por host, ADR 20.a); solo VITE_APP_ENV=prod
cd frontend && VITE_APP_ENV=prod pnpm build
aws s3 sync dist/ s3://prod-front.garcia3apps.com/ --delete --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://prod-front.garcia3apps.com/index.html --cache-control "no-cache,no-store,must-revalidate" --content-type text/html
```
- **CloudFront front prod:** `EGG76TCOPNRIB` → `d2w9hi3u2vufmj.cloudfront.net`
- Bundle verificado: NO hornea ninguna URL de API (lleva la plantilla `api-${key}` que
  resuelve por host); `api-dev` NO aparece como string completo. ✅
- **CNAMEs de front (usuario):** `elektra` y `shopinbaz` → `d2w9hi3u2vufmj.cloudfront.net`

## Notas de divergencia con dev

- **Front:** idéntico a dev §4, pero el CloudFront lleva **2 aliases** y el build usa
  `VITE_APP_ENV=prod` (sin `VITE_API_URL`: lo deriva `resolveApiUrl` por host).
- **Backend:** idéntico a dev §7 pero **duplicado por marca**, cada uno apuntando a su Atlas
  y sus secretos. Mismo `apprunner.yaml` (el repo es el mismo); la diferencia es env/secretos
  por servicio → se pasan en `create-service` o por rama.
- **Atlas:** clusters SEPARADOS por empresa (ADR 11 + 20), no se reusa el de dev.
- **DNS:** los CNAME de backend (`api-elektra`, `api-shopinbaz`) son cortos → sin el problema
  de los 60 chars de Namecheap que tuvo el dominio custom de App Runner en dev (§7.7).
