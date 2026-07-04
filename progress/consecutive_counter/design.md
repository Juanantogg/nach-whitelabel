# Design — consecutive_counter

## Objetivo

Reemplazar el `stubCounter` en memoria del controller por un **consecutivo real
persistido en Mongo** (Mongoose), generado en la capa de **services**, sin tocar
la lógica de cifrado (`crypto.service.ts`) ni romper el round-trip existente. En
paralelo, endurecer dos flancos de seguridad exigidos por la acceptance:

1. **Validación fail-fast del entorno con Zod al boot** (`MONGODB_URI` requerida,
   `CRYPTO_PRIVATE_KEY` PEM válida) — hoy `env.ts` usa `?? ''` y arranca en estado
   inseguro (`docs/seguridad.md` §1).
2. **Validación de longitud del nombre ≤ 15** con falla-cerrado (400) — el límite
   de las maquetas aplicado también en el servidor (`docs/seguridad.md` §5).

El diseño mira ya a la feature futura `records_list`: persistimos **un registro
por petición** (nombre + número), no solo un contador, para que ese listado tenga
de dónde leer sin rediseñar el modelo.

---

## Contrato / arquitectura

### Reparto por capas (respeta `routes → controllers → services`)

```
POST /names
  routes/names.routes.ts        → ya existe, no cambia
  controllers/crypto.controller.ts
      parsePayload (400)                     ← ya existe
      privateKeyIsLoadable (500)             ← ya existe
      unwrapSessionKey + decryptName (422)   ← ya existe, crypto.service intacto
      validación longitud ≤ 15 (400)         ← NUEVO (reemplaza el techo de 256)
      counter.service.createRecord(name)     ← NUEVO (services, async, persiste)
      encryptForClient(String(numero), key)  ← ya existe, crypto.service intacto
  services/counter.service.ts   → NUEVO
  models/record.model.ts        → NUEVO (Mongoose)
```

El controller pasa de síncrono a **async** (necesita `await` del service que
persiste). El resto del flujo de cifrado se mantiene byte a byte.

### Modelo Mongoose — decisión: contador atómico dedicado + registro

Se usan **dos colecciones**, no una:

**1. `counters` — secuencia atómica (fuente de verdad del número, sin huecos ni
colisiones).**

```
counters {
  _id: string        // nombre lógico de la secuencia, p.ej. "records"
  seq: number        // último valor entregado
}
```

El siguiente número se obtiene con un **`findOneAndUpdate` atómico**:

```
Counter.findOneAndUpdate(
  { _id: 'records' },
  { $inc: { seq: 1 } },
  { new: true, upsert: true, setDefaultsOnInsert: true }
)  // → devuelve el documento con seq ya incrementado
```

Por qué este patrón (y no `countDocuments()` + 1):

- **`$inc` es atómico a nivel de documento en MongoDB**: dos peticiones
  concurrentes nunca leen el mismo `seq`. El servidor serializa las
  actualizaciones sobre el mismo `_id`. → **sin colisiones**.
- `upsert: true` crea la secuencia en el primer uso (arranque en frío) sin código
  de seed. El primer número entregado es **1**.
- **`countDocuments() + 1` es una race condition de manual**: dos peticiones
  concurrentes cuentan lo mismo (N) y ambas asignan N+1 → colisión. Además, si en
  el futuro se borrara un registro, la cuenta bajaría y se **reutilizarían
  números** (huecos/duplicados). Descartado.
- El acceptance "sin colisiones ni huecos por diseño razonable" se cumple
  literalmente: el número es una secuencia monótona entregada de forma atómica.

**2. `records` — evidencia persistida (nombre + número) para `records_list`.**

```
records {
  _id: ObjectId          // auto
  sequence: number       // el consecutivo entregado (index único)
  name: string           // nombre en claro, ya descifrado; maxlength 15
  createdAt / updatedAt  // timestamps de Mongoose
}
```

- `sequence` con **índice único** (`unique: true`): red de seguridad extra contra
  cualquier colisión (si por lo que fuera se intentara insertar un `sequence`
  repetido, Mongo lanza y el controller responde 500, nunca entrega un duplicado
  silencioso).
- `name` con `maxlength: 15` a nivel de schema: doble muro con la validación del
  controller (defensa en profundidad; el schema no confía en que el controller
  siempre valide).
- **Privacidad (`records_list` / seguridad §):** se persiste el nombre en claro
  porque es el dato que la feature de listado mostrará y no es un secreto (es un
  alias que el propio usuario teclea, límite 15 chars, sin PII sensible). NO se
  persiste ningún material criptográfico (ni clave de sesión, ni ciphertext, ni
  IV): esos son efímeros por petición. Esta decisión de privacidad se revalida
  cuando se diseñe `records_list`.

