import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceInput } from './useVoiceInput';

/**
 * RED — voice_capture.
 *
 * Estos tests derivan de `progress/voice_capture/design.md` (secciones
 * "Estrategia de test" y "Criterios de aceptación traducibles a tests"). Fallan
 * hasta que exista `frontend/src/voice/useVoiceInput.ts` (y sus tipos ambientales
 * en `speech-recognition.d.ts`).
 *
 * jsdom NO trae SpeechRecognition: se mockea íntegramente el borde del sistema
 * (la API del navegador), NUNCA la lógica bajo prueba (la máquina de estados del
 * hook). El test dispara los eventos de la API a mano sobre la instancia mock.
 */

/**
 * Doble controlable de SpeechRecognition. Guarda las llamadas a `start`/`stop`/
 * `abort` y expone helpers para que el test dispare los handlers como haría el
 * navegador. La instancia viva se publica en `MockSpeechRecognition.lastInstance`
 * para poder inspeccionarla desde el test tras `start()`.
 */
class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];
  static lastInstance: MockSpeechRecognition | null = null;

  // Config que el hook debe fijar antes de arrancar.
  lang = '';
  continuous = true; // valor "sucio" a propósito: el hook debe ponerlo en false
  interimResults = true; // idem
  maxAlternatives = 0;

  // Handlers que el hook asigna.
  onstart: ((ev: unknown) => void) | null = null;
  onresult: ((ev: unknown) => void) | null = null;
  onend: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  // Espías de los métodos de la API.
  start = vi.fn(() => {
    this.onstart?.({});
  });
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    MockSpeechRecognition.instances.push(this);
    MockSpeechRecognition.lastInstance = this;
  }

  // ---- helpers de test para disparar eventos del navegador ----

  /** Simula un resultado FINAL con la transcripción dada. */
  emitFinalResult(transcript: string): void {
    this.onresult?.({
      resultIndex: 0,
      results: {
        0: {
          0: { transcript, confidence: 0.9 },
          isFinal: true,
          length: 1,
        },
        length: 1,
      },
    });
  }

  /** Simula el fin natural de una sesión de escucha. */
  emitEnd(): void {
    this.onend?.({});
  }

  /** Simula un error de la API con el código crudo dado. */
  emitError(error: string): void {
    this.onerror?.({ error });
  }
}

function installMock(): void {
  MockSpeechRecognition.instances = [];
  MockSpeechRecognition.lastInstance = null;
  // Ambos alias: el hook usa `window.SpeechRecognition ?? window.webkitSpeechRecognition`.
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = MockSpeechRecognition;
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
    MockSpeechRecognition;
}

function uninstallMock(): void {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
}

const noop = (): void => {};

describe('useVoiceInput — soporte / no soporte (acceptance #2, #3)', () => {
  afterEach(uninstallMock);

  it('con la API presente: isSupported true y status inicial "idle"', () => {
    installMock();
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    expect(result.current.isSupported).toBe(true);
    expect(result.current.status).toBe('idle');
    expect(result.current.isListening).toBe(false);
    expect(result.current.errorCode).toBeNull();
    expect(result.current.transcript).toBe('');
  });

  it('sin la API en window: isSupported false, status "unsupported", start/stop son no-op y no lanzan', () => {
    uninstallMock();
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    expect(result.current.isSupported).toBe(false);
    expect(result.current.status).toBe('unsupported');

    expect(() => act(() => result.current.start())).not.toThrow();
    expect(() => act(() => result.current.stop())).not.toThrow();
    // Sigue unsupported: start() no instanció nada.
    expect(result.current.status).toBe('unsupported');
    expect(MockSpeechRecognition.instances).toHaveLength(0);
  });

  it('el retorno expone el contrato completo (acceptance #1)', () => {
    installMock();
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    expect(result.current).toEqual(
      expect.objectContaining({
        status: expect.any(String),
        isSupported: expect.any(Boolean),
        isListening: expect.any(Boolean),
        transcript: expect.any(String),
        start: expect.any(Function),
        stop: expect.any(Function),
      }),
    );
    // errorCode es VoiceErrorCode | null.
    expect(result.current.errorCode).toBeNull();
  });
});

