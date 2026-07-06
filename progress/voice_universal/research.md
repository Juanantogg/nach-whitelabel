# Research — voice_universal (voz universal en los 4 navegadores)

> **DECISIÓN (2026-07-04, usuario):** feature EXTRA opcional (stretch), solo si sobra
> tiempo tras el core y el deploy. **Amazon Transcribe DESCARTADO** por complejidad
> (PCM crudo + proxy WebSocket + validar WS de larga duración en App Runner) y precio.
> Quedan ABIERTAS dos candidatas, a decidir SI se llega a implementar:
> **(A) Whisper vía backend** (OpenAI/Groq) y **(B) transformers.js en el navegador**
> (Whisper WASM, sin backend). El análisis de Transcribe de abajo se conserva como
> constancia de por qué se descartó. La comparativa A vs B se resolverá al arrancar
> la feature (ver `feature_list.json` → `voice_universal`).

Verificado el 2026-07-04 contra fuentes primarias de AWS (docs + blogs oficiales + npm).
Contexto: React 19 + Express 5 (App Runner), front en S3+CloudFront, secretos en Parameter Store.
Objetivo: dictar un nombre corto (≤15 chars) en español, funcionando en los 4 navegadores
(la Web Speech API nativa falla en Firefox y Brave).

## Preguntas
1. ¿Qué modalidad de Transcribe sirve para dictado interactivo? ¿Protocolo, latencia, español?
2. ¿Puede el navegador (Firefox/Brave incl.) capturar audio y hablar con Transcribe?
   ¿PCM crudo o formatos de MediaRecorder? ¿Directo o vía backend? ¿Sin credenciales en el bundle?
3. Coste real 2025-2026 y si es "apagable" como App Runner.
4. Titular de trade-offs vs Whisper / transformers.js.
5. ¿SDK oficial y ejemplos de integración desde navegador?

## Hallazgos

- **Modalidad: Streaming, no batch.** Batch = transcribir un archivo ya subido a S3; Streaming =
  audio en tiempo real. Para "hablo y aparece el texto" es **Streaming**, confirmado.
  Fuente: https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html
  y https://docs.aws.amazon.com/transcribe/latest/dg/getting-started-http-websocket.html

- **Protocolo y transporte.** Transcribe Streaming soporta **HTTP/2** y **WebSocket**. Para
  navegador AWS recomienda WebSocket (lo hace accesible a apps web/móviles). El **SDK JS v3
  abstrae el transporte** (usa HTTP/2 bajo el capó) — no gestionas el WebSocket a mano.
  Latencia: parciales en tiempo casi real (sub-segundo, resultados "partial" que se refinan a
  "final"); AWS no publica un número fijo pero es interactivo para dictado.
  Fuente: https://docs.aws.amazon.com/transcribe/latest/dg/how-streaming.html
  y https://aws.amazon.com/blogs/machine-learning/transcribe-speech-to-text-in-real-time-using-amazon-transcribe-with-websocket/

- **Español: confirmado en streaming.** La tabla oficial de idiomas lista, con "Data input =
  batch, streaming":
  - `es-ES` (España) — batch, streaming
  - `es-US` (US Spanish) — batch, streaming
  - `es-MX` (México) — batch, streaming* (streaming disponible salvo en 5 regiones: Cape Town,
    Tokyo, Malaysia, Thailand, Ningxia)
  Para el caso (nombre en español) `es-ES` o `es-US` sirven de sobra.
  Fuente: https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html

- **Captura en navegador (los 4 navegadores).** Se captura con `getUserMedia` (soportado en
  Chrome, Firefox, Safari, Edge/Brave) y se procesa con la **Web Audio API** (o la librería
  `microphone-stream`). Esto NO depende de la Web Speech API, así que **resuelve Firefox y Brave**.
  Fuente: https://aws.amazon.com/blogs/machine-learning/stream-multi-channel-audio-to-amazon-transcribe-using-the-web-audio-api/