Ambos modelos en `backend/src/models/`. Se registran con
`mongoose.model(...)`; los tests que corren sobre `createApp()` **no** los tocan
(ver sección de tests: el service se mockea, no hay Mongo real en los tests de
endpoint).

### Capa de services — firma exacta

`backend/src/services/counter.service.ts`:

```ts
/** Reserva el siguiente consecutivo (atómico) y persiste el registro. Devuelve el número. */
export async function createRecord(name: string): Promise<number>
```

- **Entrada:** `name` — nombre YA descifrado y YA validado (≤ 15) por el
  controller. El service no descifra ni revalida longitud de negocio (el schema
  Mongoose es su red, no su validación primaria).
- **Salida:** `Promise<number>` — el consecutivo asignado a este registro.
- **Async:** sí. Internamente: (1) `findOneAndUpdate` atómico sobre `counters`
  para obtener `seq`; (2) `Record.create({ sequence: seq, name })`; (3) `return seq`.
- **Errores:** cualquier fallo de Mongo (conexión caída, violación de índice
  único) se **propaga** (throw). El controller lo captura y responde 500
  `internal_error`, sin filtrar detalle. No se traga el error ni se entrega un
  número no persistido.
- **Sin `any`.** Tipos derivados del modelo Mongoose.

Nota de diseño: el número se **reserva primero** (contador) y luego se persiste el
registro. Si `Record.create` fallara tras incrementar el contador, ese número
queda "gastado" (hueco), pero **nunca se reutiliza ni colisiona** — que es la
garantía que pide el acceptance. Un hueco por fallo de escritura es aceptable y
preferible a arriesgar una colisión; "sin huecos por diseño razonable" se refiere
al camino feliz y a la concurrencia, no a fallos de infraestructura.

### Integración en el controller (reemplazo del stub)

Diff conceptual sobre `postName` (hoy síncrono, pasa a `async`):

- **Se elimina:** `let stubCounter = 0;` y `stubCounter += 1;`.
- **Se cambia** el techo `name.length > 256` → validación de negocio
  `name.length > 15` → `400 { error: 'invalid_payload' }` (mismo código y forma
  que el resto de rechazos 400, no rompe el contrato de respuesta).
- **Se añade:** tras validar longitud,
  ```ts
  let numero: number;
  try {
    numero = await createRecord(name);
  } catch {
    res.status(500).json({ error: 'internal_error' });
    return;
  }
  const envelope = encryptForClient(String(numero), sessionKey);
  res.status(200).json(envelope);
  ```
- El resto (parsePayload 400, privateKeyIsLoadable 500, decrypt 422, forma del
  `envelope` de vuelta) **no cambia**. Los tests existentes de `crypto.routes.test.ts`
  siguen verdes: el round-trip devuelve un `ciphertext` que descifra a `/^\d+$/`
  (ahora un consecutivo real en vez del stub), y el service se mockea en esos tests
  para no exigir Mongo.

> **Punto crítico para el tester:** los tests de endpoint que hoy existen NO
> arrancan Mongo. Para que sigan pasando y para testear la secuencia sin infra, el
> `counter.service` debe mockearse (`vi.mock('../services/counter.service.js')`).
> El controller debe importar el service por su ruta de módulo para que el mock
> intercepte. La verificación de que el `$inc` es realmente atómico contra Mongo es
> un test de integración opcional (mongodb-memory-server), NO obligatorio para el
> GREEN — el acceptance se satisface con el mock devolviendo una secuencia y con la
> revisión del patrón `findOneAndUpdate/$inc`.

### Validación de entorno con Zod (fail-fast al boot)

**Dependencia nueva:** `zod` no está en `backend/package.json` (hoy solo lo usa el
front). La acceptance nombra Zod explícitamente, así que la elección de librería
ya está decidida por el backlog aprobado; el implementer debe **añadir `zod` a las
deps del backend** (`pnpm --filter @nach/backend add zod`). No introduzco ninguna
otra dependencia.

Forma del schema (`backend/src/config/env.ts`):

```ts
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI debe ser una URI mongo válida'),
  CRYPTO_PRIVATE_KEY: z.string().refine(loadsAsPem, 'CRYPTO_PRIVATE_KEY debe ser un PEM PKCS#8 cargable'),
});
```

donde `loadsAsPem(v)` intenta `crypto.createPrivateKey(v)` y devuelve `false` si
lanza (valida de verdad la clave, no solo que empiece por `-----BEGIN`).

**El punto delicado: no romper los tests existentes.** Tres tests cargan `env`
hoy SIN `MONGODB_URI` ni una `CRYPTO_PRIVATE_KEY` válida:
`config/env.test.ts`, `app.test.ts`, `crypto.routes.test.ts` (este último sí
inyecta `CRYPTO_PRIVATE_KEY` por bloque, pero NO `MONGODB_URI`, y en un bloque la
inyecta inválida a propósito). Por tanto:

