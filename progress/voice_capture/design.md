# Design — voice_capture

## Objetivo

Diseñar el contrato de un hook React (`useVoiceInput`) que encapsule la Web
**SpeechRecognition API** para dictar el nombre **al mismo campo** que la entrada
manual. El hook expone un estado de máquina (`idle`/`listening`/`error`), la
transcripción y controles de arranque/parada. Degrada con elegancia si el
navegador no soporta la API o si el usuario deniega el permiso de micrófono.
Los textos visibles (botón, errores, ayudas) salen de `brand_config`, nunca
literales.

Alcance: **frontend puro**, sin dependencias nuevas. Se apoya en la API nativa
del navegador (regla de minimalismo: `webkitSpeechRecognition` / `SpeechRecognition`
ya la da la plataforma; no hay lib que instalar). Este hook NO renderiza UI ni
posee el estado del nombre: eso es de `welcome_screen`, que lo consume.

## Contrato / arquitectura

### Quién es dueño del estado del nombre

**El componente (`welcome_screen`) es el dueño del estado del nombre.** El hook
NO guarda el nombre. El hook produce *transcripción* y el componente decide cómo
fusionarla con lo que el usuario escribió a mano. Esto mantiene una única fuente
de verdad para el campo (evita el clásico bug de "dos estados que se pisan" entre
input manual y voz) y hace el hook testeable de forma aislada.

Patrón: **callback + estado derivado**. El hook recibe un `onResult(transcript)`
que dispara cuando hay una transcripción final; el componente hace
`setName(prev => aplicar(prev, transcript))` respetando su propio límite de 15
caracteres. El hook expone además `transcript` (última transcripción, útil para
tests y para modo controlado), pero la integración recomendada con el estado del
nombre es vía `onResult`.

> Decisión: el hook **no** trunca a 15 ni valida longitud. El límite de 15 es
> responsabilidad del componente dueño del estado (mismo límite que el input
> manual), coherente con las maquetas ("0/15 caracteres"). Así el límite se
> aplica en un solo sitio, venga el texto de donde venga.

### Firma TypeScript (contrato exacto)

```ts
/** Estados de la máquina del hook. */
export type VoiceStatus = 'unsupported' | 'idle' | 'listening' | 'error';

/** Motivo de error, normalizado desde SpeechRecognitionErrorEvent.error. */
export type VoiceErrorCode =
  | 'not-allowed'    // permiso de micrófono denegado (o bloqueado por política)
  | 'no-speech'      // no se detectó voz antes del timeout de la API
  | 'audio-capture'  // sin micrófono disponible
  | 'network'        // el servicio de reconocimiento falló por red
  | 'aborted'        // cancelado (stop/abort) — normalmente no se muestra
  | 'unknown';       // cualquier otro `error` de la API

export interface UseVoiceInputOptions {
  /**
   * Se invoca con la transcripción FINAL (isFinal) lista para fusionar con el
   * estado del nombre. El dueño del estado decide cómo aplicarla (append/replace)
   * y aplica el límite de 15. Puede llamarse varias veces en una sesión.
   */
  onResult: (transcript: string) => void;
  /**
   * Locale BCP-47 para el reconocimiento. Default 'es-ES'. Configurable por marca
   * (ver "Tokens y textos de marca"): p.ej. una marca mexicana podría querer 'es-MX'.
   */
  lang?: string;
  /**
   * Notificación opcional de error ya normalizado (para telemetría/UI extra).
   * La UI mínima puede leer `status`/`errorCode` del retorno sin este callback.
   */
  onError?: (code: VoiceErrorCode) => void;
}

export interface UseVoiceInputResult {
  /** Estado actual de la máquina. */
  status: VoiceStatus;
  /** `true` sii el navegador expone SpeechRecognition/webkitSpeechRecognition. */
  isSupported: boolean;
  /** `true` sii status === 'listening'. Azúcar para la UI. */
  isListening: boolean;
  /** Último código de error, o null si no hay error activo. */
  errorCode: VoiceErrorCode | null;
  /** Última transcripción final emitida (también llega por onResult). '' inicial. */
  transcript: string;
  /**
   * Arranca el reconocimiento. No-op si !isSupported o si ya está escuchando.
   * Al arrancar limpia errorCode y pasa a 'listening'. El prompt de permiso lo
   * dispara el navegador la primera vez.
   */
  start: () => void;
  /** Detiene el reconocimiento de forma ordenada (procesa el resultado pendiente). */
  stop: () => void;
}

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputResult;
```

### Máquina de estados (transiciones)

