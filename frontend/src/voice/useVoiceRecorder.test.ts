/**
 * Tests RED — voice/useVoiceRecorder (motor de voz ÚNICO: captura de audio +
 * transcripción por Groq). Feature voice_groq_default, design §5.1 (R1-R7).
 *
 * Este archivo es el RENOMBRADO de `useVoiceFallback.test.ts` (ADR 23: Groq pasa a
 * ser el motor único; el hook `useVoiceFallback` se renombra a `useVoiceRecorder`
 * sin cambios de lógica). Símbolos actualizados: `useVoiceFallback` →
 * `useVoiceRecorder`; tipos `FallbackStatus` → `RecorderStatus`, `FallbackErrorCode`
 * → `RecorderErrorCode`, `UseVoiceFallback*` → `UseVoiceRecorder*`.
 *
 * El motor captura audio con `getUserMedia`/`MediaRecorder`, al parar sube el Blob
 * vía `transcribeVoice` y expone la máquina de estados:
 *   status: 'idle' | 'recording' | 'transcribing' | 'error'
 *   isRecording, isTranscribing, errorCode, start(), stop()
 *   errorCode ∈ 'permission-denied' | 'no-audio' | 'network' | 'unknown' | null
 *
 * Se mockea el BORDE del sistema: `navigator.mediaDevices.getUserMedia` y la clase
 * `MediaRecorder` (jsdom no las trae). `transcribeVoice` se INYECTA por opción
 * (`transcribe`) para no tocar la red. La máquina de estados bajo prueba NO se
 * mockea. Timers falsos para el auto-stop (R6).
 *
 * DECISIÓN del tester para R5 (silencio): errorCode 'no-audio' con estado error,
 * para que NameField reuse el aviso `voice.noSpeech` por el mismo canal que los
 * demás errores (design §2.1), sin ensuciar el estado del nombre con una cadena
 * vacía.
 *
 * RED esperado: `./useVoiceRecorder` aún no existe (el implementer renombra el .ts
 * en el GREEN) → el import falla y todos los tests quedan en rojo por "módulo
 * ausente". Es un RED puro por renombre: la lógica es la misma que ya pasaba con
 * `useVoiceFallback`.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceRecorder } from './useVoiceRecorder';
import { ApiError } from '../api/apiError';

/** Track de media falso que registra si se liberó (`stop()`). */
class MockTrack {
  stop = vi.fn();
}

/** MediaStream falso con tracks que el hook debe liberar en stop/unmount. */
class MockStream {
  tracks: MockTrack[] = [new MockTrack()];
  getTracks(): MockTrack[] {
    return this.tracks;
  }
}

/**
 * Doble controlable de MediaRecorder. Guarda las llamadas a start/stop y expone
 * helpers para que el test dispare `ondataavailable`/`onstop` como haría el
 * navegador. La instancia viva se publica en `lastInstance`.
 */
class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static lastInstance: MockMediaRecorder | null = null;
  static supportedType = 'audio/webm;codecs=opus';

  static isTypeSupported(type: string): boolean {
    return type === MockMediaRecorder.supportedType;
  }

  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state: 'inactive' | 'recording' = 'inactive';

  // Campos declarados y asignados en el cuerpo del constructor: `erasableSyntaxOnly`
  // del repo prohíbe los parámetros-propiedad (`public …` en la firma).
  stream: MockStream;
  options?: { mimeType?: string };

  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    // El navegador emite los datos pendientes y luego onstop.
    this.onstop?.();
  });

  constructor(stream: MockStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.options = options;
    MockMediaRecorder.instances.push(this);
    MockMediaRecorder.lastInstance = this;
  }

  /** Simula un chunk de audio disponible. */
  emitData(bytes = 4): void {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/webm' });
    this.ondataavailable?.({ data: blob });
  }
}

let getUserMediaMock: ReturnType<typeof vi.fn>;
let currentStream: MockStream;

function installMediaMocks(): void {
  MockMediaRecorder.instances = [];
  MockMediaRecorder.lastInstance = null;
  MockMediaRecorder.supportedType = 'audio/webm;codecs=opus';
  currentStream = new MockStream();
  getUserMediaMock = vi.fn(() => Promise.resolve(currentStream));

  (navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: getUserMediaMock,
  };
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = MockMediaRecorder;
}

function uninstallMediaMocks(): void {
  delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
}

/** Firma de `transcribeVoice` (design §3.1): recibe el Blob de audio, resuelve el texto. */
type TranscribeFn = (audio: Blob) => Promise<string>;

