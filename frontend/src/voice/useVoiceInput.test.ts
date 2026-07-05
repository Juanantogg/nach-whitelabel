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
    this.emitResults([{ transcript, isFinal: true }]);
  }

  /** Simula un resultado INTERINO (parcial, isFinal:false) con la transcripción dada. */
  emitInterimResult(transcript: string): void {
    this.emitResults([{ transcript, isFinal: false }]);
  }

  /**
   * Simula un evento `onresult` con varios segmentos, replicando la estructura
   * array-like indexable con `.length` de `SpeechRecognitionResultList`. Cada
   * segmento aporta su `transcript` en `results[i][0]`. `resultIndex` marca el
   * primer segmento nuevo del evento (el hook itera desde ahí hasta el final).
   */
  emitResults(
    chunks: ReadonlyArray<{ transcript: string; isFinal?: boolean }>,
    resultIndex = 0,
  ): void {
    const results: Record<number, unknown> & { length: number } = {
      length: chunks.length,
    };
    chunks.forEach((chunk, i) => {
      results[i] = {
        0: { transcript: chunk.transcript, confidence: 0.9 },
        isFinal: chunk.isFinal ?? false,
        length: 1,
      };
    });
    this.onresult?.({ resultIndex, results });
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

  it('start() pasa a "listening" y arranca el reconocimiento con lang por defecto, interimResults=true, continuous=false (acceptance voice_reliability A1)', () => {
    // REGRESIÓN (cambio de spec voice_reliability): interimResults pasa de false → true
    // para habilitar la transcripción parcial en vivo. continuous se mantiene en false.
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());

    expect(result.current.status).toBe('listening');
    expect(result.current.isListening).toBe(true);

    const inst = MockSpeechRecognition.lastInstance!;
    expect(inst).not.toBeNull();
    expect(inst.start).toHaveBeenCalledTimes(1);
    expect(inst.lang).toBe('es-ES');
    expect(inst.interimResults).toBe(true);
    expect(inst.continuous).toBe(false);
    expect(inst.maxAlternatives).toBe(1);
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

  // REGRESIÓN (cambio de spec voice_reliability §Cambio 3): el fin natural SIN
  // captura ya no vuelve a "idle" sino a "error"/"no-speech" sintético (eso lo
  // cubren A4/A10). Este test conserva su intención original —el cierre natural
  // ORDENADO devuelve a "idle"— emitiendo una captura antes de emitEnd(), que es
  // el invariante que protegía. No solapa A4/A5/A10.
  it('onend natural TRAS captura devuelve a "idle" (acceptance #6)', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    expect(result.current.status).toBe('listening');

    act(() => MockSpeechRecognition.lastInstance!.emitFinalResult('Ana'));
    act(() => MockSpeechRecognition.lastInstance!.emitEnd());
    expect(result.current.status).toBe('idle');
    expect(result.current.isListening).toBe(false);
  });

  // REGRESIÓN (cambio de spec voice_reliability §Cambio 3, párrafo sobre stop()
  // manual): parar la sesión a propósito SIN captura también sintetiza no-speech
  // (stop() provoca un onend sin captura y onend no distingue el origen). El
  // invariante "stop() llama inst.stop() una vez" se mantiene; el estado tras el
  // onend sin captura pasa de "idle" (viejo) a "error"/"no-speech" (nuevo).
  it('stop() sin captura: llama instance.stop() una vez y tras onend sintetiza error/no-speech', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    const inst = MockSpeechRecognition.lastInstance!;

    act(() => result.current.stop());
    expect(inst.stop).toHaveBeenCalledTimes(1);

    act(() => inst.emitEnd());
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('no-speech');
  });

  // Variante que conserva el cierre a "idle": stop() TRAS haber capturado algo.
  // Mantiene explícito que parar ordenadamente con captura previa cierra en idle.
  it('stop() tras captura: llama instance.stop() una vez y tras onend queda "idle"', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    const inst = MockSpeechRecognition.lastInstance!;

    act(() => inst.emitFinalResult('Ana'));
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

/**
 * RED — voice_reliability (bloque A). Deriva de
 * `progress/voice_reliability/design.md` → "Contrato de tests para el tester
 * (RED antes de GREEN) — (A) Tests del HOOK" y "Criterios de aceptación
 * traducibles a tests".
 *
 * Fallan hasta que el hook: (1) fije `interimResults:true` e itere `onresult`
 * desde `resultIndex` emitiendo en cada evento parcial/final; (2) sintetice
 * `no-speech` en `onend` sin captura; (3) exponga `voiceUnavailable` con latch
 * al primer `network`. Todo se dispara sobre el mock del borde del sistema
 * (SpeechRecognition), nunca sobre la máquina de estados bajo prueba.
 *
 * `voiceUnavailable` es un campo NUEVO del retorno del hook (aún inexistente en
 * `UseVoiceInputResult`): se lee vía este accesor tipado para no romper el
 * typecheck mientras el RED está vigente. El GREEN añadirá el campo al contrato.
 */
function readVoiceUnavailable(result: { current: unknown }): boolean | undefined {
  return (result.current as { voiceUnavailable?: boolean }).voiceUnavailable;
}

describe('useVoiceInput — voice_reliability: parciales e iteración (A2, A3)', () => {
  beforeEach(installMock);
  afterEach(uninstallMock);

  // Caso A2. Los parciales de Chrome llegan con espacios antepuestos (' Ju'); el
  // nuevo onresult itera desde resultIndex y hace .trim() antes de emitir, así que
  // onResult recibe 'Ju' limpio. El lector de índice único SIN trim del código viejo
  // emitiría ' Ju' y falla esta aserción: es un RED real (no pasa por accidente).
  it('emite parciales con trim: emitInterimResult(" Ju") llama onResult("Ju") y actualiza transcript; el final lo refina', () => {
    const onResult = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onResult }));

    act(() => result.current.start());

    act(() => MockSpeechRecognition.lastInstance!.emitInterimResult(' Ju'));
    expect(onResult).toHaveBeenNthCalledWith(1, 'Ju');
    expect(result.current.transcript).toBe('Ju');

    act(() => MockSpeechRecognition.lastInstance!.emitFinalResult('Juan'));
    expect(onResult).toHaveBeenNthCalledWith(2, 'Juan');
    expect(result.current.transcript).toBe('Juan');

    expect(onResult).toHaveBeenCalledTimes(2);
  });

  // Caso A3
  it('itera desde resultIndex y concatena varios segmentos con trim: ["Hola ", "mundo"] → "Hola mundo"', () => {
    const onResult = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onResult }));

    act(() => result.current.start());
    act(() =>
      MockSpeechRecognition.lastInstance!.emitResults(
        [{ transcript: 'Hola ' }, { transcript: 'mundo' }],
        0,
      ),
    );

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith('Hola mundo');
    expect(result.current.transcript).toBe('Hola mundo');
  });
});

