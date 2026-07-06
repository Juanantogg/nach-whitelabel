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