```
                 (no hay API en window)
   ┌─────────────────────────────────────────────┐
   │                                              ▼
 [montaje] ── API disponible ──► idle ──start()──► listening
                                  ▲   \               │
                                  │    \ start() si    │ onresult(final) ─► onResult(t); sigue listening
                                  │     \ error previo  │ onend / stop()  ─► idle
                                  │      \ limpia error  │ onerror(code)   ─► error (errorCode=code)
                                  │                      │
                                  └──────── start() ◄────┘  (desde error, reintento)
```

- **unsupported**: estado terminal salvo recarga. `start`/`stop` son no-op.
  `isSupported === false`. La UI oculta o deshabilita el botón de voz (ver abajo).
- **idle → listening**: al llamar `start()`. Se instancia el `SpeechRecognition`,
  se fija `lang`, `interimResults=false`, `continuous=false`, `maxAlternatives=1`.
- **listening → idle**: al `onend` natural o tras `stop()`.
- **listening → error**: al `onerror`; `errorCode` se normaliza. Tras un error,
  `start()` vuelve a intentar (limpia `errorCode` y vuelve a `listening`).

### Detección de soporte (feature detection)

En el efecto de montaje, una sola comprobación sin instanciar nada pesado:

```
const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
isSupported = typeof Ctor === 'function';
```

Se declaran los tipos ambientales (`window.SpeechRecognition`,
`window.webkitSpeechRecognition`, `SpeechRecognition`, `SpeechRecognitionEvent`,
`SpeechRecognitionErrorEvent`) en un `.d.ts` del frontend, porque los libs de TS
DOM no siempre los traen. Esto es andamiaje de tipos, no lógica de producto.

### Manejo de casos

| Caso | Detección | Estado resultante | UI (welcome_screen) |
|---|---|---|---|
| **Navegador sin API** | feature detection en montaje | `unsupported` | botón de voz oculto (o disabled con `aria-disabled` + texto de marca `voiceUnsupported`); el input manual sigue plenamente funcional |
| **Permiso denegado** | `onerror.error === 'not-allowed'` → `not-allowed` | `error` | mensaje de marca `voicePermissionDenied`; el usuario puede seguir escribiendo a mano |
| **Sin voz detectada** | `error === 'no-speech'` → `no-speech` | `error` | mensaje de marca `voiceNoSpeech` (o silencioso + volver a `idle`) |
| **Sin micrófono** | `error === 'audio-capture'` → `audio-capture` | `error` | mensaje de marca `voiceError` genérico |
| **Fallo de red del servicio** | `error === 'network'` → `network` | `error` | mensaje de marca `voiceError` genérico |
| **Cancelado por el usuario/stop** | `error === 'aborted'` → `aborted` | vuelve a `idle` (no se muestra error) | ninguna |
| **Otro** | resto de `error` → `unknown` | `error` | `voiceError` genérico |

**Degradación elegante = principio transversal:** en TODOS los fallos la entrada
manual queda intacta. La voz es aditiva; nunca bloquea el flujo. El botón de voz
solo se pinta cuando `isSupported`.

### Idioma (locale)

Default **`es-ES`** (app en español). Es **configurable por marca** vía
`brand_config.voice.lang` para no reabrir la decisión si una marca opera en otra
región (`es-MX`, etc.). El componente resuelve el orden:
`options.lang` (explícito) → `brand.voice.lang` → `'es-ES'`. El hook solo conoce
`options.lang`; la lectura de la marca la hace el componente al construir las
opciones. Así el hook queda puro y sin dependencia de `useBrand`.

### Ciclo de vida y limpieza

- El hook instancia un `SpeechRecognition` **por sesión de escucha** (en `start`),
  y lo referencia en un `useRef` para poder `stop()`/`abort()`.
- **Cleanup en `unmount`**: si está escuchando, `abort()` para no dejar el
  micrófono abierto ni callbacks colgando (evita `act`-warnings y fugas en tests).
- `start()` es **idempotente**: si ya está en `listening`, no crea otra instancia.

## Tokens y textos de marca (si hay UI)

El hook no pinta nada, pero define los textos que `welcome_screen` mostrará. Hay
que **extender el schema Zod** de marca con un bloque `voice`. **Esto es un
cambio de contrato: el tester y el implementer deben añadir el bloque a
`frontend/src/brand/schema.ts` (con `.default()` por campo y `.prefault({})` en
el bloque), y reflejarlo en `data/default.json` y en los seeds
`seeds/shopinbaz.json` / `seeds/elektra.json`.** Sin esto, `useBrand().voice`
no existe.

Bloque nuevo propuesto (todos con `.default()`; textos en español neutro para el
`default.json`):