describe('useVoiceInput — arranque y escucha (acceptance #4, #5, #6)', () => {
  beforeEach(installMock);
  afterEach(uninstallMock);

  it('start() pasa a "listening" y arranca el reconocimiento con lang por defecto, interimResults=false, continuous=false', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());

    expect(result.current.status).toBe('listening');
    expect(result.current.isListening).toBe(true);

    const inst = MockSpeechRecognition.lastInstance!;
    expect(inst).not.toBeNull();
    expect(inst.start).toHaveBeenCalledTimes(1);
    expect(inst.lang).toBe('es-ES');
    expect(inst.interimResults).toBe(false);
    expect(inst.continuous).toBe(false);
  });

  it('start() con lang por opción configura ese locale en la instancia (acceptance #4)', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop, lang: 'es-MX' }));

    act(() => result.current.start());

    expect(MockSpeechRecognition.lastInstance!.lang).toBe('es-MX');
  });

  it('un resultado FINAL invoca onResult(transcript) y actualiza transcript (acceptance #5)', () => {
    const onResult = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onResult }));

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitFinalResult('Ana'));

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith('Ana');
    expect(result.current.transcript).toBe('Ana');
  });

  it('onend natural devuelve a "idle" (acceptance #6)', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    expect(result.current.status).toBe('listening');

    act(() => MockSpeechRecognition.lastInstance!.emitEnd());
    expect(result.current.status).toBe('idle');
    expect(result.current.isListening).toBe(false);
  });

  it('stop() detiene ordenadamente: llama instance.stop() y tras onend queda "idle" (acceptance #6)', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    const inst = MockSpeechRecognition.lastInstance!;

    act(() => result.current.stop());
    expect(inst.stop).toHaveBeenCalledTimes(1);

    act(() => inst.emitEnd());
    expect(result.current.status).toBe('idle');
  });
});

describe('useVoiceInput — mapeo de errores (acceptance #7, #8)', () => {
  beforeEach(installMock);
  afterEach(uninstallMock);

  it('not-allowed → status "error", errorCode "not-allowed" y onError("not-allowed")', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onResult: noop, onError }));

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitError('not-allowed'));

    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('not-allowed');
    expect(onError).toHaveBeenCalledWith('not-allowed');
  });

  it.each([
    ['no-speech', 'no-speech'],
    ['audio-capture', 'audio-capture'],
    ['network', 'network'],
  ])('el error crudo "%s" mapea a VoiceErrorCode "%s" y deja status "error"', (raw, code) => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitError(raw));

    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe(code);
  });

  it('un error desconocido mapea a "unknown"', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitError('xyz-raro'));

    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('unknown');
  });

  it('"aborted" NO deja error visible: vuelve a "idle" con errorCode null (acceptance #8)', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onResult: noop, onError }));

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitError('aborted'));

    expect(result.current.status).toBe('idle');
    expect(result.current.errorCode).toBeNull();
  });
});

describe('useVoiceInput — reintento, idempotencia y limpieza (acceptance #9, #10, #11)', () => {
  beforeEach(installMock);
  afterEach(uninstallMock);

  it('desde "error", start() limpia errorCode y reintenta a "listening" (acceptance #9)', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitError('network'));
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('network');

    act(() => result.current.start());
    expect(result.current.status).toBe('listening');
    expect(result.current.errorCode).toBeNull();
  });

  it('start() es idempotente: dos llamadas seguidas instancian una sola sesión (acceptance #10)', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    act(() => result.current.start());

    expect(MockSpeechRecognition.instances).toHaveLength(1);
    expect(MockSpeechRecognition.lastInstance!.start).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('listening');
  });

  it('unmount mientras escucha aborta el reconocimiento (acceptance #11)', () => {
    const { result, unmount } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    const inst = MockSpeechRecognition.lastInstance!;

    unmount();

    expect(inst.abort).toHaveBeenCalledTimes(1);
  });
});