/** transcribeVoice inyectable: por defecto resuelve 'Ana'. Tipado para que `mock.calls` conozca el arg Blob. */
function makeTranscribe(result: string | Promise<string> = 'Ana') {
  return vi.fn<TranscribeFn>(() => (result instanceof Promise ? result : Promise.resolve(result)));
}

/** Flush de microtareas para que las promesas (getUserMedia/transcribe) se asienten dentro de `act`. */
function flush(): Promise<void> {
  return Promise.resolve();
}

const noop = (): void => {};

// ---------------------------------------------------------------------------
// Web Audio API mockeado (feature voice_auto_send, design §"Plan de tests" T2).
//
// jsdom NO define `AudioContext`/`AnalyserNode`: sin este doble el motor petaría
// por "AudioContext is not defined" en vez de por la lógica. Instalamos en
// `globalThis` un doble controlable que:
//   - createAnalyser() → un AnalyserNode falso cuyo getByteTimeDomainData rellena el
//     buffer con `nextLevelByte`. El motor calcula el RMS normalizado sobre esa forma
//     de onda: byte 128 = silencio (RMS 0); byte lejos de 128 = "voz".
//   - createMediaStreamSource() → nodo con connect() (no analiza nada real).
//   - close() → spy que verifica el teardown del AudioContext en cada salida.
//
// El test manipula `nextLevelByte` entre ticks de muestreo (SAMPLE_MS) con
// `vi.advanceTimersByTime` para simular voz (byte alto) / silencio (byte 128).
// Se asume que el motor muestrea con setInterval (recomendación del design §5,
// más controlable con fake timers que rAF). Si usara rAF el implementer debe
// además mockear rAF; este andamiaje cubre el camino setInterval.
// ---------------------------------------------------------------------------

/** Byte de la forma de onda que el analyser devuelve en el próximo sample. */
let nextLevelByte = 128; // 128 = silencio (RMS 0)

/** Byte que produce un RMS bien por encima de SPEECH_THRESHOLD (~0.17 > 0.06). */
const VOICE_BYTE = 150;
/** Byte de silencio: RMS 0 (por debajo del umbral). */
const SILENCE_BYTE = 128;

class MockAnalyser {
  fftSize = 512;
  frequencyBinCount = 256;
  connect = vi.fn();
  getByteTimeDomainData = vi.fn((arr: Uint8Array) => {
    arr.fill(nextLevelByte);
  });
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];
  static lastInstance: MockAudioContext | null = null;

  createAnalyser = vi.fn(() => new MockAnalyser());
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  close = vi.fn(() => Promise.resolve());

  constructor() {
    MockAudioContext.instances.push(this);
    MockAudioContext.lastInstance = this;
  }
}

function installAudioMocks(): void {
  nextLevelByte = SILENCE_BYTE;
  MockAudioContext.instances = [];
  MockAudioContext.lastInstance = null;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
}

function uninstallAudioMocks(): void {
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
}

/** Fija el nivel de audio simulado para los próximos ticks de muestreo. */
function setLevel(byte: number): void {
  nextLevelByte = byte;
}

describe('useVoiceRecorder — auto-envío por silencio (voice_auto_send T2.a, T2.b)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMediaMocks();
    installAudioMocks();
  });
  afterEach(() => {
    uninstallAudioMocks();
    uninstallMediaMocks();
    vi.useRealTimers();
  });

  it('T2.a "habló y calló": niveles altos→bajos sostenidos disparan el envío SIN 2º clic (transcribe + onResult)', async () => {
    const onResult = vi.fn();
    const transcribe = makeTranscribe('Ana');
    const { result } = renderHook(() => useVoiceRecorder({ onResult, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });
    expect(result.current.status).toBe('recording');

    // El usuario habla ~500 ms (nivel alto).
    setLevel(VOICE_BYTE);
    await act(async () => {
      vi.advanceTimersByTime(500);
      await flush();
    });
    // Todavía no hay envío: sigue grabando.
    expect(transcribe).not.toHaveBeenCalled();

    // Un chunk de audio disponible (como haría el navegador durante la grabación).
    act(() => MockMediaRecorder.lastInstance!.emitData());

    // El usuario calla: silencio sostenido más allá de SILENCE_HANG_MS (~1.5 s).
    setLevel(SILENCE_BYTE);
    await act(async () => {
      vi.advanceTimersByTime(2_500);
      await flush();
    });

    // El motor paró SOLO (sin stop() manual) y subió el audio a Groq.
    expect(MockMediaRecorder.lastInstance!.stop).toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalledTimes(1);

    // Drena las microtareas de la promesa de transcribe antes de aseverar (bajo
    // fake timers NO se puede usar waitFor: hace polling con timers reales y no
    // resolvería; se drena con act async, igual que T2.b usa aserción síncrona).
    await act(async () => {
      await flush();
    });
    expect(onResult).toHaveBeenCalledWith('Ana');
    expect(result.current.status).toBe('idle');
  });

  it('T2.b "nunca habló": niveles siempre bajos ≥ NO_SPEECH_TIMEOUT_MS → no-audio SIN llamar a transcribe, mic liberado', async () => {
    const onResult = vi.fn();
    const transcribe = makeTranscribe('Ana');
    const { result } = renderHook(() => useVoiceRecorder({ onResult, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });
    const track = currentStream.getTracks()[0];

    // Silencio permanente durante más de NO_SPEECH_TIMEOUT_MS (~3 s) — nunca habló.
    setLevel(SILENCE_BYTE);
    await act(async () => {
      vi.advanceTimersByTime(3_500);
      await flush();
    });

    // No se sube audio vacío: transcribe jamás se llama.
    expect(transcribe).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    // El detector cortó por no-speech: estado error con no-audio (sin waitFor para
    // no colgar bajo fake timers cuando el motor aún no lo cablea → RED rápido).
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('no-audio');
    // El micrófono se liberó al cortar por no-speech.
    expect(track?.stop).toHaveBeenCalled();
  });
});

