# Research — deploy (AWS App Runner, backend Express monorepo pnpm)

Fecha: 2026-07-05. Todas las fuentes son docs oficiales de AWS (2023-2026).

## Preguntas

1. ¿El runtime gestionado Node de App Runner soporta pnpm/corepack y monorepos, o
   conviene un Dockerfile? ¿Qué elegir para este repo?
2. ¿Estructura EXACTA de `apprunner.yaml` (schema, runtime, build/run, port, env)?
   ¿Dónde vive el archivo? ¿Permite `source directory` para monorepos?
3. ¿Cómo se inyectan `MONGODB_URI` y `CRYPTO_PRIVATE_KEY` desde Parameter Store
   (SecureString) como env vars de runtime? ¿Sintaxis e IAM?
4. ¿`minimumReleaseAge: 1440` rompe o espera el build? ¿`--frozen-lockfile` lo evita?
5. ¿Cómo configurar el health check en `GET /health`?
6. ¿Qué runtime string usa Node 20 en App Runner?
7. ¿`CORS_ORIGINS` va como env var normal (no secreto)?

---

## HALLAZGO BLOQUEANTE (léelo antes de tocar nada)

Dos hechos oficiales, verificados hoy, invalidan el plan tal cual está escrito en
el ADR 9/11 y obligan a decidir:

### A) App Runner está CERRADO a nuevos clientes

> "After careful consideration, we decided to close AWS App Runner to new
> customers. Existing AWS App Runner customers can continue to use the service as
> normal, including creating new resources and services. AWS continues to invest
> in security and availability for AWS App Runner, but we do not plan to introduce
> new features."
> — https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html

Traducción operativa: **solo pueden crear servicios App Runner las cuentas AWS que
YA eran clientes de App Runner** (que ya tenían al menos un servicio antes del
cierre). Si `garcia3apps` / la cuenta AWS del despliegue **nunca ha usado App
Runner**, la API `CreateService` fallará y no hay forma de habilitarlo. AWS empuja
explícitamente a **Amazon ECS Express Mode** como sustituto (imagen de contenedor
+ 2 roles IAM, sin coste adicional del control plane).

→ ACCIÓN REQUERIDA (pregunta al humano): confirmar si la cuenta AWS de destino ya
tiene App Runner habilitado (¿algún servicio App Runner previo en cualquier
región?). Si NO, App Runner no es una opción y hay que ir a ECS Express Mode
(Dockerfile + ECR), que ya NO es el `apprunner.yaml` pedido.

### B) No existe `nodejs20`. El único runtime Node vivo es `nodejs22`

