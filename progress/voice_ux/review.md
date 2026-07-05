# Review — voice_ux

**Veredicto:** APROBADO

Único archivo de producción tocado: `frontend/src/features/welcome/NameField/NameField.tsx`
(+65 líneas). Hook, schema y `WelcomeScreen` intactos. Test ampliado (+262, 0
eliminaciones). `feature_list.json` actualizado (status). Todo verde.

## Checklist punto por punto

### 1. Acceptance de la feature (5 criterios voice_ux)
- [x] **Toggle start/stop por isListening** — `onClick={() => (isListening ? stop() : start())}`
  (línea 81). Verificado por casos 1-2 del test.
- [x] **Indicación de escucha con texto de marca + prefers-reduced-motion** — etiqueta
  `voice.listeningLabel` (línea 106) + `motion-safe:animate-pulse` (línea 83). La
  señal textual es no-dependiente de color/movimiento; el pulso se desactiva con
  `motion-reduce`. Casos 5-6.
- [x] **Transcripción rellena el campo con tope 15** — `onResult: (t) => onChange(clampToMax(t))`
  (línea 30), `clampToMax` corta a `NAME_MAX_LENGTH`. Casos de truncado preexistentes.
- [x] **No-soporte y errores con textos de marca, sin literales/hex** — botón `disabled`
  + `aria-label`/`title = voice.unsupported` (líneas 77-80); región `role="status"`
  con error mapeado desde `errorCode` a `voice.permissionDenied`/`noSpeech`/`genericError`.
  Casos 7-13.
- [x] **Tests con hook mockeado en RED** — `tests.md` documenta 13 rojos → verde; el
  mock controla `status`/`isListening`/`isSupported`/`errorCode`/`stop`.

### 2. White-label (regla dura)
- [x] **Cero literales de texto** — todos los textos salen de `voice.*` (startLabel,
  listeningLabel, permissionDenied, noSpeech, genericError, unsupported) y `text.*`
  (inputPlaceholder, counterTemplate). El SVG lleva `aria-hidden`, sin texto.
- [x] **Cero hex** — grep de `#[0-9a-fA-F]{3,6}` en el componente: 0 coincidencias.
  Colores por token: `brand-primary`, `brand-accent`, `brand-muted`, `brand-text`.
- [x] Caso 15 blinda white-label renderizando con otra marca.

### 3. Accesibilidad
- [x] `aria-label` conmutado (unsupported > listeningLabel > startLabel, líneas 58-62).
- [x] `aria-pressed={isListening}` (línea 79).
- [x] `role="status"` + `aria-live="polite"` para errores (línea 114) — coherente con
  el design (§4: polite, no interrumpe foco).
- [x] `prefers-reduced-motion` respetado vía `motion-safe:animate-pulse`.

### 4. Fidelidad al design y minimalismo
- [x] No reescribió el hook, no tocó schema ni WelcomeScreen (diff lo confirma).
- [x] `voiceErrorText` es helper local no exportado, puro, coherente con §4 del design.
- [x] `clampToMax` reutilizado para input y voz (una sola fuente del tope).
- [x] Sin sobre-ingeniería: no añadió interimResults (fuera de alcance por §6).

### 5. Calidad
- [x] Sin `any`, sin imports/vars sin usar (typecheck + lint limpios).
- [x] Sin `console.log`, sin dead code. Comentarios en español coherentes.
- [x] Sin dependencias nuevas.

### 6. TDD honrado
- [x] `git diff` del test: 0 líneas eliminadas, solo añadidas → los tests
  preexistentes no se relajaron. RED→GREEN legítimo (13 rojos documentados).

## Calidad (cierre)
- `pnpm --filter @nach/frontend test -- run`: 158/158 verde (20 suites).
- `pnpm --filter @nach/frontend lint`: limpio.
- `pnpm --filter @nach/frontend typecheck`: sin errores.
- `./init.sh` (health-check ligero): OK.

## Nits (no bloqueantes)
- El `<span aria-hidden="true" />` vacío (línea 108) es un placeholder de layout para
  el `justify-between` del contador. Funciona; alternativa marginalmente más simple
  sería `justify-end` sin el span, pero no justifica un cambio. Se deja a criterio.

## Documentación
No introduce decisión de arquitectura nueva: reutiliza hook, tokens y patrón aria
existentes. El design (§6) razona explícitamente por qué NO se toca el hook. No
requiere ADR nuevo.
