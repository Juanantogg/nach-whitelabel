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

## Pasos de infra prod (se irán rellenando)

- [ ] Reemitir/emitir cert con SANs `api-elektra`, `api-shopinbaz` (+ validar en Namecheap)
- [ ] `resolveApiUrl` (código, TDD) — ADR 20.a
- [ ] Front prod: 1 bucket + 1 CloudFront con aliases `elektra.` + `shopinbaz.` (build `VITE_APP_ENV=prod`)
- [ ] CNAMEs `elektra`, `shopinbaz` → CloudFront front prod
- [ ] Atlas: 2 clusters nuevos (elektra, shopinbaz) — usuario
- [ ] Secretos `/nach/elektra/*` y `/nach/shopinbaz/*` en Parameter Store — usuario
- [ ] Instance roles IAM por marca (o uno con acceso a ambos namespaces)
- [ ] 2 App Runner (`nach-elektra-prod`, `nach-shopinbaz-prod`) desde rama `main`
- [ ] CloudFront delante de cada backend (`api-elektra.`, `api-shopinbaz.`) + CNAMEs
- [ ] Prueba E2E por marca (aislamiento: elektra no ve datos de shopinbaz)

## Notas de divergencia con dev

- **Front:** idéntico a dev §4, pero el CloudFront lleva **2 aliases** y el build usa
  `VITE_APP_ENV=prod` (sin `VITE_API_URL`: lo deriva `resolveApiUrl` por host).
- **Backend:** idéntico a dev §7 pero **duplicado por marca**, cada uno apuntando a su Atlas
  y sus secretos. Mismo `apprunner.yaml` (el repo es el mismo); la diferencia es env/secretos
  por servicio → se pasan en `create-service` o por rama.
- **Atlas:** clusters SEPARADOS por empresa (ADR 11 + 20), no se reusa el de dev.
- **DNS:** los CNAME de backend (`api-elektra`, `api-shopinbaz`) son cortos → sin el problema
  de los 60 chars de Namecheap que tuvo el dominio custom de App Runner en dev (§7.7).