- **Formato de audio: PCM, hay que transcodificar.** Transcribe Streaming **solo acepta PCM
  crudo** (también FLAC/Ogg-Opus en batch, pero el flujo de navegador usa PCM). `MediaRecorder`
  produce **webm/opus, que NO sirve directamente**: hay que sacar PCM de la Web Audio API
  (`AudioContext` → Float32 → Int16) o vía `microphone-stream`. `MediaEncoding: "pcm"`,
  `MediaSampleRateHertz: 16000` (calidad alta) u 8000. Chunks de 50–200 ms
  (bytes = ms/1000 * sampleRate * 2).
  Fuente: https://www.npmjs.com/package/@aws-sdk/client-transcribe-streaming (README oficial)

- **Directo vs backend — credenciales.** El navegador **puede** hablar con Transcribe directamente
  con el SDK v3, pero **necesita credenciales AWS**, que NO deben ir en el bundle. Las dos vías:
  - **(a) Cognito Identity Pool** → entrega credenciales temporales al front, que abre el stream
    directo a Transcribe. Es el patrón que AWS documenta oficialmente para apps de navegador.
    Fuente: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/transcribe-app-browser-script.html
    y https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/transcribe-app.html
  - **(b) Proxy por el backend Express** → el front envía audio PCM al backend por WebSocket; el
    backend (con rol IAM de App Runner, credenciales nunca en el cliente) reenvía a Transcribe con
    el SDK v3 y devuelve el texto. Sin Cognito.

- **SDK oficial: sí.** `@aws-sdk/client-transcribe-streaming` (AWS SDK for JavaScript v3), soporta
  navegador y Node. Comando: `StartStreamTranscriptionCommand`; respuesta iterable async
  (`TranscriptResultStream`). Hay ejemplos oficiales AWS de integración con `getUserMedia`.
  Fuentes: https://www.npmjs.com/package/@aws-sdk/client-transcribe-streaming ,
  https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/transcribe-streaming/ ,
  ejemplos: https://github.com/aws-samples/amazon-transcribe-examples

## Coste real (2025-2026)

- **Precio streaming (Tier 1):** **$0.024 / min** (mismo precio que batch en tier 1). Descuentos por
  volumen: $0.015 (250K–1M min), $0.0102 (1M–5M), $0.0078 (5M+). El español no tiene sobreprecio.
- **Cargo mínimo de 15 s por request** (audio corto se factura como 15 s). Para un nombre de ≤15
  chars, cada dictado ≈ 3–5 s → **facturado como 15 s = 0,25 min ≈ $0.006 por dictado**.
- **Free tier: 60 min/mes durante 12 meses** (cuentas nuevas), aplica a batch y streaming estándar.
  A 15 s por dictado → ~240 dictados/mes gratis el primer año. Para una demo, sobra.
- **¿Apagable como App Runner?** Transcribe es **pago por uso puro**: sin uso, coste $0. No hay
  instancia que apagar; simplemente no se invoca. Más "apagable" que App Runner (que tiene coste
  base). Riesgo de coste ≈ nulo para una prueba técnica.
  Fuentes: https://aws.amazon.com/transcribe/pricing/ , https://aws.amazon.com/pm/transcribe/

## Titular comparativo (una frase cada uno)

- **Amazon Transcribe:** encaja nativo en el stack AWS (IAM/App Runner/Parameter Store), pago por
  uso casi gratis a este volumen, pero exige transcodificar a PCM y elegir arquitectura de
  credenciales (Cognito o proxy) — nada de "plug and play".
- **Whisper (OpenAI API / Groq):** excelente precisión y muy simple (mandas audio, recibes texto),
  pero es **batch** (no streaming interactivo real por API estándar), saca datos fuera de AWS y
  añade otro proveedor/secreto — rompe la coherencia "todo AWS".
- **transformers.js (Whisper en el navegador, WebGPU/WASM):** 100% cliente, sin backend, sin coste
  por uso y sin credenciales, pero descarga de modelo pesada (decenas–cientos de MB) y latencia/
  rendimiento dependientes del dispositivo — sobredimensionado para un nombre corto.

## Recomendación para esta feature

**Sí es viable técnicamente y resuelve el problema real (Firefox/Brave) porque no depende de la
Web Speech API.** Ahora bien, para una PRUEBA TÉCNICA el coste de implementación es notable frente
al valor: hay que capturar PCM (Web Audio API), trocear chunks, gestionar el stream async y —lo más
caro— resolver credenciales.

