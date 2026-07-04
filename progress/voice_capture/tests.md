# Tests (RED) — voice_capture

Fase **RED** del TDD. Tests escritos desde `design.md` (secciones "Estrategia de
test" y "Criterios de aceptación traducibles a tests"). NO existe aún código de
producción; los tests fallan por ausencia del módulo/símbolo, no por setup.

## Archivos

- `frontend/src/voice/useVoiceInput.test.ts` — suite del hook (nuevo).
- `frontend/src/brand/schema.test.ts` — se añade el bloque
  `describe('brandConfigSchema — bloque voice ...')` al suite existente de marca.

## Estrategia de mock

Se mockea SOLO el borde del sistema (la Web SpeechRecognition API, que jsdom no
trae), nunca la lógica bajo prueba (la máquina de estados del hook). El doble
`MockSpeechRecognition`:

- Implementa `lang`, `continuous`, `interimResults`, `maxAlternatives`,
  `start()`, `stop()`, `abort()` (espías `vi.fn`) y los handlers `onstart`,
  `onresult`, `onend`, `onerror`.
- `continuous`/`interimResults` arrancan en `true` a propósito: así el test
  verifica que el hook los fija en `false` (no un falso positivo por default).
- Expone helpers para que el test dispare eventos como el navegador:
  `emitFinalResult(t)`, `emitEnd()`, `emitError(raw)`.
- Publica `lastInstance` / `instances[]` para inspeccionar la sesión creada y
  contar instancias (idempotencia).
- Se instala en `window.SpeechRecognition` y `window.webkitSpeechRecognition` en
  `beforeEach`/`installMock` y se borra en `afterEach`/`uninstallMock` para poder
  probar el camino `unsupported`.

Runner: Vitest + `renderHook`/`act` de `@testing-library/react`, entorno jsdom
(ya configurado en `vite.config.ts`).

## Mapeo test ↔ acceptance

| Test | Acceptance (design.md) |
|---|---|
| retorno expone el contrato completo | #1 firma/retorno |
| con la API presente: isSupported true, status "idle" | #2 |
| sin la API: isSupported false, "unsupported", start/stop no-op sin lanzar | #3 |
| start() → "listening" con lang default es-ES, interimResults=false, continuous=false | #4 |
| start() con lang por opción configura ese locale | #4 (lang por opción) |
| resultado FINAL → onResult(transcript) + transcript actualizado | #5 |
| onend natural → "idle" | #6 |
| stop() ordenado: instance.stop() y tras onend → "idle" | #6 |
| not-allowed → "error", errorCode "not-allowed", onError | #7 |
| no-speech / audio-capture / network mapean a su VoiceErrorCode (it.each) | #8 |
| error desconocido → "unknown" | #8 |
| "aborted" → vuelve a "idle" sin error visible (errorCode null) | #8 |
| desde "error", start() limpia errorCode y reintenta a "listening" | #9 |
| start() idempotente: una sola instancia/sesión | #10 |
| unmount mientras escucha → abort() | #11 |
| JSON sin `voice` → BrandConfig con bloque voice completo y usable | #12 |
| voice parcial: conserva lo provisto y rellena defaults, otros bloques intactos | #12 |

Cobertura por criterio: camino feliz + al menos un caso de error/borde donde
aplica (no-soporte, aborted como no-error, reintento que limpia error,
idempotencia, cleanup en unmount, parcial de schema).

Acceptance #13 (white-label: sin literales de voz en componentes) se verifica en
el suite de `welcome_screen`, no aquí — así lo fija el diseño.

## Evidencia del RED

Comando:

```
pnpm --filter @nach/frontend exec vitest run src/voice/useVoiceInput.test.ts src/brand/schema.test.ts
```

Resultado: **2 test files failed | Tests 2 failed | 7 passed (9)**.

1. `src/voice/useVoiceInput.test.ts` — **suite falla al cargar** por la razón
   correcta (código ausente, no error de sintaxis del test):

   ```
   Error: Failed to resolve import "./useVoiceInput" from
   "src/voice/useVoiceInput.test.ts". Does the file exist?
   ```

   Todos los tests del hook quedan en rojo hasta que exista
   `frontend/src/voice/useVoiceInput.ts` (y sus tipos ambientales
   `speech-recognition.d.ts`).

2. `src/brand/schema.test.ts` — los 2 tests nuevos del bloque `voice` fallan
   porque el bloque no existe todavía:

   ```
   > un JSON sin voice produce una BrandConfig con el bloque voice completo y usable
   AssertionError: expected undefined to be defined  (config.voice)

   > conserva un valor parcial de voice y rellena el resto con los defaults del schema
   TypeError: Cannot read properties of undefined (reading 'lang')  (config.voice.lang)
   ```

   Los 7 tests preexistentes del schema de marca siguen en verde (no se rompió el
   mecanismo previo).

## Qué debe hacer el implementer para el GREEN (no lo hace el tester)

- Crear `frontend/src/voice/useVoiceInput.ts` con la firma del design y la
  máquina de estados (unsupported/idle/listening/error), mapeo de errores,
  idempotencia de `start`, cleanup con `abort()` en unmount.
- Crear `frontend/src/voice/speech-recognition.d.ts` con los tipos ambientales.
- Añadir el bloque `voice` a `frontend/src/brand/schema.ts` (`.default()` por
  campo, `.prefault({})` en el bloque) y reflejarlo en `data/default.json` y los
  seeds `seeds/shopinbaz.json` / `seeds/elektra.json`.
