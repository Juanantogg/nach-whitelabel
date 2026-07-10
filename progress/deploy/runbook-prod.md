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
- [~] 2 App Runner (`nach-elektra-prod`, `nach-shopinbaz-prod`) desde rama `main` — creándose

### Config por entorno (yaml solo-build + runtime por API)
El `apprunner.yaml` dejó de fijar secretos/CORS (PR #9): define solo el BUILD (común).
Cada servicio inyecta su runtime por API en create-service (`ConfigurationSource: API`,
`CodeConfigurationValues` con `RuntimeEnvironmentVariables` + `RuntimeEnvironmentSecrets`).
El backend **dev** se migró a este modelo (verificado health 200 tras el cambio).

**Backends de prod (rama `main`, config por API):**
| Servicio | Secretos | CORS_ORIGINS | Instance role | URL App Runner |
|---|---|---|---|---|
| `nach-elektra-prod` | `/nach/elektra/*` | `https://elektra.garcia3apps.com` | `AppRunnerNach-elektra-prod` | `4iuvug7aam.us-east-1.awsapprunner.com` |
| `nach-shopinbaz-prod` | `/nach/shopinbaz/*` | `https://shopinbaz.garcia3apps.com` | `AppRunnerNach-shopinbaz-prod` | `taphfd9m7a.us-east-1.awsapprunner.com` |

ARNs:
- elektra: `arn:aws:apprunner:us-east-1:026225422252:service/nach-elektra-prod/6e10780f9ab3451abb20ae78073870a0`
- shopinbaz: `arn:aws:apprunner:us-east-1:026225422252:service/nach-shopinbaz-prod/3539da9ac34940258259ff22811b52c4`

> **shopinbaz falló al 1er intento (`CREATE_FAILED`)**: faltaba abrir el Network Access del
> cluster Atlas de shopinbaz. El backend conecta a Mongo al arrancar (`connectDb` en el
> bootstrap), así que sin Network Access el proceso no inicia → health check falla →
> CREATE_FAILED (sin logs de build/application, solo el service group vacío = fallo temprano).
> Borrado y recreado tras abrir el Atlas. Elektra sí tenía su Atlas abierto (llegó a tener
> log group `application` = runtime arrancó).
> **shopinbaz 2º fallo (re-diagnóstico honesto):** volvió a CREATE_FAILED con el mismo
> patrón early-fail (sin log group `application`). Se verificó EXHAUSTIVAMENTE que la config
> estaba bien: Network Access `0.0.0.0/0` Active en el proyecto shopinbaz, y la MONGODB_URI
> conecta+autentica OK desde local (`mongoose.connect` → CONN_OK, igual que elektra). O sea:
> NO era ni la IP ni las credenciales. Se atribuye a timing transitorio de App Runner (o al
> Network Access aún propagándose durante el deploy). Recreado (3er intento): URL nueva
> `b2rrss23un.us-east-1.awsapprunner.com`, ARN `.../400c5151925b4e86ad8d320e74c9d510`.
> **OJO:** el CloudFront api-shopinbaz (EMH6BY4L1OO9Y) apunta al origin VIEJO (`taphfd9m7a`) →
> al arrancar el nuevo, actualizar el origin del CloudFront a `b2rrss23un...awsapprunner.com`.

- [x] CloudFront delante de cada backend (`api-elektra.`, `api-shopinbaz.`) — cert prod ISSUED
- [ ] CNAMEs de backend (`api-elektra`, `api-shopinbaz`) → sus CloudFront — usuario
- [x] Prueba E2E por marca — **AISLAMIENTO CONFIRMADO** ✅

### shopinbaz: resolución tras 4 fallos (plan B = clonar config de elektra)
Los 4 primeros intentos de `nach-shopinbaz-prod` fallaron con CREATE_FAILED, build OK pero
sin log group `application` (contenedor no arrancaba en App Runner), pese a que TODO estaba
verificado idéntico a elektra (build, secretos que conectan+autentican, server arranca local
en 2s, roles/KMS idénticos, cuota 30 servicios sin tocar, cuenta ACTIVE sin problema de
billing). **Fix (plan B):** crear `nach-shopinbaz-prod-v3` **clonando la config EXACTA de
elektra** (`describe-service` de elektra → cambiar solo namespace de secretos/CORS/role) en
vez de escribir el JSON a mano. Arrancó a la primera. Causa probable: una diferencia sutil
en los JSON de create manuales (algún default que la clonación replicó bien) y/o caché de
build envenenada de los intentos previos (nombre nuevo la evita).
- **Servicio final shopinbaz:** `nach-shopinbaz-prod-v3`, ARN
  `.../nach-shopinbaz-prod-v3/37b65616a75a4dcf8740689b2d2b0c01`, URL `mmbzedrjkf.us-east-1.awsapprunner.com`.
- CloudFront `api-shopinbaz` (EMH6BY4L1OO9Y) actualizado a ese origin (update-distribution + invalidación).

### E2E de PROD por marca (Playwright) — AISLAMIENTO DEMOSTRADO
| Marca | Front | Nombre | Nº registro | Backend (POST /names) | Consola |
|---|---|---|---|---|---|
| elektra | `elektra.garcia3apps.com` | "Cliente Elektra" | **1** | `api-elektra.garcia3apps.com` → 200 | 0 errores |
| shopinbaz | `shopinbaz.garcia3apps.com` | "Cliente Shopinbaz" | **1** | `api-shopinbaz.garcia3apps.com` → 200 | 0 errores |

**Ambas dieron `1`** = contadores INDEPENDIENTES por Atlas. Si compartieran BD, shopinbaz
habría dado `2`. Prueba en producción del ADR 20: front compartido + backend+BD aislados +
derivación del backend por host (ADR 20.a). Cero cruce de datos entre empresas.

---

## 🎉🎉🎉 PROD COMPLETO Y FUNCIONANDO — AISLAMIENTO REAL
- **Front compartido:** `elektra.garcia3apps.com` + `shopinbaz.garcia3apps.com` (1 CloudFront, 2 aliases, mismo bundle, auto-tema por subdominio)
- **Backends aislados:** `api-elektra` → App Runner elektra → Atlas elektra · `api-shopinbaz` → App Runner shopinbaz → Atlas shopinbaz
- **Secretos/roles aislados por marca** (Parameter Store + IAM por namespace)
- E2E verificado por marca con contadores independientes.

**Nota de costos (App Runner NO es free tier):** 3 servicios × 1vCPU/2GB ≈ **$7/semana** con
tráfico de prueba (casi todo memoria provisionada; ~$30/mes los 3 solo encendidos). Pausar
(`aws apprunner pause-service`) baja a ~$0 entre demos. Apagar/eliminar tras la evaluación (ADR 9).
Cost Anomaly Detection activado en la cuenta (gratis) avisa por email de gastos anómalos.

### CloudFront de backends (patrón api-dev: CachingDisabled + AllViewerExceptHostHeader)
Cert prod `f9f26036` **ISSUED** (ambos dominios SUCCESS). Un CloudFront por backend:
| Alias | Origin (App Runner) | CloudFront Id | CloudFront domain |
|---|---|---|---|
| `api-elektra.garcia3apps.com` | `4iuvug7aam...awsapprunner.com` | `E3QO0FC71M3VXV` | `d2rmq9nknifoj.cloudfront.net` |
| `api-shopinbaz.garcia3apps.com` | `taphfd9m7a...awsapprunner.com` | `EMH6BY4L1OO9Y` | `d24hq3a0jck0lk.cloudfront.net` |

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

---

## Pipeline CI/CD (ADR 21 / 21.a)

### Flujo de ramas
```
feature ─PR→ staging ─PR→ dev ─PR→ main
           (solo CI)   (deploy dev)  (deploy prod: elektra+shopinbaz)
```
- **staging:** integración, solo CI (lint/test/typecheck/audit/gitleaks), SIN deploy.
- **dev:** push → deploy front dev (por Actions) + backend dev (auto App Runner).
- **main:** push → deploy front prod + backends elektra/shopinbaz (auto App Runner).

### Branch protection (las 3 ramas)
`main`, `dev`, `staging`: push directo BLOQUEADO (`enforce_admins`), solo por PR con CI verde
(`quality` + `secret-scan`), sin force-push ni borrado. Owner único → approvals=0 (el gate es
el CI, no un 2º revisor). Configurado vía `gh api PUT .../branches/<rama>/protection`.

### Autenticación Actions→AWS: OIDC (sin secretos)
- **OIDC provider:** `token.actions.githubusercontent.com` en la cuenta.
- **Rol:** `GitHubActionsNachDeploy`, trust acotado a `repo:Juanantogg/nach-whitelabel` ramas
  `dev`/`main`. Permisos MÍNIMOS: `s3:sync` a los buckets de front (dev + prod-front) +
  `cloudfront:CreateInvalidation` a las 2 distros de front. NADA de access keys en el repo.

### Workflows
- **`ci.yml`:** dispara en push+PR a main/dev/staging (antes solo main). quality + secret-scan.
- **`deploy-front.yml`:** dispara en push a dev/main. Determina entorno por rama:
  - dev → build `VITE_APP_ENV=dev VITE_API_URL=api-dev` → bucket dev + invalidar `E2F4MOT22AV6BH`.
  - main → build `VITE_APP_ENV=prod` (SIN VITE_API_URL, deriva por host) → bucket prod-front + invalidar `EGG76TCOPNRIB`.
  - Backend NO lo toca (App Runner auto-deploy). Actions pineadas por SHA (ADR 16).

### Gotchas resueltos montando el pipeline
- **Node 22:** el deploy-front usaba `.nvmrc` (Node 20) pero pnpm 11.10 requiere >=22.13 →
  el 1er deploy falló en Setup Node. Fix: `node-version: 22` (igual que ci.yml). El OIDC NO
  era el problema (falló antes del step de credenciales).
- **commitlint:** el subject del commit no puede empezar en mayúscula (`subject-case`) — "CI"
  al inicio rompía; usar minúscula.
- **Divergencia squash + ramas de larga vida:** el squash-merge hace que staging/dev diverjan
  en SHAs aunque el contenido sea igual → PRs staging→dev dan conflicto espurio. Se reconcilia
  reseteando staging a dev (unprotect → `push --force` → re-protect). Alternativa a futuro:
  merge-commits en vez de squash.

### Verificado
Deploy-front en dev: **todos los steps success** (OIDC, build, S3 sync, CloudFront invalidate);
`dev.garcia3apps.com` → 200. El pipeline despliega el front automáticamente al mergear a dev.

---

## Destrucción de PROD — EJECUTADO ✅ (2026-07-10)

Prod se destruyó junto con dev el **2026-07-10** (limpieza total de la cuenta a petición del
usuario). Los comandos y el orden de dependencias están en la sección **"Cómo destruir todo"**
del [`runbook.md`](runbook.md) (dev) — no se duplican aquí. Recursos de prod eliminados:

| Recurso prod | Id / nombre |
|---|---|
| App Runner `nach-elektra-prod` | `.../6e10780f9ab3451abb20ae78073870a0` |
| App Runner `nach-shopinbaz-prod-v3` | `.../37b65616a75a4dcf8740689b2d2b0c01` |
| CloudFront front prod (2 aliases) | `EGG76TCOPNRIB` |
| CloudFront `api-elektra` | `E3QO0FC71M3VXV` |
| CloudFront `api-shopinbaz` | `EMH6BY4L1OO9Y` |
| Bucket front prod | `prod-front.garcia3apps.com` |
| ACM cert prod (`api-elektra`+`api-shopinbaz`) | `f9f26036-5615-4255-aee3-72e6f7f76534` |
| SSM `/nach/elektra/*` + `/nach/shopinbaz/*` | 4 SecureString |
| IAM roles `AppRunnerNach-{elektra,shopinbaz}-prod` | 2 |

**Verificado a `0`** en el barrido final (App Runner, CloudFront, S3, ACM, SSM, IAM roles Nach).

**Fuera de AWS — BORRADO ✅ (usuario):** eliminados los CNAMEs de
`elektra`/`shopinbaz`/`api-elektra`/`api-shopinbaz` en Namecheap, y los **2 Atlas de prod**
(proyectos `elektra` y `shopinbaz`) con los datos reales de cada marca. Detalle completo en
la sección de destrucción del runbook de dev. **Desmantelamiento de prod COMPLETO.**