- **Enfoque sugerido si se añade al backlog: proxy por el backend Express (opción b).**
  Encaja mejor con este stack porque:
  - El backend ya vive en **App Runner con rol IAM** → las credenciales las da el rol de la
    instancia, cero secretos en el bundle y **sin montar Cognito** (una pieza menos que la prueba
    no necesita). Coherente con "secretos vía Parameter Store, nada en el cliente".
  - Simplicidad de seguridad: el front nunca toca AWS; solo abre un WebSocket a nuestro propio
    backend y envía PCM. El backend controla el acceso (rate-limit, límite de duración).
  - Contra: el backend queda **stateful** (WebSocket de larga duración) — verificar que App Runner
    aguanta conexiones WS mantenidas; añade complejidad al servidor Express.
- **Cognito (opción a)** es el patrón "oficial de navegador" de AWS y quita carga del backend, pero
  **añade un Identity Pool** a aprovisionar y razonar (unauth role, scoping IAM) — más superficie de
  infra para una demo. Descartada como primera opción por eso, no por incorrecta.

### Trampas a evitar
- **No** intentar mandar `MediaRecorder`/webm-opus a Transcribe Streaming: solo PCM. Transcodificar
  con Web Audio API (downsample a 16 kHz + Int16).
- **Cargo mínimo de 15 s**: irrelevante en coste, pero tenerlo en cuenta si se mide "min facturados".
- **Regiones**: `es-MX` streaming NO está en 5 regiones; con `es-ES`/`es-US` no hay restricción, pero
  desplegar Transcribe en una región donde el idioma-streaming esté disponible y cercana a App Runner.
- **App Runner + WebSocket**: confirmar soporte/tiempos de conexiones WS largas antes de comprometer
  la opción proxy.
- No hay CLI para streaming; usar SDK v3 sí o sí.

### Veredicto para el leader
Feature **viable y bien soportada**, pero de **coste/beneficio dudoso para la prueba técnica**: el
requisito real (voz en los 4 navegadores) se cubre, pero introduce transcodificación PCM + WebSocket
proxy en el backend. Recomiendo añadirla al backlog como **opcional / stretch**, detrás de las
features núcleo (cifrado, contador, theming), y decidir su alcance en `design.md` (empezar por proxy
Express). Si se busca la vía de menor esfuerzo y no importa salir de AWS, Whisper batch es más simple;
si se quiere cero backend, transformers.js — pero ninguna encaja tan "todo-AWS" como Transcribe.

## Fuentes
- https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html — batch vs streaming, definición.
- https://docs.aws.amazon.com/transcribe/latest/dg/getting-started-http-websocket.html — HTTP/2 y WebSocket.
- https://docs.aws.amazon.com/transcribe/latest/dg/how-streaming.html — streaming con HTTP/2.
- https://aws.amazon.com/blogs/machine-learning/transcribe-speech-to-text-in-real-time-using-amazon-transcribe-with-websocket/ — recomendación WebSocket para navegador.
- https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html — es-ES / es-US / es-MX en streaming (tabla oficial).
- https://www.npmjs.com/package/@aws-sdk/client-transcribe-streaming — SDK v3, PCM, sample rate, chunks, getUserMedia.
- https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/transcribe-streaming/ — referencia API SDK v3.
- https://aws.amazon.com/blogs/machine-learning/stream-multi-channel-audio-to-amazon-transcribe-using-the-web-audio-api/ — captura con Web Audio API.
- https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/transcribe-app-browser-script.html — patrón Cognito Identity Pool + navegador.
- https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/transcribe-app.html — app de transcripción con usuarios autenticados.
- https://aws.amazon.com/transcribe/pricing/ y https://aws.amazon.com/pm/transcribe/ — precio $0.024/min, free tier 60 min/mes 12 meses, mínimo 15 s.
- https://github.com/aws-samples/amazon-transcribe-examples — ejemplos oficiales.

---

## Research A vs B (Whisper-backend vs transformers.js)

Verificado el 2026-07-05 contra fuentes primarias (OpenAI, Groq, HuggingFace, MDN, caniuse).
Cierra la comparativa que quedó abierta: **(A) Whisper vía backend** vs
**(B) transformers.js en el navegador**. Transcribe sigue descartado (arriba).