describe('useVoiceRecorder — teardown del AudioContext y bucle (voice_auto_send T2.c)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMediaMocks();
    installAudioMocks();
  });
  afterEach(() => {
    uninstallAudioMocks();
    uninstallMediaMocks();
    vi.useRealTimers();
  });

  it('ruta (b) no-speech: cierra el AudioContext (close())', async () => {
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult: noop, transcribe: makeTranscribe('Ana') }),
    );
    await act(async () => {
      result.current.start();
      await flush();
    });
    setLevel(SILENCE_BYTE);
    await act(async () => {
      vi.advanceTimersByTime(3_500);
      await flush();
    });
    expect(MockAudioContext.lastInstance!.close).toHaveBeenCalled();
  });

  it('stop() manual: cierra el AudioContext (close())', async () => {
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult: noop, transcribe: makeTranscribe('Ana') }),
    );
    await act(async () => {
      result.current.start();
      await flush();
    });
    act(() => MockMediaRecorder.lastInstance!.emitData());
    await act(async () => {
      result.current.stop();
      await flush();
    });
    expect(MockAudioContext.lastInstance!.close).toHaveBeenCalled();
  });

  it('unmount durante recording: cierra el AudioContext (close()) y libera el mic', async () => {
    const { result, unmount } = renderHook(() =>
      useVoiceRecorder({ onResult: noop, transcribe: makeTranscribe('Ana') }),
    );
    await act(async () => {
      result.current.start();
      await flush();
    });
    const track = currentStream.getTracks()[0];

    unmount();

    expect(MockAudioContext.lastInstance!.close).toHaveBeenCalled();
    expect(track?.stop).toHaveBeenCalled();
  });
});