- **La validación fail-fast (que hace `process.exit(1)`) vive SOLO en el arranque
  del proceso (`server.ts`), NO en la evaluación del módulo `env.ts`.** El módulo
  `env.ts` sigue exportando un objeto `env` derivado de `process.env` **sin
  abortar** al importarse — así `import { env }` no mata el runner de tests.
- Se expone una función pura y testeable, p.ej.
  `export function validateEnv(source = process.env): EnvResult` que devuelve
  `{ success, data | error }` (o lanza un `ZodError` capturable). `server.ts` la
  llama al inicio de `bootstrap()`; si falla, loguea el detalle y `process.exit(1)`
  **antes** de `connectDb()` / `listen()`.
- **Compatibilidad del objeto `env` existente:** se mantiene la forma actual
  (`env.port`, `env.nodeEnv`, `env.mongodbUri`, `env.cryptoPrivateKey`) para no
  romper `env.test.ts` (que comprueba que existe `cryptoPrivateKey` y no
  `cryptoSecret`) ni los consumidores. La novedad es la **función de validación**,
  no un cambio de forma del objeto. `env.cryptoPrivateKey` puede seguir siendo
  `?? ''` en el objeto de conveniencia; la garantía fuerte la da `validateEnv` en
  el boot.

Esto satisface el acceptance ("aborta el arranque en vez de fallar tarde") sin
tocar el estado que los tests actuales asumen. `app.ts` (y por tanto Supertest)
**nunca** invoca `validateEnv`: la app se construye igual, la validación es del
proceso.

### Validación de payload / longitud ≤ 15

- **Dónde:** en el controller, **tras descifrar** (`decryptName`), antes de llamar
  al service. El límite de 15 es del nombre **en claro**; el payload que llega está
  cifrado, así que la longitud real solo se conoce tras el descifrado. El front NO
  envía la longitud (sería un dato no confiable y redundante: se validaría de todas
  formas tras descifrar). Validar tras descifrar es lo más simple y lo más seguro
  (el servidor no confía en un metadato del cliente).
- **Qué se rechaza:** `name.length > 15` (conteo de code units de JS, consistente
  con el contador del front que también cuenta `.length`).
- **Código:** `400 { error: 'invalid_payload' }` (falla-cerrado, misma forma que
  los otros 400). El descifrado ya ocurrió (coste asumido: hay que descifrar para
  conocer la longitud), pero NO se persiste ni se genera consecutivo para un nombre
  inválido.
- **Defensa en profundidad:** el `maxlength: 15` del schema Mongoose es la segunda
  barrera si algún camino futuro saltara el controller.
- Se **elimina** el techo de 256 actual: 15 es más estricto y lo subsume.

---

## Alternativas consideradas

### A) Generación del consecutivo

1. **Contador atómico dedicado (`$inc` + upsert)** — *recomendada*. Atómico,
   sin colisiones bajo concurrencia, O(1), sobrevive reinicios, inmune a borrados.
2. **`countDocuments() + 1`** — descartada. Race condition clásica bajo
   concurrencia; reutiliza números si se borran registros. Simple pero incorrecta.
3. **`ObjectId` / timestamp como "número"** — descartada. No es un consecutivo
   legible ni monótono simple; el enunciado y las maquetas piden un número
   consecutivo de verdad.

### B) Dónde validar la longitud ≤ 15

1. **Tras descifrar, en el controller** — *recomendada*. El servidor no confía en
   metadatos del cliente; la longitud real solo existe tras descifrar. + `maxlength`
   en el schema como red.
2. **El front envía la longitud en el payload** — descartada. Dato no confiable y
   redundante; habría que revalidar igual tras descifrar. Superficie de ataque sin
   beneficio.

### C) Persistencia: ¿solo contador o contador + registro?

1. **Contador + colección `records`** — *recomendada*. `records_list`
   (feature futura, `depends_on: consecutive_counter`) necesita leer nombre+número;
   diseñar ya el registro evita rediseñar el modelo después. Coste marginal.
2. **Solo el contador** — descartada. Cumpliría el acceptance de esta feature pero
   dejaría a `records_list` sin fuente de datos, forzando un rediseño.

### D) Dónde vive el fail-fast de env

1. **`validateEnv()` pura + `process.exit(1)` solo en `server.ts`** —
   *recomendada*. Aborta el proceso real, no rompe los tests que importan `env`
   ni `app.ts`.
2. **Validar y lanzar en el cuerpo de `env.ts` al importarse** — descartada.
   Mataría el runner de Vitest (los tests importan `env` sin `MONGODB_URI`).

---

## Recomendación