```ts
voice: z
  .object({
    // Etiqueta accesible del botón de dictado (aria-label / tooltip)
    startLabel: z.string().default('Dictar mi nombre'),
    // Etiqueta mientras escucha (para toggle del botón)
    listeningLabel: z.string().default('Escuchando…'),
    // Errores mostrables (mapa 1:1 con VoiceErrorCode que la UI decide enseñar)
    permissionDenied: z
      .string()
      .default('No pudimos usar el micrófono. Revisa los permisos o escribe tu nombre.'),
    noSpeech: z.string().default('No te escuchamos. Inténtalo de nuevo o escribe tu nombre.'),
    genericError: z.string().default('Hubo un problema con el dictado. Escribe tu nombre.'),
    // Texto/aria cuando el navegador no soporta la API (botón oculto o disabled)
    unsupported: z.string().default('El dictado por voz no está disponible en este navegador.'),
    // Locale BCP-47 del reconocimiento
    lang: z.string().default('es-ES'),
  })
  .prefault({}),
```

Reglas white-label que respeta el diseño:
- **Cero textos hardcoded**: todos los labels/errores de voz vienen de
  `brand.voice.*`. El componente no escribe strings literales.
- **Cero colores literales**: el botón de voz usa tokens existentes
  (`bg-brand-primary`, `text-brand-text`, `text-brand-muted` para el estado
  disabled/unsupported, `ring-brand-accent` para el pulso de "listening"). No se
  introduce ningún hex ni color nuevo; se reutiliza el set de tokens ya inyectado
  por `ThemeProvider`. Si el pulso de escucha necesitara un color, es
  `--brand-accent` ya existente.
- **Añadir una marca sigue siendo un JSON**: el bloque `voice` se rellena por
  defaults, así que una marca que no lo declare queda usable igual.

> Nota de maqueta: los mockups de `docs/images/` NO muestran botón de micrófono,
> pero el enunciado y `feature_list.json` exigen dictado de voz. La ubicación
> visual concreta del botón (dentro del input, a su derecha) se cierra en el
> diseño de `welcome_screen`; aquí solo se fija que sus textos y colores salen de
> marca y que se oculta cuando `!isSupported`.

## Alternativas consideradas (media)

**A. Hook dueño del estado del nombre (`value`/`setValue` dentro del hook).**
El hook expondría el nombre completo y lo mutaría con la voz. Rechazada: crea
dos fuentes de verdad (input manual vs hook), obliga a sincronizar en ambos
sentidos y complica aplicar el límite de 15 en un solo lugar. Acopla el hook al
campo concreto.

**B. Hook con `onResult` callback + estado derivado (RECOMENDADA).** El
componente es dueño del nombre; el hook emite transcripciones y expone
`status`/`errorCode`/`transcript`/`start`/`stop`. Una sola fuente de verdad, hook
puro y aislable, límite de 15 aplicado en el componente igual que el input
manual. Testeable sin renderizar la pantalla.

**C. Componente `<VoiceButton>` con toda la lógica dentro (sin hook).** Rechazada:
el acceptance pide explícitamente un **hook** que encapsule la API y sea testeable
de forma aislada; además mezclaría render + lógica de reconocimiento, dificultando
el mock. La UI del botón vive en `welcome_screen` consumiendo el hook.

**D. `interimResults=true` (transcripción parcial en vivo).** Descartada para el
MVP: añade parpadeo en el campo y complica el merge con el texto manual y el
límite de 15. Se emite solo el resultado **final**. Queda como mejora futura si
`welcome_screen` la pide; no cambia la firma pública (`transcript`/`onResult`).

## Recomendación

Alternativa **B**: `useVoiceInput({ onResult, lang?, onError? })` que devuelve
`{ status, isSupported, isListening, errorCode, transcript, start, stop }`.
El componente `welcome_screen` posee el estado del nombre y, en `onResult`, hace
el merge respetando el límite de 15. `lang` se resuelve
`options.lang → brand.voice.lang → 'es-ES'`. Extender el schema Zod con el bloque
`voice` (textos + `lang`) es prerequisito de esta feature.

## Estrategia de test (API mockeada — para el tester, RED antes de implementar)

Entorno: **jsdom** (ya configurado, `vite.config.ts` → `environment: 'jsdom'`,
`setupFiles: './src/test/setup.ts'`). jsdom NO trae SpeechRecognition, así que se
mockea íntegramente. Usar `renderHook` de `@testing-library/react` (ya instalado)
y `act` para las transiciones.

### Qué mockear

1. **Un `MockSpeechRecognition`** (clase controlable) que implemente:
   `lang`, `continuous`, `interimResults`, `maxAlternatives`, `start()`,
   `stop()`, `abort()`, y los handlers `onstart`, `onresult`, `onend`, `onerror`.
   Sus métodos guardan llamadas y permiten al test **disparar eventos a mano**
   (p.ej. `instance.onresult(fakeEvent)`).
