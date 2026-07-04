# Review — voice_capture

**Veredicto:** APPROVED

Fase REFACTOR. El hook `useVoiceInput`, sus tipos ambientales y el bloque `voice`
del schema cumplen el contrato del `design.md`, respetan AGENTS.md/CLAUDE.md y
`./init.sh full` pasa en verde (deps + lint + typecheck + test + build + smoke).
Los dos cambios de configuración del implementer (eslint.config.js, tsconfig.test.json)
están justificados, son localizados y NO enmascaran ningún problema de producción.

## Checklist
- TDD: [x] — RED real (tests.md documenta el fallo por import ausente y por
  `config.voice` undefined) → GREEN sin relajar los tests. La implementación es la
  mínima razonable: máquina de estados directa, sin abstracción de más, sin lib
  añadida (usa la API nativa `SpeechRecognition`, como manda el minimalismo).
- White-label: [x] — El hook no pinta UI ni introduce literales. Los textos de voz
  viven en `brand.voice.*` con `.default()` por campo y `.prefault({})` en el
  bloque (patrón idéntico al resto del schema). JSON válidos y coherentes:
  `elektra` usa `es-MX`, `default`/`shopinbaz` usan `es-ES`. Cero hex/colores.
- Backend: [x] — N/A (feature frontend pura).
- Calidad: [x] — `lint` (0 errores), `typecheck` limpio, `test` 71/71 verde,
  `build` OK. Sin `any` ni `console.log` en producción. Sin dependencias nuevas.
  No reimplementa nada existente; reutiliza el patrón de schema y la API del navegador.

## Verificación del contrato (design.md)

- Firma exacta (`VoiceStatus`, `VoiceErrorCode`, `UseVoiceInputOptions`,
  `UseVoiceInputResult`) reproducida 1:1.
- Estados unsupported/idle/listening/error correctos. `isListening` derivado de
  `status === 'listening'`.
- Mapeo de errores 1:1 con caída a `unknown`; `aborted` vuelve a `idle` sin error
  visible (no invoca `onError`) — correcto según design.
- Idempotencia de `start()`: guardia `if (recognitionRef.current) return`.
- Reintento desde `error`: `onerror` nulea el ref, así la guardia no bloquea el
  reintento; `start()` limpia `errorCode` y pasa a `listening`. Correcto.
- `onend` NO pisa un error: `setStatus(prev => prev === 'error' ? prev : 'idle')`.
  Detalle bien resuelto (evita que un `onend` post-error borre el estado de error).
- Cleanup en unmount: efecto con `abort()` + nulear ref. Sin fugas.
- Refs para onResult/onError/lang sincronizadas en un efecto sin deps: los handlers
  leen valores frescos sin recrear la sesión. Sin bug de closure obsoleto.
- `lang` resuelto: el hook conoce solo `options.lang` (default 'es-ES'); la lectura
  de `brand.voice.lang` queda para welcome_screen, como fija el design (hook puro).

No se detectaron bugs de máquina de estados ni de refs/closures.

## FOCO CRÍTICO — cambios de configuración

### (a) eslint.config.js — apagar `no-unsafe-*` en archivos de test → ACEPTAR

- Los 6 errores que provoca revertirlo están TODOS en
  `src/voice/useVoiceInput.test.ts:131-136`, dentro del
  `expect.objectContaining({ status: expect.any(String), ... })`. En vitest 4
  los matchers asimétricos (`expect.any`) están tipados como `any`, y al asignarse
  dentro del objeto disparan `no-unsafe-assignment`. Es un artefacto del tipado de
  la lib de test, no un `any` real del código.
- La relajación está correctamente acotada al bloque `files: ['**/*.{test,spec}.{ts,tsx}']`;
  NO afecta al código de producción. La red de tipos real la sigue dando `tsc`
  (typecheck limpio) sobre `frontend/src/**` no-test.
- Justificación en comentario sólida. `eslint.config.js` no está en la tabla de
  inmutables de CLAUDE.md. Es una relajación de calidad localizada y razonable.

  Observación (menor, NO bloqueante): apaga 5 reglas `no-unsafe-*` cuando el fallo
  concreto solo exige `no-unsafe-assignment`/`no-unsafe-member-access`. Es un
  preset defendible para dobles/mocks del borde del sistema, pero si se quisiera
  máxima precisión bastaría con menos reglas. No lo exijo: es una convención de
  suite legítima y consistente.

### (b) tsconfig.test.json — incluir `src/**/*.d.ts` → ACEPTAR (vía correcta)

- Verificado: sin este cambio, `tsc -p tsconfig.test.json` falla con
  `Cannot find name 'SpeechRecognition'` / `Property 'SpeechRecognition' does not
  exist on Window`. El suite de test importa `useVoiceInput.ts`, que depende de los
  tipos ambientales de `speech-recognition.d.ts`; ese `.d.ts` debe estar en la
  unidad de compilación del proyecto de test para resolver los globales.
- `tsconfig.app.json` (producción) ya cubre el `.d.ts` vía `include: ["src"]`; el
  proyecto de test es una unidad separada que necesitaba la inclusión explícita.
  Es la vía más limpia y mínima (más que, p.ej., referenciar el `.d.ts` con un
  triple-slash o duplicar declaraciones).

## Estado del warning de ThemeProvider

Pre-existente y no relacionado con esta feature:
`ThemeProvider.tsx:30` — `react-refresh/only-export-components` (warning, no error).
El archivo NO está tocado en este diff. No bloquea (`lint` termina con 0 errores).

## Observación menor (no bloqueante)

Las decisiones de diseño del hook (callback + estado derivado como única fuente de
verdad, límite de 15 en el componente, solo resultado final) están registradas en
`progress/voice_capture/design.md`. Al ser una decisión local del hook y no un cambio
transversal (S3/cifrado/theming/deploy), no considero obligatorio un ADR nuevo en
`docs/decisiones.md`. El README ya menciona "input o voz" y sigue coherente.

## Cambios requeridos

Ninguno. APPROVED.
