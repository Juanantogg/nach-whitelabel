/**
 * Tests RED — voice/silenceDetector (detección de silencio PURA, sin DOM).
 * Feature voice_auto_send, design §"Plan de tests" T1 y ADR 24.
 *
 * `createSilenceDetector` es una máquina temporal SIN dependencias del navegador:
 * recibe muestras de nivel normalizado (0..1) con su timestamp (`push(level, nowMs)`)
 * y decide qué evento emitir:
 *   type SilenceEvent = 'send' | 'no-speech' | null
 *   interface SilenceDetector { push(level, nowMs): SilenceEvent; reset(): void }
 *
 * Semántica (design §"Contrato"): un flag interno `hasSpoken` (alguna muestra superó
 * `speechThreshold`) separa los dos casos:
 *   - Habló y luego calló (silencio sostenido ≥ silenceHangMs tras voz) → 'send'.
 *   - Nunca habló (siempre bajo umbral ≥ noSpeechTimeoutMs) → 'no-speech'.
 *   - Una pausa breve (< hang) entre voces NO dispara 'send' (la voz recarga la ventana).
 *
 * NO necesita jsdom ni mocks del navegador: se alimenta con secuencias `(level, nowMs)`
 * y se afirma el evento. El tiempo se INYECTA por parámetro (`nowMs`), no se lee de
 * `Date.now`/`performance.now`, así que el test es determinista sin fake timers.
 *
 * RED esperado: `./silenceDetector` aún NO existe (lo crea el implementer en el GREEN)
 * → el import falla y todos los tests quedan en rojo por "módulo ausente". RED puro
 * por símbolo/módulo inexistente, no por sintaxis del test.
 */
import { describe, expect, it } from 'vitest';
import { createSilenceDetector } from './silenceDetector';

// Config de prueba con las constantes del diseño (SPEECH_THRESHOLD≈0.06,
// SILENCE_HANG_MS=1500, NO_SPEECH_TIMEOUT_MS=3000). Se fijan aquí para no acoplar
// el test a los valores reales del motor: se prueba la SEMÁNTICA, no las constantes.
const THRESHOLD = 0.06;
const HANG_MS = 1_500;
const NO_SPEECH_MS = 3_000;

function makeDetector() {
  return createSilenceDetector({
    speechThreshold: THRESHOLD,
    silenceHangMs: HANG_MS,
    noSpeechTimeoutMs: NO_SPEECH_MS,
  });
}

const LOUD = 0.5; // muy por encima del umbral: cuenta como "voz"
const QUIET = 0.01; // muy por debajo del umbral: cuenta como "silencio"

describe('createSilenceDetector — auto-envío tras hablar y callar (T1.a)', () => {
  it('silencio → voz → silencio sostenido ≥ SILENCE_HANG_MS emite "send"', () => {
    const d = makeDetector();

    // Silencio inicial breve (aún sin haber hablado): no dispara nada.
    expect(d.push(QUIET, 0)).toBeNull();
    expect(d.push(QUIET, 100)).toBeNull();

    // El usuario habla: marca hasSpoken. No emite.
    expect(d.push(LOUD, 200)).toBeNull();
    expect(d.push(LOUD, 300)).toBeNull();

    // Empieza el silencio (t=400). Aún no ha pasado la ventana de cuelgue.
    expect(d.push(QUIET, 400)).toBeNull();
    expect(d.push(QUIET, 400 + HANG_MS - 1)).toBeNull();

    // Se cumple la ventana de cuelgue desde t=400 → auto-envío.
    expect(d.push(QUIET, 400 + HANG_MS)).toBe('send');
  });

  it('NO emite "send" antes de completarse la ventana de cuelgue', () => {
    const d = makeDetector();
    d.push(LOUD, 0); // habló
    d.push(QUIET, 100); // empieza el silencio en t=100

    // Todas las muestras dentro de la ventana devuelven null.
    for (let t = 200; t < 100 + HANG_MS; t += 100) {
      expect(d.push(QUIET, t)).toBeNull();
    }
  });
});