describe('useVoiceInput — voice_reliability: onend sin captura → no-speech sintético (A4, A5, A6, A10)', () => {
  beforeEach(installMock);
  afterEach(uninstallMock);

  // Caso A4
  it('onend SIN ninguna emisión ni error previo deja status="error" y errorCode="no-speech"', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitEnd());

    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('no-speech');
  });

  // Caso A5
  it('onend CON captura previa vuelve a "idle" y NO sintetiza no-speech (errorCode null)', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitFinalResult('Ana'));
    act(() => MockSpeechRecognition.lastInstance!.emitEnd());

    expect(result.current.status).toBe('idle');
    expect(result.current.errorCode).toBeNull();
  });

  // Caso A6
  it('un no-speech real (onerror) seguido de onend no se altera: sigue error/no-speech', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitError('no-speech'));
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('no-speech');

    act(() => MockSpeechRecognition.lastInstance!.emitEnd());
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('no-speech');
  });

  // Caso A10
  it('la marca de "hubo captura" se resetea por sesión: 1ª con captura (idle), 2ª sin captura → error/no-speech', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    // Sesión 1: capta algo y cierra en idle.
    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitFinalResult('Ana'));
    act(() => MockSpeechRecognition.lastInstance!.emitEnd());
    expect(result.current.status).toBe('idle');

    // Sesión 2: sin captura → debe sintetizar no-speech (no arrastra el true previo).
    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitEnd());
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('no-speech');
  });
});

describe('useVoiceInput — voice_reliability: latch voiceUnavailable por network (A7, A8, A9)', () => {
  beforeEach(installMock);
  afterEach(uninstallMock);

  // Caso A7
  it('voiceUnavailable arranca false y se activa al primer errorCode="network"', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    expect(readVoiceUnavailable(result)).toBe(false);

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitError('network'));

    expect(result.current.errorCode).toBe('network');
    expect(readVoiceUnavailable(result)).toBe(true);
  });

  // Caso A8
  it('el latch persiste tras reintentar: start() limpia errorCode a null pero voiceUnavailable sigue true', () => {
    const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

    act(() => result.current.start());
    act(() => MockSpeechRecognition.lastInstance!.emitError('network'));
    expect(readVoiceUnavailable(result)).toBe(true);

    act(() => result.current.start());
    expect(result.current.errorCode).toBeNull();
    expect(readVoiceUnavailable(result)).toBe(true);
  });

  // Caso A9
  it.each(['not-allowed', 'no-speech', 'audio-capture'])(
    'el error "%s" NO activa el latch: voiceUnavailable sigue false',
    (raw) => {
      const { result } = renderHook(() => useVoiceInput({ onResult: noop }));

      act(() => result.current.start());
      act(() => MockSpeechRecognition.lastInstance!.emitError(raw));

      expect(readVoiceUnavailable(result)).toBe(false);
    },
  );
});