### Preguntas
1. OpenAI/Groq: ¿qué modelo/endpoint de transcripción hoy? ¿Aceptan `webm/opus`
   de MediaRecorder DIRECTO (sin transcodificar)? Precio 2026, español, latencia.
2. transformers.js: ¿nombre de paquete vigente? Modelo Whisper para español corto
   y tamaño real de descarga. WebGPU vs WASM en Firefox/Brave 2026. CSP/CORS del CDN.
3. Trade-off decisivo para ESTA prueba (backend + Parameter Store ya montados).

### A) Whisper vía backend

**A diferencia de Transcribe, aquí NO hay que transcodificar a PCM.** Tanto OpenAI
como Groq aceptan **`webm` directamente** en su lista de formatos → el `Blob`
`audio/webm;codecs=opus` que produce `MediaRecorder` se sube tal cual (multipart).
Esto elimina de un plumazo la Web Audio API y el troceo de chunks que hacían caro a
Transcribe. Patrón **batch simple**: graba → un `POST` multipart → texto.

- **OpenAI — modelos y endpoint (2026):** endpoint `POST /v1/audio/transcriptions`.
  Modelos vigentes: `whisper-1` (legacy, sin streaming), y los nuevos
  **`gpt-4o-transcribe`** y **`gpt-4o-mini-transcribe`** (soportan `stream=true`).
  Formatos aceptados textualmente: `mp3, mp4, mpeg, mpga, m4a, wav, webm`.
  **Límite de subida 25 MB.** Español entre los 99+ idiomas.
  Fuente: https://developers.openai.com/api/docs/guides/speech-to-text (2026).
  - **Precio 2026:** `gpt-4o-transcribe` ≈ **$0.006/min**; `gpt-4o-mini-transcribe`
    ≈ **$0.003/min** (facturado por tokens de audio: mini $1.25/1M in). Un nombre
    de ≤15 chars dura ~3-5 s → **coste por dictado prácticamente nulo (<$0.0005)**.
    Fuente: https://developers.openai.com/api/docs/pricing (2026).

- **Groq — alternativa (2026):** mismo endpoint/estilo (compatible OpenAI).
  Modelos **`whisper-large-v3`** ($0.111/hora) y **`whisper-large-v3-turbo`**
  (**$0.04/hora**, el recomendado por precio/latencia). Formatos aceptados
  textualmente: `flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm` → **también webm
  directo**. Máx. 25 MB (free) / 100 MB (dev). Español vía `language: "es"` (mejora
  precisión y latencia). **Free tier: 2.000 requests/día + 7.200 s de audio/hora**,
  facturación mínima de 10 s/request. Latencia de Groq es su sello: turbo transcribe
  clips cortos en **cientos de ms** (mucho más rápido que OpenAI).
  Fuentes: https://console.groq.com/docs/speech-to-text ,
  https://console.groq.com/docs/rate-limits ,
  https://console.groq.com/docs/model/whisper-large-v3-turbo (2026).

- **Complejidad real del endpoint Express:** BAJA. Recibir multipart (multer o
  `req` en streaming) → reenviar al SDK (`openai` o `groq-sdk`, ambos con
  `client.audio.transcriptions.create({ file, model, language: 'es' })`) →
  devolver `{ text }`. **~30-40 líneas** en un controller + una ruta. La API key
  vive en **Parameter Store** (ya montado), inyectada como env var; **nunca en el
  bundle**. Encaja con el patrón de secretos existente. Añade **una** dependencia
  y **un** endpoint al backend — nada de WebSocket, nada stateful.

### B) transformers.js en el navegador

- **Paquete vigente 2026:** el paquete oficial es **`@huggingface/transformers`**
  (sucesor de `@xenova/transformers`, que queda como legacy). Versión actual **v4**
  (v3.x fue la que introdujo WebGPU; v4 reescribe el runtime WebGPU en C++). Se usa
  con `pipeline('automatic-speech-recognition', '<modelo>')`.
  Fuentes: https://huggingface.co/blog/transformersjs-v3 ,
  https://github.com/huggingface/transformers.js/releases (2026).

