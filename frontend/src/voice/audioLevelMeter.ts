/**
 * Borde Web Audio del detector de silencio — feature voice_auto_send, ADR 24.
 *
 * Capa MÍNIMA sobre la Web Audio API: dado el `MediaStream` de `getUserMedia`
 * (el MISMO que usa el `MediaRecorder`, sin abrir un segundo micrófono), crea un
 * `AudioContext` + `AnalyserNode`, y expone:
 *   - `sample()`: nivel RMS normalizado 0..1 de la forma de onda del frame actual.
 *   - `close()`: cierra el `AudioContext` (teardown obligatorio: un contexto abierto
 *     mantiene el grafo de audio y puede dejar el micrófono vivo).
 *
 * Se mide con `getByteTimeDomainData` (dominio temporal) en vez de la FFT: para
 * "¿hay voz o silencio?" el RMS de la forma de onda es más directo y barato que el
 * espectro. RMS = sqrt(mean(((v-128)/128)^2)), ya normalizado a 0..1.
 *
 * Este módulo es el que los tests del motor mockean vía `globalThis.AudioContext`.
 */

export interface AudioLevelMeter {
  /** Nivel RMS normalizado 0..1 de la forma de onda del frame actual. */
  sample(): number;
  /** Cierra el AudioContext (libera el grafo de audio). */
  close(): Promise<void> | void;
}

/** Resuelve el constructor de AudioContext con fallback a webkit (Safari antiguo). */
function resolveAudioContext(): typeof AudioContext {
  const w = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API no disponible en este navegador');
  return Ctor;
}

export function createAudioLevelMeter(stream: MediaStream): AudioLevelMeter {
  const AudioCtx = resolveAudioContext();
  const context = new AudioCtx();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);

  const buffer = new Uint8Array(analyser.fftSize);

  function sample(): number {
    analyser.getByteTimeDomainData(buffer);
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const normalized = (buffer[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / buffer.length);
  }

  function close(): Promise<void> | void {
    return context.close();
  }

  return { sample, close };
}
