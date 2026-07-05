# Review — voice_reliability

**Veredicto:** APPROVED

Fase REFACTOR verde y limpia. `./init.sh` (deps + lint + typecheck) OK; frontend
`test` 175/175, `lint` limpio, `typecheck` sin errores. El cambio se ciñe a los 2
archivos de producción esperados (`useVoiceInput.ts`, `NameField.tsx`); el resto
del working tree son tests (RED→GREEN de la feature), evidencia en `progress/` y
`feature_list.json`. `WelcomeScreen` intacto (diff vacío).

## Checklist punto por punto

1. **Acceptance de voice_reliability (6/6):** [x]
   - `interimResults:true` + `continuous:false` + `maxAlternatives:1`
     (`useVoiceInput.ts:113-115`); `onresult` itera desde `event.resultIndex`,
     concatena y hace `.trim()` (`:117-129`) → clamp a 15 aguas abajo en NameField.
   - Mic NO renderizado si `!isSupported` — `showMic = isSupported && !voiceUnavailable`
     (`NameField.tsx:38,77`).
   - Mic oculto tras `network` — latch `voiceUnavailable` en `onerror` sin reset en
     `start()` (`useVoiceInput.ts:150`), consumido por `showMic`.
   - Sesión sin captura → `no-speech` sintético en `onend` (`:131-143`), mapeado a
     `voice.noSpeech` en la región `role="status"` de NameField.
   - Input manual siempre presente (el `<input>`, contador y `role="status"` viven
     fuera del `showMic &&`).
   - RED antes de GREEN documentado y verificado (14 fallas aisladas → 175 verde).

2. **Correctitud del hook:** [x]
   - Latch NO se resetea en `start()` (solo `errorCode` se limpia en `:164`); solo
     `network` lo activa (`:150`), otros errores no — cubierto por A9.
   - `hadResultRef` se resetea por sesión en `start()` (`:163`), tras asignar la
     instancia; se marca `true` en la 1ª emisión útil (`:126`).
   - Guard `prev==='error'` en `onend` (`:134`) evita doble-set y colisión con el
     `no-speech` real de `onerror` (A6). Correcto.
   - Iteración desde `resultIndex` con optional chaining `results[i]?.[0]?.transcript`
     robusta a segmentos vacíos; `.trim()` + guard `text===''` no rompe el caso de
     un solo segmento (A2/A3 lo cubren). Sin edge cases pendientes.
   - Nit menor (no bloqueante): `onerror` con `network` deja `voiceUnavailable=true`
     y también fija `status='error'`/`errorCode='network'`; NameField oculta el mic
     y a la vez `errorText` mostraría `genericError` en `role="status"`. Es coherente
     (el aviso desaparece al re-render sin sesión activa) y no contradice la spec,
     pero conviene tenerlo presente si en el futuro se refina el copy de `network`.

3. **Decisión stop()-sin-captura:** [x]
   Coherente en código (onend no distingue origen natural vs `stop()`) y en tests.
   Los 2 tests de voice_capture preservan sus invariantes:
   - `onend natural TRAS captura → idle` (`test:209`): emite captura antes de
     `emitEnd()`; conserva la intención "cierre ordenado → idle" sin solapar A4/A5/A10.
   - `stop() sin captura` (`test:226`): mantiene explícito `inst.stop()` llamado 1
     vez y añade la nueva aserción `error`/`no-speech`. Se dividió en dos para
     conservar también el camino `stop() tras captura → idle` (`test:242`). No hay
     dilución: el invariante de conteo de `stop()` sigue afirmado en ambos.

4. **White-label:** [x]
   Cero literales/hex en `NameField.tsx`: todo vía `text.*`/`voice.*` y tokens
   `text-brand-*`/`bg-brand-*`/`border-brand-*`. `voice.unsupported` ya no se
   renderiza en el componente pero SIGUE en el schema
   (`brand/core/schema.ts:94`, con default). Confirmado.

5. **Regresión honesta:** [x]
   Los tests actualizados reflejan cambio de SPEC, no relajación:
   - `interimResults false→true` (A1) es la spec nueva.
   - Casos 13/15 de no-soporte pasan de "botón disabled con unsupported" a
     "botón ausente" — es el comportamiento nuevo (ocultar), no un test debilitado.
   - Ningún test quedó tautológico: B13/B14/B15 son guardas de invariante
     legítimas (mic visible en caso normal, no-speech comunicado, clamp a 15);
     observan por rol/aria/texto de marca, nunca por clase CSS ni literal.

6. **Minimalismo/calidad:** [x]
   Sin `any` ni `console.*` en el código de producción tocado. Sin imports sin
   usar, sin dead code (la rama `disabled`/`voice.unsupported` se eliminó del
   componente). Cambio ceñido a los 2 archivos. `WelcomeScreen` intacto (verificado
   por diff vacío). Sin dependencias nuevas.

## Recomendación sobre el ADR

**Recomiendo añadir un ADR** en `docs/decisiones.md`. No existe hoy ninguna
decisión sobre la UX de voz (grep: 0 coincidencias de voz/speech/ocultar en ese
archivo). Tres decisiones de esta feature califican como "arquitectura/UX
relevante" y cambian lo que insinuaba el design de voice_ux:
  1. **Ocultar el mic en vez de deshabilitarlo** cuando no hay forma de dictar
     (no-soporte o `network`) — cambio de contrato visible.
  2. **Latch `voiceUnavailable` de sesión** (un solo `network` basta; no se
     reintenta) — decisión de comportamiento con alternativas descartadas.
  3. **`no-speech` sintético también en `stop()` manual sin captura** — decisión
     de UX confirmada con el usuario; conviene dejar el "porqué" fuera del design
     efímero de la feature.

El design de voice_reliability documenta bien el razonamiento, pero el design es
evidencia por-feature; la decisión transversal de UX debería vivir en el ADR para
no perderse. **No es bloqueante del REFACTOR** (no rompe verde ni white-label),
pero sí es criterio de evaluación de documentación: recomiendo que el leader
cree el ADR antes del commit. No lo escribo yo (soy reviewer).

## Nits (no bloqueantes)
1. `useVoiceInput.ts` — al fijar `voiceUnavailable=true` por `network`, el estado
   también queda en `error`/`network`; el aviso de `role="status"` con
   `genericError` es efímero y coherente, pero vale documentarlo si se refina el
   copy de red más adelante.
