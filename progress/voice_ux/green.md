# GREEN — voice_ux

Implementado en `frontend/src/features/welcome/NameField/NameField.tsx` (único
archivo tocado). Hook, schema y WelcomeScreen intactos. Ningún test modificado.

## Cambios
- Consume el resto de la API del hook: `stop`, `isListening`, `isSupported`,
  `status`, `errorCode` (antes solo `start`).
- Botón toggle: `onClick = isListening ? stop() : start()`; `aria-pressed={isListening}`;
  `aria-label` conmutado (`unsupported` > `listeningLabel` > `startLabel`).
- Feedback de escucha: etiqueta `voice.listeningLabel` visible en `text-brand-accent`
  solo mientras `isListening`; botón con `motion-safe:animate-pulse` + `text-brand-accent`.
- Región de error `role="status" aria-live="polite"` en `text-brand-accent`; muestra
  el texto mapeado (helper local puro `voiceErrorText`) solo si `status==='error' && errorCode!==null`.
  not-allowed→permissionDenied, no-speech→noSpeech, resto→genericError.
- No-soporte: botón `disabled` + `aria-label`/`title = voice.unsupported`, `disabled:opacity-50`,
  sin pulso. Input manual intacto.
- Conservado: input controlado, `maxLength=15`, `clampToMax` en manual y voz, contador de marca, placeholder de marca.

Cero literales/hex: todos los textos desde `voice.*`/`text.*`, colores por token.

## Verificación
- `pnpm --filter @nach/frontend test -- run src/.../NameField.test.tsx`: 158/158 verde (13 rojos → verde).
- lint: limpio. typecheck: limpio.