- **Consecutivo:** contador atómico dedicado (`Counter.findOneAndUpdate` con
  `$inc`, `upsert`) como fuente del número; colección `records` (nombre + sequence,
  `sequence` único, `name` maxlength 15) como evidencia persistida para
  `records_list`.
- **Service:** `createRecord(name: string): Promise<number>` en
  `services/counter.service.ts`; reserva el número y persiste el registro.
- **Controller:** `postName` pasa a `async`, sustituye el stub por
  `await createRecord(name)`, valida `name.length > 15 → 400`, y mapea fallos de
  persistencia a `500 internal_error`. Cifrado intacto.
- **Env:** añadir `zod` al backend; `validateEnv()` pura + `process.exit(1)` en
  `server.ts`; forma del objeto `env` sin cambios para no romper tests.

---

## Tokens y textos de marca

No aplica: feature de backend puro, sin UI.

---

## Criterios de aceptación traducibles a tests (para el tester — RED)

### Grupo 1 — Secuencia del consecutivo (Supertest sobre `createApp()`, service mockeado)

1. **Dos peticiones válidas consecutivas devuelven números crecientes.** Mockear
   `counter.service.createRecord` para que devuelva 1 y luego 2; hacer dos
   `POST /names` válidos; descifrar cada respuesta y comprobar que el primer número
   < segundo número (y que ambos son `/^\d+$/`). RED: hoy el stub en memoria es
   compartido/global; el test debe verificar que el número proviene del service (el
   mock fue invocado con el nombre descifrado).
2. **El controller invoca el service con el nombre YA descifrado.** `POST /names`
   con "Sofía" cifrado → el mock de `createRecord` fue llamado con `'Sofía'`. RED:
   hoy no existe el service, no se invoca.
3. **El round-trip sigue devolviendo un número que el front descifra**
   (regresión de `crypto.routes.test.ts`): `POST /names` válido → 200, `iv` de la
   vuelta ≠ `iv` de la ida, y `decryptReturnAsFront(...)` da `/^\d+$/`. Debe seguir
   verde tras el cambio.
4. **Fallo de persistencia → 500 `internal_error`.** Mockear `createRecord` para
   que lance; `POST /names` válido → `res.status === 500`,
   `res.body.error === 'internal_error'`. RED: hoy el stub nunca falla → 200.

### Grupo 2 — Validación de longitud ≤ 15 (Supertest, falla-cerrado)

5. **Nombre descifrado de 16 caracteres → 400 `invalid_payload`.** Cifrar un
   nombre de 16 chars con la pública de test, `POST /names` → `res.status === 400`,
   `error === 'invalid_payload'`. Verificar además que el service **no** fue
   invocado (falla-cerrado: no persiste). RED: hoy el techo es 256, un nombre de 16
   pasa y devuelve 200.
6. **Nombre descifrado de exactamente 15 caracteres → 200.** Límite inclusivo (las
   maquetas: "0/15"). RED/regresión.
7. *(Ya cubierto por los tests existentes, deben seguir verdes)*: payload
   incompleto / no base64 → 400; tag manipulado / clave ajena → 422; privada de
   env inválida → 500 `crypto_unavailable`.

### Grupo 3 — Validación de entorno con Zod (unit sobre `validateEnv`)

8. **`validateEnv` con `MONGODB_URI` ausente → resultado inválido / lanza.**
   Sin `MONGODB_URI` en el source → falla. RED: hoy `env` usa `?? ''` y no valida.
9. **`validateEnv` con `MONGODB_URI` que no empieza por `mongodb://` /
   `mongodb+srv://` → inválido.**
10. **`validateEnv` con `CRYPTO_PRIVATE_KEY` no-PEM ("clave-basura") → inválido**
    (la validación intenta cargar la clave, no solo mira el prefijo).
11. **`validateEnv` con `MONGODB_URI` válida + `CRYPTO_PRIVATE_KEY` PEM válida
    (de `generateTestKeyPair`) → válido**, y expone `port` con default 3001 cuando
    `PORT` no está.
12. **La importación de `env.ts` NO aborta el proceso** aunque falten variables
    (garantiza que los tests que hacen `import { env }` sin `MONGODB_URI` siguen
    ejecutando). Se testea implícitamente porque todos los demás tests siguen
    corriendo; opcionalmente, un test que importe `env` sin variables y no explote.

### Regresión obligatoria

13. `config/env.test.ts` (env expone `cryptoPrivateKey`, no `cryptoSecret`),
    `app.test.ts` (health 200) y `crypto.routes.test.ts` completo **siguen verdes**
    tras todos los cambios. El implementer no los modifica.

> Nota para el tester sobre Mongo: los tests de endpoint mockean
> `counter.service` (no arrancan Mongo). Un test de integración del `$inc`
> atómico con `mongodb-memory-server` es **opcional** y no bloquea el GREEN; si se
> añade, va en su propio archivo y no en la suite de endpoints.