2. Asignar el ctor a `window.SpeechRecognition` (y/o `window.webkitSpeechRecognition`)
   en `beforeEach`; borrarlo en `afterEach` para poder testear el camino
   `unsupported`.
3. Fábricas de eventos:
   - **result final**: objeto con
     `{ resultIndex: 0, results: [[{ transcript: 'Ana', confidence: 0.9 }]] }`
     donde `results[0].isFinal === true` y `results[0][0].transcript` = texto.
   - **error**: `{ error: 'not-allowed' }`, `{ error: 'no-speech' }`,
     `{ error: 'network' }`, `{ error: 'aborted' }`, `{ error: 'xyz' }`.

### Qué eventos simular / casos de test

- **Soporte detectado**: con el ctor presente, `isSupported === true`,
  `status === 'idle'` tras montar.
- **No soporte**: sin ctor en `window`, `isSupported === false`,
  `status === 'unsupported'`; `start()` es no-op (no instancia nada, no lanza).
- **start() → listening**: `start()` pone `status === 'listening'`,
  `isListening === true`, y llama a `instance.start()` con `lang` = el pasado (o
  `'es-ES'` por defecto), `interimResults === false`, `continuous === false`.
- **Resultado final → onResult**: disparar `onresult` con transcript `'Ana'`
  llama `onResult('Ana')` y actualiza `transcript` a `'Ana'`. (Verifica también
  la extracción correcta de `results[i][0].transcript`.)
- **onend → idle**: disparar `onend` devuelve a `status === 'idle'`.
- **stop() ordenado**: `stop()` llama `instance.stop()`; tras el `onend`
  simulado, `status === 'idle'`.
- **Permiso denegado**: `onerror({error:'not-allowed'})` → `status === 'error'`,
  `errorCode === 'not-allowed'`, y `onError('not-allowed')` si se pasó.
- **no-speech / network / unknown**: cada `onerror` mapea al `VoiceErrorCode`
  esperado y deja `status === 'error'`.
- **aborted**: `onerror({error:'aborted'})` NO deja error visible → vuelve a
  `idle`, `errorCode === null`.
- **Reintento tras error**: desde `error`, `start()` limpia `errorCode` (→ null)
  y pasa a `listening`.
- **Idempotencia**: llamar `start()` dos veces seguidas instancia una sola vez /
  no crea una segunda sesión.
- **lang por opción**: `useVoiceInput({..., lang:'es-MX'})` → `instance.lang === 'es-MX'`.
- **Cleanup en unmount**: `unmount()` mientras escucha llama `instance.abort()`.

Convención de archivos (espejo del repo): hook en
`frontend/src/voice/useVoiceInput.ts` + tipos ambientales en
`frontend/src/voice/speech-recognition.d.ts`; tests en
`frontend/src/voice/useVoiceInput.test.ts`. (El tester fija la ruta definitiva;
el patrón `src/<dominio>/*` es el ya usado por `brand/` y `crypto/`.)

## Criterios de aceptación traducibles a tests

1. `useVoiceInput` existe y devuelve `{ status, isSupported, isListening,
   errorCode, transcript, start, stop }` con los tipos de la firma.
2. Con la API presente (mock), `isSupported === true` y `status` inicial `'idle'`.
3. Sin la API en `window`, `isSupported === false`, `status === 'unsupported'`,
   `start()`/`stop()` son no-op y no lanzan.
4. `start()` pasa a `'listening'` y arranca el reconocimiento con `lang`
   resuelto (default `'es-ES'`), `interimResults=false`, `continuous=false`.
5. Un resultado **final** invoca `onResult(transcript)` y actualiza `transcript`.
6. `onend`/`stop()` devuelven a `'idle'`.
7. `onerror('not-allowed')` → `status='error'`, `errorCode='not-allowed'`,
   `onError('not-allowed')`; la entrada manual no se ve afectada.
8. Los códigos `no-speech`/`audio-capture`/`network`/otros mapean a su
   `VoiceErrorCode`; `aborted` vuelve a `idle` sin error visible.
9. Desde `error`, `start()` limpia `errorCode` y reintenta.
10. `start()` es idempotente (una sola instancia por sesión).
11. `unmount` en `listening` aborta el reconocimiento (sin fugas).
12. **Contrato de marca**: el schema Zod tiene bloque `voice` con `.default()` por
    campo; un JSON sin `voice` produce una `BrandConfig` usable con los textos por
    defecto (test de schema, en el suite de `brand`).
13. **White-label**: ningún texto ni color de voz literal en componentes; los
    textos vienen de `brand.voice.*` y los colores de tokens `brand-*` existentes
    (se verifica en el suite de `welcome_screen`, no aquí, pero el diseño lo fija).