- **Modelo español corto + tamaño real (cuantizado):** los modelos multilingües
  `Xenova/whisper-tiny` y `Xenova/whisper-base` soportan español (los `.en` NO).
  Tamaños cuantizados reales: **whisper-tiny ≈ 78 MB**, **whisper-base ≈ 145 MB**.
  Para un nombre corto en español, `whisper-tiny` (multilingüe) es el mínimo viable,
  pero tiny tiene precisión notablemente peor que large-v3 en nombres propios.
  Fuentes: https://huggingface.co/Xenova/whisper-base ,
  https://huggingface.co/Xenova/whisper-tiny (2026).

- **WebGPU vs WASM en Firefox/Brave 2026 — EL PUNTO CRÍTICO:**
  - Firefox habilitó WebGPU por defecto en **Windows (v142)** y **macOS Apple
    Silicon (v147)**, pero en **Linux e Intel-Mac sigue en Nightly** (Mozilla espera
    Linux "durante 2026"). Es decir, **WebGPU en Firefox NO es universal aún**:
    depende de SO. Fuentes: https://caniuse.com/webgpu ,
    https://github.com/gpuweb/gpuweb/wiki/Implementation-Status ,
    https://web.dev/blog/webgpu-supported-major-browsers (2026).
  - Brave = Chromium → WebGPU disponible como en Chrome (v113+), aunque Brave puede
    endurecer fingerprinting; el fallback WASM siempre está disponible.
  - **Consecuencia:** transformers.js corre en los 4 navegadores porque **cae a WASM**
    cuando no hay WebGPU. Pero WASM Whisper es **mucho más lento** (segundos–decenas
    de segundos para un clip corto según CPU) y el usuario de Firefox-en-Linux —justo
    uno de los navegadores que esta feature quiere arreglar— probablemente NO tendrá
    WebGPU y sufrirá la ruta WASM lenta.

- **CSP/CORS al descargar el modelo (front en CloudFront):** transformers.js
  descarga los pesos ONNX del **CDN de HuggingFace** (`huggingface.co` /
  `cdn-lfs...`). Esto exige que la **CSP del front permita `connect-src`** hacia esos
  dominios (hoy la CSP no los contempla → habría que ampliarla). El HF CDN sirve CORS
  correcto, así que la descarga en sí funciona; el riesgo es la CSP propia, no el CORS
  ajeno. Alternativa: **autoalojar el modelo en S3/CloudFront** y apuntar
  `env.remoteHost`/`env.remotePathTemplate` a nuestro bucket (evita depender del CDN de
  HF y mantiene la CSP en dominios propios), a coste de subir 78-145 MB al bucket.
  Fuente (guía de hosting/env): https://huggingface.co/docs/transformers.js/index (2026).

- **Impacto en bundle y carga inicial:** la librería es pesada (WASM + wrappers ONNX
  runtime). **Obligatorio lazy-load**: importar `@huggingface/transformers` solo al
  activar el fallback (dynamic `import()`), nunca en el bundle inicial. Aun así, la
  **primera transcripción arrastra la descarga del modelo (78-145 MB)** — se cachea en
  el navegador (Cache API/IndexedDB) para siguientes usos, pero el primer dictado en
  Firefox/Brave paga esa descarga antes de transcribir nada.

### Trade-off decisivo para ESTA prueba

| Eje | (A) Whisper-backend | (B) transformers.js |
|---|---|---|
| Infra nueva | 1 endpoint Express (ya hay backend) | 0 backend |
| Secreto | API key en Parameter Store (ya montado) | ninguno |
| Coste/uso | ~nulo (free tier Groq/OpenAI cubre una demo) | $0 |
| Transcodificar | **NO** (webm directo) | **NO** (webm directo) |
| 1ª experiencia | POST rápido (Groq: cientos de ms) | descarga 78-145 MB antes del 1er texto |
| Fiabilidad cross-browser | idéntica en los 4 (es servidor) | **desigual**: WASM lento donde no hay WebGPU (Firefox/Linux) |
| Bundle front | ~nulo (solo MediaRecorder + fetch) | librería pesada, lazy-load obligatorio |
| Complejidad | multipart→SDK→texto (~35 líneas) | WebGPU/WASM, CSP del CDN, cache de modelo |

