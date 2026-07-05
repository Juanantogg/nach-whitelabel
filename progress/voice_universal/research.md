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