Runtimes Node gestionados y su estado
(https://docs.aws.amazon.com/apprunner/latest/dg/service-source-code-nodejs-releases.html):

| Runtime   | Build    | End of Support        |
|-----------|----------|-----------------------|
| nodejs22  | revised  | vigente               |
| nodejs18  | revised  | **1-dic-2025 (EOS)**  |
| nodejs16  | original | **1-dic-2025 (EOS)**  |
| nodejs14  | original | 1-dic-2025 (EOS)      |
| nodejs12  | original | 1-dic-2025 (EOS)      |

**No hay `nodejs20` en absoluto** (App Runner saltó de 18 a 22). Y política de EOS:
> "New services cannot be created using the runtimes that have reached the End of
> Support date."

Hoy (jul-2026), nodejs18/16/14/12 están todos post-EOS → **no se puede crear un
servicio nuevo con ellos**. El único runtime Node válido para un servicio NUEVO es
**`nodejs22`**.

→ Consecuencia para este repo: `engines.node >=20` y `.nvmrc=20` **son compatibles
con nodejs22** (22 satisface `>=20`). No hay conflicto; simplemente se despliega
sobre Node 22, no Node 20. Node 22 es LTS y el backend (Express 5, Mongoose 9) corre
igual. Ajuste menor recomendado: no fijar `engines.node` a un rango que excluya 22.

> Cuidado: "A conflict between the `node` version in `package.json` and the
> `runtime-version` value in the App Runner configuration file causes the build
> phase to fail." Como `engines.node` es `>=20` (rango, no versión exacta), 22 lo
> satisface y no hay conflicto. No pongas `runtime-version: 20.x` (no existe).

---

## Hallazgos por pregunta

### 1. Runtime gestionado vs Dockerfile

- **El runtime gestionado Node de App Runner trae `npm` y `yarn`, NO `pnpm`**. Las
  imágenes gestionadas listan `npm 10.9.x, yarn 1.22.22` (ver tabla de releases).
  pnpm NO viene preinstalado.
- **pnpm es habilitable vía corepack** en `build.commands.pre-build` (`corepack
  enable && corepack prepare pnpm@11.10.0 --activate`). Node 22 trae corepack. Es un
  patrón conocido pero **no documentado oficialmente por AWS para App Runner** (AWS
  solo ejemplifica npm/yarn). Funciona, pero es "camino no pavimentado".
- **Monorepos: soportado oficialmente** desde sep-2023 vía **Source directory**
  (https://aws.amazon.com/blogs/containers/aws-app-runner-adds-support-for-monorepos/).
  App Runner ejecuta build/run desde el `SourceDirectory` y `apprunner.yaml` debe
  vivir ahí. PERO en un workspace pnpm el backend depende de la raíz
  (`pnpm-workspace.yaml`, lockfile en raíz) → si pones `SourceDirectory=backend/`,
  App Runner "ve" solo `backend/` y **no encuentra `pnpm-workspace.yaml` ni el
  `pnpm-lock.yaml` de la raíz**, así que `pnpm install --frozen-lockfile` falla. Por
  eso, para un monorepo pnpm lo robusto es **`SourceDirectory` = raíz del repo** y
  filtrar el backend con `pnpm --filter`.

**Recomendación (si App Runner es viable en la cuenta):** runtime gestionado
`nodejs22` + `apprunner.yaml` en la **raíz** del repo + corepack/pnpm en pre-build +
`pnpm --filter @nach/backend`. Prioriza esto sobre Docker porque el usuario eligió
`apprunner.yaml` y evita mantener un Dockerfile. **Trampa a vigilar:** corepack+pnpm
no es un camino que AWS documente; si el build da problemas raros (PATH del store,
permisos), el plan B robusto es **runtime "image" con un Dockerfile** (pnpm en Docker
está perfectamente documentado por pnpm), empujando a ECR. Mantén el Dockerfile como
fallback listado abajo, no como primera opción.

### 2. Estructura de `apprunner.yaml`

Schema confirmado (https://docs.aws.amazon.com/apprunner/latest/dg/config-file-ref.html):

- `version: 1.0` (requerido), `runtime: nodejs22` (requerido).
- `build.commands.pre-build` (opcional, solo en el yaml), `build` (requerido),
  `post-build` (opcional). `build.env` (build-time).
- `run.runtime-version` (opcional, ej. `22.14.0`), `run.pre-run` (opcional, SOLO
  revised build — nodejs22 lo es), `run.command` (requerido), `run.network.port`
  (default 8080), `run.env`, `run.secrets`.
- **Ubicación:** en el **source directory** del servicio. Para este monorepo →
  **raíz del repo** (por la dependencia del workspace/lockfile de raíz).
- **`source directory` para monorepos:** sí, App Runner lo permite (campo
  `SourceCodeRepository.SourceDirectory`), pero aquí lo dejamos en `/` (raíz) por lo
  explicado en (1). El filtrado al backend lo hace `pnpm --filter`, no App Runner.

**Nota revised build / `/app`:** nodejs22 usa la *revised build* (multi-stage Docker).
Copia el `SourceDirectory` a `/app` y ejecuta `build` ahí; el `run.command` corre en
`/app`. Como instalamos y compilamos todo dentro de `/app` (la raíz del repo copiada),
NO necesitamos `pre-run` (que es solo para modificar cosas FUERA de `/app`). Lo
omitimos.

`apprunner.yaml` COMPLETO y comentado (copiar a la **raíz** del repo):

```yaml
# apprunner.yaml — despliegue del backend @nach/backend en AWS App Runner.
# Vive en la RAÍZ del repo (no en backend/): el install pnpm necesita el
# pnpm-workspace.yaml y el pnpm-lock.yaml de la raíz. El SourceDirectory del
# servicio App Runner debe ser "/" (raíz).
version: 1.0

# Único runtime Node vivo en App Runner (no existe nodejs20; 18/16 están EOS).
# nodejs22 satisface engines.node ">=20" del repo. Usa la revised build.
runtime: nodejs22

build:
  commands:
    pre-build:
      # pnpm no viene en la imagen gestionada (solo npm/yarn). Se activa por
      # corepack, fijando la MISMA versión que packageManager en package.json.
      - corepack enable
      - corepack prepare pnpm@11.10.0 --activate
      # Instala SOLO lo necesario para el backend, desde el lockfile.
      # --frozen-lockfile: instala EXACTAMENTE lo del lockfile, NO resuelve
      #   versiones nuevas -> NO dispara minimumReleaseAge (la cuarentena solo
      #   aplica al RESOLVER versiones nuevas, no al instalar las ya fijadas).
      # --filter @nach/backend: solo el backend + sus deps del workspace.
      # NB: incluye devDeps del backend (typescript/tsc) porque el build las
      #   necesita para compilar. Se poda después (ver post-build).
      - pnpm install --frozen-lockfile --filter @nach/backend...
    build:
      # Compila TS -> backend/dist (tsc -p tsconfig.build.json).
      - pnpm --filter @nach/backend build
    post-build:
      # Poda devDeps para dejar solo runtime en la imagen final (opcional pero
      # recomendado: imagen más pequeña, menos superficie). Vuelve a instalar
      # solo prod desde el lockfile (tampoco dispara la cuarentena).
      - pnpm install --frozen-lockfile --filter @nach/backend --prod

run:
  # Fija major.minor.patch para builds reproducibles (evita que un patch nuevo
  # entre en un redeploy). Usa una versión existente de la tabla de releases.
  runtime-version: 22.14.0
  # Arranca el server compilado. NO usamos "pnpm start" para no depender de que
  # pnpm/corepack estén activos en la imagen de RUN: node directo es más robusto.
  # server.ts lee el puerto de env.PORT.
  command: node backend/dist/server.js
  network:
    # El backend arranca en env.PORT (default 3001). App Runner inyecta PORT.
    # Fijamos 3001 para coherencia; App Runner enruta el tráfico público (443)
    # a este puerto interno.
    port: 3001
  env:
    - name: NODE_ENV
      value: production
    # CORS_ORIGINS NO es secreto (allowlist de operador). Va como env normal.
    # dev debe permitir el front en CloudFront:
    - name: CORS_ORIGINS
      value: https://dev.garcia3apps.com
  secrets:
    # Inyectados desde SSM Parameter Store (SecureString) en runtime. value-from
    # es el NOMBRE del parámetro (mismo Region que el servicio) o su ARN completo.
    - name: MONGODB_URI
      value-from: /nach/dev/MONGODB_URI
    - name: CRYPTO_PRIVATE_KEY
      value-from: /nach/dev/CRYPTO_PRIVATE_KEY
```

Notas sobre el yaml:
- El `command` usa `node backend/dist/server.js` porque `/app` = raíz del repo
  copiada; el dist queda en `backend/dist/`.
- `pnpm start` del backend hace `node --env-file-if-exists=.env dist/server.js`. NO
  hay `.env` en prod (los secretos llegan por env de App Runner), y ese script asume
  cwd=backend/. Por eso NO usamos `pnpm start`; arrancamos con ruta absoluta al dist.
- Si prefieres no podar devDeps, borra el `post-build` (imagen algo mayor, igual de
  funcional).

### 3. Secretos desde Parameter Store (ADR 11)

- Sintaxis en `run.secrets` con `value-from` (confirmado en config-file-ref):
  ```yaml
  run:
    secrets:
      - name: MONGODB_URI
        value-from: arn:aws:ssm:REGION:ACCOUNT:parameter/nach/dev/MONGODB_URI
      - name: CRYPTO_PRIVATE_KEY
        value-from: /nach/dev/CRYPTO_PRIVATE_KEY   # nombre corto si es misma Region
  ```
  - Mismo Region → puedes usar nombre o ARN. Distinto Region → ARN completo obligado.
  - Cross-account NO soportado.
  - App Runner **solo lee los secretos en el momento del DEPLOY**. Si rotas un
    parámetro, hay que **redeploy** (`start-deployment`) para que tome el nuevo valor.
- Se puede definir en el yaml (`run.secrets`, arriba) o por consola/API/CLI. En el
  yaml es lo más reproducible.
- **IAM: instance role con `ssm:GetParameters`** (+ `kms:Decrypt` si el SecureString
  usa una KMS key propia; con la key AWS-managed por defecto de SSM suele bastar con
  GetParameters, pero incluir kms:Decrypt sobre la key correcta es lo robusto). El
  instance role se pasa en `InstanceConfiguration.InstanceRoleArn` de `create-service`
  (ver comandos abajo). Es un rol DISTINTO del "access role" (ese es para leer ECR;
  aquí no aplica porque es source-code + GitHub connection).

### 4. `minimumReleaseAge: 1440` + `--frozen-lockfile`

- **No rompe ni espera.** `minimumReleaseAge` (cuarentena de 24h) actúa cuando pnpm
  **resuelve versiones nuevas** (p.ej. `pnpm add`, o `pnpm install` sin lockfile que
  recalcula el árbol). Con **`--frozen-lockfile`** pnpm instala EXACTAMENTE lo que ya
  está en `pnpm-lock.yaml` sin re-resolver, así que **la cuarentena no se dispara**.
  Confirmado por diseño de pnpm: `--frozen-lockfile` falla si el lockfile no coincide
  con `package.json`, pero no consulta el registry para "edad de release".
- Requisito: el `pnpm-lock.yaml` debe estar **commiteado y actualizado** (lo está: el
  repo instala con `--frozen-lockfile`). Si alguien bumpea una dep sin regenerar el
  lock, el build de App Runner fallará con `ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY` —
  eso es deseable (fail-fast), no un problema de cuarentena.
- `allowBuilds: { esbuild: true }`: el backend NO instala esbuild en `--prod` (esbuild
  es devDep transitiva de tsx/vitest). En el `pre-build` con `--filter @nach/backend...`
  SÍ podría traer esbuild (por tsx en devDeps del backend); como esbuild está en la
  allowlist, su build no rompe. En el `post-build --prod` esbuild desaparece. Sin
  fricción esperada.

### 5. Health check → `GET /health`

- App Runner health check por defecto es **TCP** sobre el puerto. Para usar la ruta
  hay que ponerlo a **HTTP** con `Path=/health`
  (https://docs.aws.amazon.com/apprunner/latest/api/API_HealthCheckConfiguration.html):
  - `Protocol: HTTP` (default TCP)
  - `Path: /health` (default "/")
  - `Interval` 5s, `Timeout` 2s, `HealthyThreshold` 1, `UnhealthyThreshold` 5 (defaults).
- **No se configura en `apprunner.yaml`** (el yaml no tiene sección health check). Se
  pasa en `create-service`/`update-service` vía `--health-check-configuration` (CLI) o
  en la consola. El backend ya responde `GET /health -> 200 {status:ok}` (verificado
  en `backend/src/app.ts` y `health.controller.ts`), así que solo hay que apuntar el
  check ahí.

### 6. Runtime string Node 20

- **No existe.** Ver hallazgo B. Se usa **`nodejs22`** (`runtime: nodejs22`,
  `runtime-version: 22.14.0`). Node 22 satisface `engines.node >=20`.

### 7. CORS_ORIGINS

- **Env var normal, no secreto.** Es una allowlist de operador (no credencial); el
  propio `env.ts` la trata como "valor de operador de despliegue". Va en `run.env`:
  ```yaml
  - name: CORS_ORIGINS
    value: https://dev.garcia3apps.com
  ```
  Coma-separada si hay varios orígenes. `env.ts` la parsea con trim y descarta vacíos,
  y nunca cae a `*`. Confirmado leyendo `backend/src/config/env.ts`.

---

## Recomendación para esta feature

- **Enfoque sugerido (si la cuenta AWS ya tiene App Runner):** runtime gestionado
  `nodejs22`, `apprunner.yaml` en la RAÍZ, `SourceDirectory=/`, corepack→pnpm@11.10.0,
  `pnpm install --frozen-lockfile --filter @nach/backend...`, `pnpm --filter
  @nach/backend build`, arranque `node backend/dist/server.js` en puerto 3001,
  secretos por `run.secrets` desde SSM, CORS por `run.env`, health check HTTP `/health`
  vía CLI/consola.
- **Trampas a evitar:**
  1. `SourceDirectory=backend/` → rompe pnpm (no ve el workspace/lockfile de raíz).
     Usar raíz + `--filter`.
  2. `runtime-version: 20.x` → NO existe; conflicto de build. Usar 22.x.
  3. Fijar `engines.node` a algo que excluya 22 → conflicto que aborta el build.
  4. `pnpm start` en `run.command` → asume cwd=backend/ y `.env`; usar `node` directo.
  5. Olvidar `kms:Decrypt`/`ssm:GetParameters` en el instance role → arranque falla al
     resolver secretos.
  6. Rotar un secreto y esperar que se aplique solo → hay que redeploy.
  7. Health check TCP por defecto pasa aunque la app devuelva 500 en `/health`; poner
     HTTP + Path=/health para chequeo real.
- **Deprecaciones/avisos relevantes:**
  - App Runner CERRADO a clientes nuevos (verificar habilitación de la cuenta).
  - nodejs18/16/14/12 en End of Support (no se pueden usar en servicios nuevos).
  - `pre-run` solo en revised build (nodejs22 lo es); aquí no se necesita.

---

## Comandos AWS CLI (crear el servicio App Runner desde GitHub, rama `dev`)

Prerrequisitos: AWS CLI configurado, region elegida (ej. `us-east-1`; coincide con el
ACM de CloudFront del ADR 9, aunque App Runner puede ir en cualquier region).

### 0. Variables
```bash
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export REPO_URL=https://github.com/<owner>/<repo>   # el repo del monorepo
```

### 1. Guardar los secretos en Parameter Store (SecureString)
```bash
aws ssm put-parameter --region "$AWS_REGION" \
  --name /nach/dev/MONGODB_URI --type SecureString \
  --value 'mongodb+srv://USER:PASS@cluster-prod.xxxx.mongodb.net/nach?retryWrites=true&w=majority'

# El PEM tiene saltos de línea: pásalo desde archivo para no corromperlo.
aws ssm put-parameter --region "$AWS_REGION" \
  --name /nach/dev/CRYPTO_PRIVATE_KEY --type SecureString \
  --value "$(cat /ruta/segura/private-key.pem)"
```

### 2. Conexión a GitHub (requiere handshake manual en consola)
```bash
aws apprunner create-connection --region "$AWS_REGION" \
  --connection-name nach-github --provider-type GITHUB
# -> devuelve ConnectionArn en estado PENDING_HANDSHAKE.
# IMPORTANTE (doc oficial): "After the connection is created, you must manually
# complete the authentication handshake using the App Runner console":
#   Consola App Runner -> Connected accounts -> selecciona nach-github ->
#   Actions -> Complete handshake -> autoriza la GitHub App en el repo.
# Hasta completar el handshake, create-service fallará.
export CONNECTION_ARN=$(aws apprunner list-connections --region "$AWS_REGION" \
  --query "ConnectionSummaryList[?ConnectionName=='nach-github'].ConnectionArn" \
  --output text)
```

### 3. Instance role IAM con acceso a Parameter Store
```bash
# 3a. Trust policy: App Runner tasks asumen el rol.
cat > /tmp/apprunner-instance-trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "tasks.apprunner.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
JSON

aws iam create-role --role-name AppRunnerNachInstanceRole \
  --assume-role-policy-document file:///tmp/apprunner-instance-trust.json

# 3b. Permisos: leer los parámetros y descifrarlos.
cat > /tmp/apprunner-ssm-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParameters"],
      "Resource": [
        "arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter/nach/dev/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": ["arn:aws:kms:${AWS_REGION}:${ACCOUNT_ID}:alias/aws/ssm"]
    }
  ]
}
JSON

aws iam put-role-policy --role-name AppRunnerNachInstanceRole \
  --policy-name nach-ssm-read \
  --policy-document file:///tmp/apprunner-ssm-policy.json

export INSTANCE_ROLE_ARN=arn:aws:iam::${ACCOUNT_ID}:role/AppRunnerNachInstanceRole
```
(Si el SecureString usa la KMS key AWS-managed `alias/aws/ssm`, el bloque kms:Decrypt
de arriba basta. Si usas una CMK propia, apunta su ARN.)

### 4. Crear el servicio (source-code, rama dev, apprunner.yaml del repo)
```bash
cat > /tmp/source-config.json <<JSON
{
  "CodeRepository": {
    "RepositoryUrl": "${REPO_URL}",
    "SourceCodeVersion": { "Type": "BRANCH", "Value": "dev" },
    "SourceDirectory": "/",
    "CodeConfiguration": { "ConfigurationSource": "REPOSITORY" }
  },
  "AutoDeploymentsEnabled": true
}
JSON

aws apprunner create-service --region "$AWS_REGION" \
  --service-name nach-backend-dev \
  --source-configuration "{
    \"AuthenticationConfiguration\": { \"ConnectionArn\": \"${CONNECTION_ARN}\" },
    \"AutoDeploymentsEnabled\": true,
    \"CodeRepository\": {
      \"RepositoryUrl\": \"${REPO_URL}\",
      \"SourceCodeVersion\": { \"Type\": \"BRANCH\", \"Value\": \"dev\" },
      \"SourceDirectory\": \"/\",
      \"CodeConfiguration\": { \"ConfigurationSource\": \"REPOSITORY\" }
    }
  }" \
  --instance-configuration "{
    \"Cpu\": \"1024\", \"Memory\": \"2048\",
    \"InstanceRoleArn\": \"${INSTANCE_ROLE_ARN}\"
  }" \
  --health-check-configuration "{
    \"Protocol\": \"HTTP\", \"Path\": \"/health\",
    \"Interval\": 10, \"Timeout\": 5,
    \"HealthyThreshold\": 1, \"UnhealthyThreshold\": 5
  }"
```
Notas:
- `ConfigurationSource: REPOSITORY` → App Runner lee build/run del `apprunner.yaml`.
  Los `run.secrets`/`run.env` del yaml se aplican. (Alternativa: `API` y pasar todo por
  CLI, pero el yaml es más reproducible.)
- `AutoDeploymentsEnabled: true` → cada push a `dev` redeploya. Como
  `SourceDirectory=/`, cualquier cambio en el repo dispara deploy (incluido el front);
  si molesta, ponlo en `false` y despliega con `start-deployment`.
- El health check no cabe en el yaml; por eso va aquí.

### 5. Ver estado / URL pública / forzar deploy
```bash
export SERVICE_ARN=$(aws apprunner list-services --region "$AWS_REGION" \
  --query "ServiceSummaryList[?ServiceName=='nach-backend-dev'].ServiceArn" --output text)

aws apprunner describe-service --region "$AWS_REGION" --service-arn "$SERVICE_ARN" \
  --query "Service.{Status:Status,Url:ServiceUrl}"

# Redeploy manual (p.ej. tras rotar un secreto en SSM):
aws apprunner start-deployment --region "$AWS_REGION" --service-arn "$SERVICE_ARN"
```

### 6. Apagar tras la evaluación (ADR 9: App Runner NO es free tier)
```bash
aws apprunner delete-service --region "$AWS_REGION" --service-arn "$SERVICE_ARN"
```

---

## Network Access de MongoDB Atlas para App Runner

Problema: App Runner (sin VPC connector) **sale a Internet con IPs públicas
dinámicas de AWS**, no un rango fijo estrecho. El ADR 11 pide restringir a los rangos
de App Runner y "nunca 0.0.0.0/0". Opciones, de más a menos robusta:

1. **VPC connector + NAT Gateway con EIP fija (lo correcto para prod):**
   - Crea un `create-vpc-connector` de App Runner asociado a subredes privadas cuya
     ruta a Internet pasa por un NAT Gateway con Elastic IP fija.
   - En Atlas: Network Access → Add IP Address → añade la **EIP del NAT** (`/32`).
   - Así Atlas solo acepta esa IP. (Coste extra: NAT ~ €0.045/h + tráfico.)
   Pasos Atlas:
   - Atlas UI → Security → Network Access → **ADD IP ADDRESS** → introduce
     `<EIP-del-NAT>/32` con comentario "apprunner-dev-nat" → Confirm.
2. **Sin VPC connector (default):** las IPs de salida NO son fijas. Para esta prueba
   de vida corta, dos caminos:
   - **Aceptar `0.0.0.0/0` temporalmente en el cluster de dev** (el ADR lo desaconseja
     para prod, pero el cluster de dev es efímero y se apaga tras evaluar). Documenta
     el riesgo y bórralo al terminar.
   - Mejor compromiso barato: añadir los **CIDR publicados de AWS** para la región de
     App Runner (de `ip-ranges.json`, servicio `EC2`/`AMAZON` de esa region) — es
     amplio pero mejor que abrir a todo Internet. Alto mantenimiento; para una prueba
     no compensa frente al NAT.

Pasos Atlas comunes (independientes de la opción):
- Atlas → tu Project → **Security → Network Access → ADD IP ADDRESS**.
- El **usuario/contraseña de prod** son propios (ADR 11): Atlas → **Database Access →
  ADD NEW DATABASE USER**, rol `readWrite` sobre la BD `nach`. Esa credencial es la que
  va en el `MONGODB_URI` de Parameter Store.
- Cluster de prod **separado** del de dev (ADR 11).

Recomendación práctica para la evaluación: **VPC connector + NAT + EIP `/32`** si hay
tiempo (cumple el ADR al 100%); si no, `0.0.0.0/0` en el cluster de dev efímero,
documentado y borrado al apagar App Runner.

---

## Fallback: si App Runner NO está disponible (cuenta nueva) → contenedor

Si la cuenta AWS no tiene App Runner habilitado, App Runner queda descartado y el
`apprunner.yaml` no aplica. Camino oficial recomendado por AWS: **Amazon ECS Express
Mode** (imagen + 2 roles IAM, sin coste de control plane) o cualquier runner de
contenedores. En ese caso el artefacto es un **Dockerfile** (pnpm en Docker SÍ está
documentado por pnpm). Esbozo (NO aplicar sin decidir el pivote):

```dockerfile
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --filter @nach/backend...
COPY . .
RUN pnpm --filter @nach/backend build
RUN pnpm install --frozen-lockfile --filter @nach/backend --prod

FROM node:22-slim
WORKDIR /repo
COPY --from=build /repo .
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "backend/dist/server.js"]
```
(Los secretos y CORS se inyectan como env de la task ECS; el health check en el ALB
apunta a `/health`.)

---

## Fuentes

- https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html
  — App Runner cerrado a nuevos clientes; migración a ECS Express Mode. CRÍTICO.
- https://docs.aws.amazon.com/apprunner/latest/dg/service-source-code-nodejs.html
  — plataforma Node, ejemplos apprunner.yaml, package.json vs runtime-version.
- https://docs.aws.amazon.com/apprunner/latest/dg/service-source-code-nodejs-releases.html
  — runtimes Node soportados: solo nodejs22 vivo; 18/16/14/12 EOS. No hay nodejs20.
- https://docs.aws.amazon.com/apprunner/latest/dg/config-file-ref.html
  — schema completo del apprunner.yaml (version/runtime/build/run, secrets value-from).
- https://docs.aws.amazon.com/apprunner/latest/dg/service-source-code.html
  — source directory / monorepos; original vs revised build; /app.
- https://aws.amazon.com/blogs/containers/aws-app-runner-adds-support-for-monorepos/
  — soporte oficial de monorepos vía SourceDirectory (sep-2023).
- https://docs.aws.amazon.com/apprunner/latest/dg/env-variable.html
  — referencia de secretos SSM/Secrets Manager; se leen solo en deploy.
- https://docs.aws.amazon.com/apprunner/latest/relnotes/release-2023-01-05-secrets-paramters.html
  — release: soporte de secrets desde Secrets Manager y Parameter Store.
- https://docs.aws.amazon.com/apprunner/latest/api/API_HealthCheckConfiguration.html
  — health check: Protocol HTTP/TCP, Path, Interval/Timeout/Thresholds y defaults.
- https://docs.aws.amazon.com/apprunner/latest/dg/manage-connections.html
  — create-connection requiere handshake manual en consola antes de crear el servicio.