**El factor que rompe el empate:** el objetivo de la feature es arreglar
**Firefox y Brave**. En (B), justo Firefox-en-Linux (sin WebGPU estable en 2026) cae a
WASM lento y arrastra una descarga de 78-145 MB — la peor experiencia precisamente en
el navegador que queremos rescatar. En (A) la transcripción es idéntica y rápida en los
4 navegadores porque el trabajo lo hace el servidor. Además, la prueba **ya tiene backend
en App Runner y Parameter Store**: el coste marginal de (A) es un endpoint de ~35 líneas y
una API key de entorno, exactamente el patrón que el repo ya usa para secretos. (B) no
aprovecha nada de esa infra y mete a cambio complejidad WASM/WebGPU + CSP + peso.

**Sub-decisión OpenAI vs Groq (dentro de A):** **Groq `whisper-large-v3-turbo`** es
preferible para esta demo — free tier generoso (2.000 req/día), $0.04/hora, latencia
menor y misma calidad large-v3 (mejor que tiny de B). OpenAI `gpt-4o-mini-transcribe`
es alternativa válida y ~igual de simple si ya se tiene cuenta OpenAI. Ambos aceptan
webm directo. Dejar el proveedor como detalle de `design.md`/ADR (endpoint agnóstico).

### Trampas a evitar
- **No transcodificar a PCM**: ni OpenAI ni Groq lo requieren (a diferencia de
  Transcribe). Subir el `Blob` webm/opus de MediaRecorder tal cual.
- **API key jamás en el bundle**: solo Parameter Store → env var del backend. Auditar
  en security-auditor (ya exigido por la acceptance de la feature).
- **Pasar `language: "es"`** al SDK: mejora precisión y latencia en nombres cortos.
- **Fallback, no reemplazo**: mantener Web Speech nativo en Chrome/Safari (gratis,
  instantáneo); llamar al backend solo si `isSupported=false` o `errorCode==='network'`.
- **Límite de 15 chars y clamp**: aplicar sobre el texto devuelto igual que hoy.
- Si algún día se fuera por (B): lazy-load obligatorio, ampliar CSP `connect-src` al CDN
  de HF (o autoalojar en S3), y no prometer WebGPU en Firefox/Linux.

### Veredicto para el leader
**Elegir (A) Whisper vía backend (Groq whisper-large-v3-turbo, o OpenAI gpt-4o-mini-transcribe): webm directo sin transcodificar, ~35 líneas de endpoint, API key en Parameter Store ya montado, coste ~nulo y fiabilidad idéntica en los 4 navegadores — mientras que (B) transformers.js castiga justo a Firefox/Linux (WASM lento + descarga de 78-145 MB) que es el navegador a rescatar.**

### Fuentes (A vs B)
- https://developers.openai.com/api/docs/guides/speech-to-text — modelos (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe), endpoint, formatos (incluye webm), 25 MB, español, streaming.
- https://developers.openai.com/api/docs/pricing — $0.006/min (transcribe) y $0.003/min (mini).
- https://console.groq.com/docs/speech-to-text — whisper-large-v3 / -turbo, formatos (incluye webm), precios $0.111 / $0.04 por hora, español.
- https://console.groq.com/docs/rate-limits — free tier 2.000 req/día, 7.200 s/hora.
- https://console.groq.com/docs/model/whisper-large-v3-turbo — modelo turbo, latencia.
- https://www.npmjs.com/package/@huggingface/transformers — paquete oficial vigente (sucesor de @xenova).
- https://huggingface.co/blog/transformersjs-v3 — WebGPU en transformers.js v3.
- https://github.com/huggingface/transformers.js/releases — versiones (v4 runtime WebGPU en C++).
- https://huggingface.co/Xenova/whisper-tiny y https://huggingface.co/Xenova/whisper-base — modelos multilingües y tamaños (~78 MB / ~145 MB cuantizados).
- https://caniuse.com/webgpu — soporte WebGPU: Chrome 113+, Safari 26+ parcial, Firefox NO universal en desktop.
- https://github.com/gpuweb/gpuweb/wiki/Implementation-Status y https://web.dev/blog/webgpu-supported-major-browsers — Firefox WebGPU: Windows (142), macOS Apple Silicon (147), Linux en Nightly durante 2026.
- https://huggingface.co/docs/transformers.js/index — hosting/env para autoalojar modelo y ejecutar ASR en navegador.
