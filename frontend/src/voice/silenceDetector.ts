/**
 * Detección de silencio PURA (sin DOM ni Web Audio) — feature voice_auto_send, ADR 24.
 *
 * Máquina temporal determinista: se alimenta con muestras de nivel de audio ya
 * normalizadas (0..1) junto con su timestamp (`push(level, nowMs)`) y decide qué
 * evento disparar. NO conoce `AudioContext`/`AnalyserNode` (eso vive en
 * `audioLevelMeter.ts`), lo que la hace testeable como lógica pura sin mockear el
 * navegador. El tiempo se inyecta por parámetro: sin `Date.now`/`performance.now`.
 *
 * Semántica (design §"Contrato"): un flag `hasSpoken` (alguna muestra superó
 * `speechThreshold`) separa los dos comportamientos:
 *   - Habló y luego calló (silencio sostenido ≥ silenceHangMs tras voz) → 'send'.
 *   - Nunca habló (siempre bajo umbral ≥ noSpeechTimeoutMs) → 'no-speech'.
 * Una pausa breve (< hang) entre voces NO dispara 'send': la voz recarga la ventana.
 */

export interface SilenceDetectorConfig {
  /** Nivel normalizado 0..1 por encima del cual una muestra cuenta como "voz". */
  speechThreshold: number;
  /** Ventana de silencio TRAS haber hablado que dispara el auto-envío. */
  silenceHangMs: number;
  /** Sin voz nunca durante este tiempo → dispara 'no-speech'. */
  noSpeechTimeoutMs: number;
}

export type SilenceEvent = 'send' | 'no-speech' | null;

export interface SilenceDetector {
  /** Alimenta una medida de nivel con su timestamp; devuelve el evento a disparar (o null). */
  push(level: number, nowMs: number): SilenceEvent;
  /** Reinicia el estado: trata el siguiente push como una sesión nueva. */
  reset(): void;
}

export function createSilenceDetector(cfg: SilenceDetectorConfig): SilenceDetector {
  const { speechThreshold, silenceHangMs, noSpeechTimeoutMs } = cfg;

  let startedAt: number | null = null; // instante del primer push de la sesión
  let hasSpoken = false; // ¿alguna muestra superó el umbral?
  let silenceSince: number | null = null; // instante en que el nivel cayó bajo umbral tras voz

  function reset(): void {
    startedAt = null;
    hasSpoken = false;
    silenceSince = null;
  }

  function push(level: number, nowMs: number): SilenceEvent {
    if (startedAt === null) startedAt = nowMs;

    if (level >= speechThreshold) {
      // Voz: recarga la ventana de silencio.
      hasSpoken = true;
      silenceSince = null;
      return null;
    }

    // Silencio.
    if (hasSpoken) {
      if (silenceSince === null) silenceSince = nowMs;
      if (nowMs - silenceSince >= silenceHangMs) return 'send';
      return null;
    }

    // Nunca habló todavía.
    if (nowMs - startedAt >= noSpeechTimeoutMs) return 'no-speech';
    return null;
  }

  return { push, reset };
}