describe('useVoiceRecorder — red de seguridad por tiempo intacta (voice_auto_send T2.d, T2.e)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMediaMocks();
    installAudioMocks();
  });
  afterEach(() => {
    uninstallAudioMocks();
    uninstallMediaMocks();
    vi.useRealTimers();
  });

  it('T2.d voz CONTINUA (nunca cae bajo umbral): el detector NO corta antes; el auto-stop por tiempo (10 s) sí sube el audio', async () => {
    const transcribe = makeTranscribe('Ana');
    const { result } = renderHook(() => useVoiceRecorder({ onResult: noop, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });

    // Voz continua durante 9 s: por debajo del tope, el detector no debe enviar
    // (no hay silencio sostenido). transcribe aún no se llama.
    setLevel(VOICE_BYTE);
    await act(async () => {
      vi.advanceTimersByTime(9_000);
      await flush();
    });
    expect(transcribe).not.toHaveBeenCalled();

    // Un chunk y cruzamos el tope por tiempo (~10 s): auto-stop por tiempo dispara.
    act(() => MockMediaRecorder.lastInstance!.emitData());
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await flush();
    });
    expect(MockMediaRecorder.lastInstance!.stop).toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('T2.e stop() manual antes del cuelgue de silencio sigue subiendo el audio (transcribe llamado)', async () => {
    const transcribe = makeTranscribe('Ana');
    const { result } = renderHook(() => useVoiceRecorder({ onResult: noop, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });
    // El usuario habla un instante y para a mano antes del hang.
    setLevel(VOICE_BYTE);
    await act(async () => {
      vi.advanceTimersByTime(300);
      await flush();
    });
    act(() => MockMediaRecorder.lastInstance!.emitData());
    await act(async () => {
      result.current.stop();
      await flush();
    });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});

describe('useVoiceRecorder — captura y transcripción (R1, R2)', () => {
  beforeEach(installMediaMocks);
  afterEach(uninstallMediaMocks);

  it('R1 start() pide getUserMedia({ audio: true }) y arranca el recorder → status "recording", isRecording true', async () => {
    const transcribe = makeTranscribe();
    const { result } = renderHook(() => useVoiceRecorder({ onResult: noop, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });

    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    expect(MockMediaRecorder.lastInstance).not.toBeNull();
    expect(MockMediaRecorder.lastInstance!.start).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('recording');
    expect(result.current.isRecording).toBe(true);
  });

  it('R2 stop() ensambla el blob, pasa a "transcribing", llama a transcribe y al resolver "Ana" invoca onResult y vuelve a "idle"', async () => {
    const onResult = vi.fn();
    const transcribe = makeTranscribe('Ana');
    const { result } = renderHook(() => useVoiceRecorder({ onResult, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });

    // Un chunk de audio disponible antes de parar.
    act(() => MockMediaRecorder.lastInstance!.emitData());

    await act(async () => {
      result.current.stop();
      await flush();
    });

    // La transcripción se disparó con un Blob.
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0]?.[0]).toBeInstanceOf(Blob);

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(onResult).toHaveBeenCalledWith('Ana');
  });
});

describe('useVoiceRecorder — errores (R3, R4, R5)', () => {
  beforeEach(installMediaMocks);
  afterEach(uninstallMediaMocks);

  it('R3 getUserMedia rechaza (permiso denegado) → errorCode "permission-denied", status "error"; sin micrófono abierto', async () => {
    getUserMediaMock.mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    const transcribe = makeTranscribe();
    const { result } = renderHook(() => useVoiceRecorder({ onResult: noop, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorCode).toBe('permission-denied');
    // No se intentó transcribir nada.
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('R4 transcribe rechaza con ApiError(0) → errorCode "network", status "error"', async () => {
    const transcribe = vi.fn<TranscribeFn>(() => Promise.reject(new ApiError('sin conexión', 0)));
    const onResult = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onResult, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });
    act(() => MockMediaRecorder.lastInstance!.emitData());
    await act(async () => {
      result.current.stop();
      await flush();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorCode).toBe('network');
    expect(onResult).not.toHaveBeenCalled();
  });

  it('R5 transcribe resuelve "" (silencio) → errorCode "no-audio", status "error" y NO se propaga vacío a onResult', async () => {
    const onResult = vi.fn();
    const transcribe = makeTranscribe('');
    const { result } = renderHook(() => useVoiceRecorder({ onResult, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });
    act(() => MockMediaRecorder.lastInstance!.emitData());
    await act(async () => {
      result.current.stop();
      await flush();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorCode).toBe('no-audio');
    // No se ensucia el estado del nombre con una cadena vacía.
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('useVoiceRecorder — auto-stop y limpieza (R6, R7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMediaMocks();
  });
  afterEach(() => {
    uninstallMediaMocks();
    vi.useRealTimers();
  });

  it('R6 auto-stop tras MAX_RECORDING_MS detiene la grabación y dispara la transcripción', async () => {
    const transcribe = makeTranscribe('Ana');
    const { result } = renderHook(() => useVoiceRecorder({ onResult: noop, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });
    expect(result.current.status).toBe('recording');

    const inst = MockMediaRecorder.lastInstance!;
    // Avanza más allá del tope de grabación (~10 s, design §4.2). Se usa un valor
    // holgado para no acoplarse a la constante exacta: 30 s cubre cualquier tope
    // razonable del diseño.
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flush();
    });

    // El recorder se detuvo solo (sin llamar a stop() manual) → onstop disparó la transcripción.
    expect(inst.stop).toHaveBeenCalled();
  });

  it('R7 cleanup en unmount libera los tracks del stream', async () => {
    const transcribe = makeTranscribe();
    const { result, unmount } = renderHook(() => useVoiceRecorder({ onResult: noop, transcribe }));

    await act(async () => {
      result.current.start();
      await flush();
    });
    const track = currentStream.getTracks()[0];

    unmount();

    expect(track?.stop).toHaveBeenCalled();
  });
});