describe('createSilenceDetector — sin voz previa (T1.b)', () => {
  it('niveles siempre bajos ≥ NO_SPEECH_TIMEOUT_MS emiten "no-speech"', () => {
    const d = makeDetector();

    expect(d.push(QUIET, 0)).toBeNull();
    expect(d.push(QUIET, 1_000)).toBeNull();
    expect(d.push(QUIET, NO_SPEECH_MS - 1)).toBeNull();

    // Cumplido el timeout sin haber superado nunca el umbral → no-speech.
    expect(d.push(QUIET, NO_SPEECH_MS)).toBe('no-speech');
  });

  it('nunca emite "send" cuando jamás se superó el umbral', () => {
    const d = makeDetector();
    let sawSend = false;
    for (let t = 0; t <= NO_SPEECH_MS - 1; t += 100) {
      if (d.push(QUIET, t) === 'send') sawSend = true;
    }
    expect(sawSend).toBe(false);
  });
});

describe('createSilenceDetector — la voz recarga la ventana de silencio (T1.c)', () => {
  it('voz → pausa CORTA (< hang) → voz → silencio ≥ hang emite "send" (no corta a mitad)', () => {
    const d = makeDetector();

    d.push(LOUD, 0); // voz
    // Pausa breve, más corta que la ventana de cuelgue.
    expect(d.push(QUIET, 100)).toBeNull();
    expect(d.push(QUIET, 100 + HANG_MS - 200)).toBeNull();

    // El usuario retoma la palabra: la voz recarga el temporizador de silencio.
    expect(d.push(LOUD, 100 + HANG_MS - 100)).toBeNull();

    const resumedSilenceAt = 100 + HANG_MS; // nuevo inicio de silencio
    // Justo antes de cumplir la ventana desde el NUEVO silencio: aún nada.
    expect(d.push(QUIET, resumedSilenceAt)).toBeNull();
    expect(d.push(QUIET, resumedSilenceAt + HANG_MS - 1)).toBeNull();

    // Cumplida la ventana desde el segundo silencio → send.
    expect(d.push(QUIET, resumedSilenceAt + HANG_MS)).toBe('send');
  });
});

describe('createSilenceDetector — el flag hasSpoken separa (a) de (b) (T1.e)', () => {
  it('con voz previa NUNCA emite "no-speech" aunque pase el noSpeechTimeout', () => {
    const d = makeDetector();
    d.push(LOUD, 0); // ya habló

    // Un silencio largo, más allá de noSpeechTimeout: debe ser 'send' (por hang),
    // jamás 'no-speech', porque hasSpoken gana.
    const events: Array<string | null> = [];
    for (let t = 100; t <= NO_SPEECH_MS + HANG_MS; t += 100) {
      events.push(d.push(QUIET, t));
    }
    expect(events).not.toContain('no-speech');
    expect(events).toContain('send');
  });

  it('sin voz previa NUNCA emite "send"', () => {
    const d = makeDetector();
    const events: Array<string | null> = [];
    for (let t = 0; t <= NO_SPEECH_MS; t += 100) {
      events.push(d.push(QUIET, t));
    }
    expect(events).not.toContain('send');
    expect(events).toContain('no-speech');
  });
});

describe('createSilenceDetector — reset() reinicia el estado', () => {
  it('tras reset() vuelve a tratar el flujo como una sesión nueva (sin hasSpoken)', () => {
    const d = makeDetector();
    d.push(LOUD, 0); // habló en la sesión vieja
    d.reset();

    // Nueva sesión: solo silencio desde t=0 (relativo a la nueva sesión) →
    // debe comportarse como "nunca habló" y emitir no-speech, no send.
    let sawSend = false;
    let sawNoSpeech = false;
    for (let t = 0; t <= NO_SPEECH_MS; t += 100) {
      const ev = d.push(QUIET, t);
      if (ev === 'send') sawSend = true;
      if (ev === 'no-speech') sawNoSpeech = true;
    }
    expect(sawSend).toBe(false);
    expect(sawNoSpeech).toBe(true);
  });
});
