/**
 * Tests RED — features/welcome/NameField (motor de voz ÚNICO Groq, flujo
 * grabar→enviar en 2 clics). Feature voice_groq_default, design §5.2 (F1-F11) y
 * "Criterios de aceptación traducibles a tests" (§10).
 *
 * REWORK (ADR 23): se elimina el motor nativo (`useVoiceInput`) y la orquestación
 * nativo↔fallback. NameField pasa a consumir SOLO `useVoiceRecorder` (renombrado de
 * `useVoiceFallback`) y la UX del botón cambia a un flujo lineal de 2 pasos: el
 * icono refleja la acción del PRÓXIMO clic (micrófono en idle → "enviar" en
 * recording), con `aria-busy` mientras transcribe. Se elimina `aria-pressed`.
 *
 * Mapeo estado → botón (design §2):
 *   idle        → aria-label voice.startLabel      | clic ⇒ recorder.start()
 *   recording   → aria-label voice.listeningLabel  | clic ⇒ recorder.stop()  (sube a Groq)
 *   transcribing→ aria-label voice.transcribingLabel, aria-busy="true", disabled
 *   error       → aria-label voice.startLabel + texto de error en role="status"
 *
 * `NameField` es CONTROLADO: dueño del estado del nombre es el padre (WelcomeScreen).
 * Se le pasan `value`/`onChange`; el componente aplica el tope de 15 al llamar a
 * `onChange` (tanto por teclado como por voz). Se mockea SOLO `useVoiceRecorder`
 * (borde del sistema: getUserMedia/MediaRecorder/red), NO la lógica del contador/
 * límite/orquestación del botón bajo prueba. Todo se observa por rol/aria/texto de
 * marca — nunca por clase CSS ni literal. El icono "enviar" es SVG (aria-hidden):
 * se afirma indirectamente por el aria-label/estado del botón, NUNCA por su path.
 *
 * RED esperado: el `NameField` actual importa `useVoiceInput`/`useVoiceFallback` y
 * mantiene el flujo viejo (toggle + aria-pressed + ocultar mic por soporte). Este
 * test mockea `useVoiceRecorder` (que el componente aún no consume) y afirma el
 * flujo grabar→enviar nuevo → falla hasta la reescritura del componente.
 */
import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../../brand/ThemeProvider';
import { parseBrandConfig } from '../../../brand/core/schema';
import shopinbazSeed from '../../../brand/seeds/shopinbaz.json';
import { NameField } from './NameField';

// --- Mock del ÚNICO motor de voz (useVoiceRecorder). Controlable desde cada test. ---
interface RecorderMock {
  onResult: ((t: string) => void) | undefined;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  status: 'idle' | 'recording' | 'transcribing' | 'error';
  isRecording: boolean;
  isTranscribing: boolean;
  errorCode: 'permission-denied' | 'no-audio' | 'network' | 'unknown' | null;
}
const recorderMock = vi.hoisted<RecorderMock>(() => ({
  onResult: undefined,
  start: vi.fn(),
  stop: vi.fn(),
  status: 'idle',
  isRecording: false,
  isTranscribing: false,
  errorCode: null,
}));

vi.mock('../../../voice/useVoiceRecorder', () => ({
  useVoiceRecorder: (opts: { onResult: (t: string) => void }) => {
    // Guardamos el onResult del componente para simular la transcripción desde el test.
    recorderMock.onResult = opts.onResult;
    return {
      status: recorderMock.status,
      isRecording: recorderMock.isRecording,
      isTranscribing: recorderMock.isTranscribing,
      errorCode: recorderMock.errorCode,
      start: recorderMock.start,
      stop: recorderMock.stop,
    };
  },
}));

const brand = parseBrandConfig(shopinbazSeed);

function resetRecorder(): void {
  recorderMock.status = 'idle';
  recorderMock.isRecording = false;
  recorderMock.isTranscribing = false;
  recorderMock.errorCode = null;
  recorderMock.start.mockClear();
  recorderMock.stop.mockClear();
}

/** Wrapper controlado: mantiene el estado y lo expone al test para afirmar. */
function renderNameField(initial = '') {
  let current = initial;
  const onChange = vi.fn((next: string) => {
    current = next;
  });

  const utils = render(
    <ThemeProvider config={brand}>
      <NameField value={current} onChange={onChange} />
    </ThemeProvider>,
  );

  // Rerender con el valor actualizado (componente controlado).
  const rerender = () =>
    utils.rerender(
      <ThemeProvider config={brand}>
        <NameField value={current} onChange={onChange} />
      </ThemeProvider>,
    );

  return { ...utils, onChange, getValue: () => current, rerender };
}

/**
 * Wrapper con estado REAL de React: el input controlado refleja cada pulsación
 * (a diferencia de `renderNameField`, que no re-renderiza entre teclas). Se usa
 * para las regresiones del teclado, donde importa el valor acumulado del input.
 * Devuelve el spy de `onChange` para afirmar el último valor propagado.
 */
function renderStatefulNameField(initial = ''): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  function Stateful() {
    const [name, setName] = useState(initial);
    return (
      <NameField
        value={name}
        onChange={(next) => {
          onChange(next);
          setName(next);
        }}
      />
    );
  }
  render(
    <ThemeProvider config={brand}>
      <Stateful />
    </ThemeProvider>,
  );
  return onChange;
}

describe('NameField — contador y límite de 15 (acceptance #9, #7)', () => {
  beforeEach(resetRecorder);
  afterEach(() => vi.clearAllMocks());

  // F9
  it('muestra el contador inicial "0/15 caracteres" desde counterTemplate', () => {
    renderNameField('');
    expect(screen.getByText('0/15 caracteres')).toBeInTheDocument();
  });

  // F9
  it('el contador refleja el largo actual del nombre (interpola {count}): "3/15 caracteres" con "Ana"', () => {
    renderNameField('Ana');
    expect(screen.getByText('3/15 caracteres')).toBeInTheDocument();
  });

  // F8
  it('escribir texto propaga el valor a onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = renderNameField('');
    await user.type(screen.getByRole('textbox'), 'A');
    expect(onChange).toHaveBeenCalledWith('A');
  });

  // F8
  it('el input aplica maxLength=15 en el DOM', () => {
    renderNameField('');
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '15');
  });

  // F7 — la transcripción del motor con >15 chars se recorta a 15 antes de onChange.
  it('el dictado (recorder.onResult) con un texto de más de 15 caracteres se trunca a 15', () => {
    const { onChange } = renderNameField('');
    recorderMock.onResult?.('NombreLarguísimoDeMás');
    expect(onChange).toHaveBeenCalledWith('NombreLarguísim'); // exactamente 15 chars
    expect((onChange.mock.calls.at(-1)?.[0] as string).length).toBe(15);
  });

  // F7 — el dictado rellena el mismo estado que la escritura manual (sin clamp cuando cabe).
  it('el dictado (recorder.onResult) rellena el mismo estado que la escritura manual', () => {
    const { onChange } = renderNameField('');
    recorderMock.onResult?.('Lucía');
    expect(onChange).toHaveBeenCalledWith('Lucía');
  });

  // F8 — el input manual funciona incluso con el motor transcribiendo.
  it('el input manual sigue propagando a onChange aunque el recorder esté transcribiendo', async () => {
    const user = userEvent.setup();
    recorderMock.status = 'transcribing';
    recorderMock.isTranscribing = true;
    const { onChange } = renderNameField('');
    await user.type(screen.getByRole('textbox'), 'A');
    expect(onChange).toHaveBeenCalledWith('A');
  });
});

/**
 * RED — auto-envío por detección de silencio (feature voice_auto_send, design T3).
 * El motor está mockeado: simulamos la ruta (a) "habló y calló" invocando el
 * `onResult` que el componente registró, SIN disparar un segundo click. El campo
 * debe rellenarse (con el clamp de 15) igual que el 2º clic manual, y el input
 * manual debe seguir intacto. Cero literales: los textos salen de la marca.
 */
describe('NameField — auto-envío del dictado sin 2º clic (voice_auto_send T3.a)', () => {
  beforeEach(resetRecorder);
  afterEach(() => vi.clearAllMocks());

  it('el auto-envío (onResult) rellena el campo SIN un 2º clic (no se llama a stop())', () => {
    const { onChange } = renderNameField('');
    // Simula la ruta (a): el motor detecta el silencio y emite el texto por su cuenta.
    recorderMock.onResult?.('Ana');
    expect(onChange).toHaveBeenCalledWith('Ana');
    // El auto-envío NO pasa por el click de "enviar": stop() no lo dispara el componente.
    expect(recorderMock.stop).not.toHaveBeenCalled();
  });

  it('el auto-envío respeta el clamp de 15 (texto largo se trunca a 15)', () => {
    const { onChange } = renderNameField('');
    recorderMock.onResult?.('NombreLarguísimoDeMás');
    expect(onChange).toHaveBeenCalledWith('NombreLarguísim');
    expect((onChange.mock.calls.at(-1)?.[0] as string).length).toBe(15);
  });

  it('el 2º clic manual sigue funcionando: en recording el botón llama a stop()', async () => {
    const user = userEvent.setup();
    recorderMock.status = 'recording';
    recorderMock.isRecording = true;
    renderNameField('');
    await user.click(screen.getByRole('button', { name: brand.voice.listeningLabel }));
    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
  });

  it('el input manual sigue intacto tras un auto-envío previo', async () => {
    const user = userEvent.setup();
    const { onChange } = renderNameField('');
    recorderMock.onResult?.('Ana');
    onChange.mockClear();
    await user.type(screen.getByRole('textbox'), 'B');
    expect(onChange).toHaveBeenCalledWith('B');
  });

  it('el caso no-speech del auto-envío muestra voice.noSpeech en role="status" (regresión)', () => {
    recorderMock.status = 'error';
    recorderMock.errorCode = 'no-audio';
    renderNameField('');
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.noSpeech);
  });
});

/**
 * RED — limpieza de puntuación de borde SOLO en el dictado (decisión del usuario,
 * 2026-07-05). Whisper/Groq añade puntuación automática ("Juan" → "Juan."), así que
 * el camino del DICTADO (`onResult`) debe sanitizar los signos de borde antes del
 * clamp de 15. El corazón del cambio es el CONTRASTE: el dictado limpia, el teclado
 * NO (si el usuario escribe un punto a mano, es su decisión). El motor sigue mockeado
 * (cero red/audio): se simula la transcripción invocando el `onResult` registrado.
 *
 * RED esperado: `applyName` hoy hace `onChange(clampToMax(transcript))` sin sanitizar,
 * así que el dictado "Juan." propaga "Juan." (con punto) → el test que espera "Juan"
 * falla. Los tests del teclado ya pasan (el teclado no debe cambiar) y sirven de
 * ancla de regresión.
 */
describe('NameField — sanitización de puntuación del dictado (decisión 2026-07-05)', () => {
  beforeEach(resetRecorder);
  afterEach(() => vi.clearAllMocks());

  it('el DICTADO limpia el punto final de Whisper: onResult("Juan.") propaga "Juan"', () => {
    const { onChange } = renderNameField('');
    recorderMock.onResult?.('Juan.');
    expect(onChange).toHaveBeenCalledWith('Juan');
  });

  it('el DICTADO limpia los signos de borde: onResult("¿María?") propaga "María"', () => {
    const { onChange } = renderNameField('');
    recorderMock.onResult?.('¿María?');
    expect(onChange).toHaveBeenCalledWith('María');
  });

  it('el DICTADO conserva el espacio interno y limpia el borde: onResult("  José María.  ") → "José María"', () => {
    const { onChange } = renderNameField('');
    recorderMock.onResult?.('  José María.  ');
    expect(onChange).toHaveBeenCalledWith('José María');
  });

  it('el DICTADO sanitiza ANTES del clamp: onResult(" NombreLarguísimoDeMás. ") se limpia y luego trunca a 15', () => {
    const { onChange } = renderNameField('');
    recorderMock.onResult?.(' NombreLarguísimoDeMás. ');
    // Primero se quitan el punto y los espacios de borde, luego se recorta a 15.
    expect(onChange).toHaveBeenCalledWith('NombreLarguísim');
    expect((onChange.mock.calls.at(-1)?.[0] as string).length).toBe(15);
  });

  // REGRESIÓN CLAVE — el TECLADO NO limpia: escribir "Juan." a mano deja el punto.
  // Se usa un wrapper con estado REAL (StatefulNameField) para que el input
  // controlado refleje cada pulsación; el andamiaje `renderNameField` no
  // re-renderiza entre teclas y solo registraría el último carácter.
  it('el TECLADO NO limpia la puntuación: escribir "Juan." deja "Juan." (con el punto)', async () => {
    const user = userEvent.setup();
    const onChange = renderStatefulNameField();
    await user.type(screen.getByRole('textbox'), 'Juan.');
    // El input controlado termina con el punto que el usuario escribió a mano.
    expect(screen.getByRole('textbox')).toHaveValue('Juan.');
    // El último onChange del teclado conserva el punto final del usuario.
    expect(onChange).toHaveBeenLastCalledWith('Juan.');
  });

  // REGRESIÓN — el teclado propaga un punto suelto tal cual (no se sanitiza el borde).
  it('el TECLADO NO limpia un punto inicial: escribir "." deja "." (no lo colapsa a vacío)', async () => {
    const user = userEvent.setup();
    const onChange = renderStatefulNameField();
    await user.type(screen.getByRole('textbox'), '.');
    expect(screen.getByRole('textbox')).toHaveValue('.');
    expect(onChange).toHaveBeenLastCalledWith('.');
  });
});

describe('NameField — textos de marca base (acceptance #1, #2)', () => {
  beforeEach(resetRecorder);
  afterEach(() => vi.clearAllMocks());

  it('el placeholder del input viene de la config de marca (cero literal)', () => {
    renderNameField('');
    expect(screen.getByPlaceholderText(brand.text.inputPlaceholder)).toBeInTheDocument();
  });

  // F11 — el botón de mic (idle) expone el aria-label de arranque de marca.
  it('el botón de voz expone el aria-label de marca (voice.startLabel) en idle', () => {
    renderNameField('');
    expect(screen.getByRole('button', { name: brand.voice.startLabel })).toBeInTheDocument();
  });
});

/**
 * RED — flujo grabar→enviar en 2 clics (design §2, F1-F6, F11). El icono "enviar"
 * es SVG aria-hidden: se afirma por el aria-label/estado del botón, nunca por forma.
 */
describe('NameField — flujo grabar→enviar (F1, F3, F11)', () => {
  beforeEach(resetRecorder);
  afterEach(() => vi.clearAllMocks());

  // F1 — clic 1 en idle: graba.
  it('idle: pulsar el botón (startLabel) llama recorder.start() una vez y no stop()', async () => {
    const user = userEvent.setup();
    renderNameField('');
    await user.click(screen.getByRole('button', { name: brand.voice.startLabel }));
    expect(recorderMock.start).toHaveBeenCalledTimes(1);
    expect(recorderMock.stop).not.toHaveBeenCalled();
  });

  // F3 — clic 2 en recording: para y sube.
  it('recording: pulsar el botón (listeningLabel) llama recorder.stop() una vez y no start()', async () => {
    const user = userEvent.setup();
    recorderMock.status = 'recording';
    recorderMock.isRecording = true;
    renderNameField('');
    await user.click(screen.getByRole('button', { name: brand.voice.listeningLabel }));
    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
    expect(recorderMock.start).not.toHaveBeenCalled();
  });

  // F11 — el botón de mic se renderiza SIEMPRE en idle (ya no se oculta por soporte).
  it('el botón de mic (startLabel) se renderiza en idle (grabar disponible en todo navegador)', () => {
    renderNameField('');
    expect(screen.getByRole('button', { name: brand.voice.startLabel })).toBeInTheDocument();
  });
});

describe('NameField — el icono/aria refleja el estado del motor (F2, F6)', () => {
  beforeEach(resetRecorder);
  afterEach(() => vi.clearAllMocks());

  // F2 — en recording el botón cambia su aria-label a listeningLabel (icono "enviar").
  it('recording: el botón expone aria-label=listeningLabel (icono enviar), NO startLabel', () => {
    recorderMock.status = 'recording';
    recorderMock.isRecording = true;
    renderNameField('');
    expect(screen.getByRole('button', { name: brand.voice.listeningLabel })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: brand.voice.startLabel })).not.toBeInTheDocument();
  });

  // F5/F2 — en recording la región de estado (bajo el input) muestra listeningLabel.
  it('recording: se muestra el texto de marca listeningLabel bajo el input', () => {
    recorderMock.status = 'recording';
    recorderMock.isRecording = true;
    renderNameField('');
    expect(screen.getByText(brand.voice.listeningLabel)).toBeInTheDocument();
  });

  // F6 — idle sin error: el botón vuelve al startLabel y no hay texto de estado en vivo.
  it('idle: el botón usa startLabel y el listeningLabel NO está visible', () => {
    renderNameField('');
    expect(screen.getByRole('button', { name: brand.voice.startLabel })).toBeInTheDocument();
    expect(screen.queryByText(brand.voice.listeningLabel)).not.toBeInTheDocument();
  });

  // F5/F2 — el botón NO expone aria-pressed (ya no es toggle; design §2).
  it('el botón de voz NO expone aria-pressed (flujo lineal, no toggle)', () => {
    renderNameField('');
    const idleButton = screen.getByRole('button', { name: brand.voice.startLabel });
    expect(idleButton).not.toHaveAttribute('aria-pressed');

    recorderMock.status = 'recording';
    recorderMock.isRecording = true;
    const { rerender } = renderNameField('');
    rerender();
    const recButton = screen.getByRole('button', { name: brand.voice.listeningLabel });
    expect(recButton).not.toHaveAttribute('aria-pressed');
  });
});

describe('NameField — estado transcribing: aria-busy y bloqueo (F4)', () => {
  beforeEach(resetRecorder);
  afterEach(() => vi.clearAllMocks());

  // F4 — transcribing: muestra transcribingLabel, aria-busy y disabled.
  it('transcribing: muestra voice.transcribingLabel y el botón queda aria-busy="true" y disabled', () => {
    recorderMock.status = 'transcribing';
    recorderMock.isTranscribing = true;
    renderNameField('');
    expect(screen.getByText(brand.voice.transcribingLabel)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: brand.voice.transcribingLabel });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });

  // F4 — un clic mientras transcribe no dispara start ni stop.
  it('transcribing: pulsar el botón NO llama start() ni stop()', async () => {
    const user = userEvent.setup();
    recorderMock.status = 'transcribing';
    recorderMock.isTranscribing = true;
    renderNameField('');
    await user.click(screen.getByRole('button', { name: brand.voice.transcribingLabel }));
    expect(recorderMock.start).not.toHaveBeenCalled();
    expect(recorderMock.stop).not.toHaveBeenCalled();
  });
});

describe('NameField — errores del motor en la región role="status" (F5)', () => {
  beforeEach(() => {
    resetRecorder();
    recorderMock.status = 'error';
  });
  afterEach(() => vi.clearAllMocks());

  // F5 — permission-denied → voice.permissionDenied
  it('permission-denied → voice.permissionDenied en role="status"', () => {
    recorderMock.errorCode = 'permission-denied';
    renderNameField('');
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.permissionDenied);
  });

  // F5 — no-audio → voice.noSpeech
  it('no-audio → voice.noSpeech en role="status"', () => {
    recorderMock.errorCode = 'no-audio';
    renderNameField('');
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.noSpeech);
  });

  // F5 — network → voice.genericError
  it('network → voice.genericError en role="status"', () => {
    recorderMock.errorCode = 'network';
    renderNameField('');
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.genericError);
  });

  // F5 — unknown → voice.genericError
  it('unknown → voice.genericError en role="status"', () => {
    recorderMock.errorCode = 'unknown';
    renderNameField('');
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.genericError);
  });

  // F5 — en error el botón vuelve visualmente a idle (startLabel), listo para reintentar.
  it('error: el botón vuelve al aria-label startLabel (reintento con start)', () => {
    recorderMock.errorCode = 'network';
    renderNameField('');
    expect(screen.getByRole('button', { name: brand.voice.startLabel })).toBeInTheDocument();
  });
});

describe('NameField — F6: idle sin error de voz', () => {
  beforeEach(resetRecorder);
  afterEach(() => vi.clearAllMocks());

  it('idle: ningún texto de error de voz está presente', () => {
    renderNameField('');
    expect(screen.queryByText(brand.voice.permissionDenied)).not.toBeInTheDocument();
    expect(screen.queryByText(brand.voice.noSpeech)).not.toBeInTheDocument();
    expect(screen.queryByText(brand.voice.genericError)).not.toBeInTheDocument();
  });
});

/**
 * F10 — regresión white-label. Con OTRA marca (textos de voz distintos a los del
 * seed shopinbaz), el aria-label, la etiqueta de estado y el texto de error se
 * observan por los textos de ESA marca; los de shopinbaz no se filtran. Si el
 * componente hardcodeara un literal, este test —con textos de marca diferentes—
 * fallaría.
 */
describe('NameField — white-label / cero literal (F10)', () => {
  const otherBrand = parseBrandConfig({
    key: 'otra',
    name: 'Otra',
    voice: {
      startLabel: 'Habla tu nombre aquí',
      listeningLabel: 'Te estamos oyendo',
      transcribingLabel: 'Procesando tu voz (otra marca)',
      permissionDenied: 'Micrófono bloqueado por la otra marca',
      noSpeech: 'No captamos audio (otra marca)',
      genericError: 'Fallo de dictado (otra marca)',
    },
  });

  function renderWithBrand(brandConfig: typeof otherBrand) {
    return render(
      <ThemeProvider config={brandConfig}>
        <NameField value="" onChange={vi.fn()} />
      </ThemeProvider>,
    );
  }

  beforeEach(resetRecorder);
  afterEach(() => vi.clearAllMocks());

  it('idle: el aria-label de arranque proviene de la marca activa (no de un literal)', () => {
    renderWithBrand(otherBrand);
    expect(screen.getByRole('button', { name: otherBrand.voice.startLabel })).toBeInTheDocument();
    // No se filtra el startLabel de la marca del seed (shopinbaz).
    expect(screen.queryByRole('button', { name: brand.voice.startLabel })).not.toBeInTheDocument();
  });

  it('recording: la etiqueta de escucha proviene de la marca activa', () => {
    recorderMock.status = 'recording';
    recorderMock.isRecording = true;
    renderWithBrand(otherBrand);
    expect(screen.getByText(otherBrand.voice.listeningLabel)).toBeInTheDocument();
  });

  it('transcribing: la etiqueta de proceso proviene de la marca activa', () => {
    recorderMock.status = 'transcribing';
    recorderMock.isTranscribing = true;
    renderWithBrand(otherBrand);
    expect(screen.getByText(otherBrand.voice.transcribingLabel)).toBeInTheDocument();
  });

  it('error: el texto de error proviene de la marca activa', () => {
    recorderMock.status = 'error';
    recorderMock.errorCode = 'permission-denied';
    renderWithBrand(otherBrand);
    expect(screen.getByRole('status')).toHaveTextContent(otherBrand.voice.permissionDenied);
  });
});

/**
 * RED — feedback de longitud al alcanzar el límite (voice_auto_send, ADR 25).
 *
 * El límite del nombre es FIJO en 15 (NAME_MAX_LENGTH). Cuando `value.length` llega
 * a 15 —da igual si llegó por TECLADO o por DICTADO, ambos recortan a 15 vía
 * clampToMax— la UI muestra un AVISO de longitud UNIFICADO con el texto de marca
 * `text.maxLengthReached`, interpolando `{max}` a 15 (mismo patrón que
 * counterTemplate). Con value < 15 el aviso NO aparece.
 *
 * El aviso debe convivir con la región de error de VOZ (role="status") sin taparla:
 * si hay un errorCode de voz, ese texto sigue visible; con value corto y sin error,
 * no hay ninguno de los dos.
 *
 * Cero literales: el aviso se observa por el texto de marca resuelto
 * (`brand.text.maxLengthReached` con {max}→15), nunca por un string hardcodeado.
 * El white-label se verifica con OTRA marca (otherBrand) que define su propio copy.
 *
 * RED esperado: el schema aún no tiene `text.maxLengthReached` (parseBrandConfig lo
 * deja `undefined`) y NameField no renderiza ningún aviso al tope → estos tests
 * fallan por comportamiento/símbolo ausente, no por sintaxis del test.
 */
describe('NameField — feedback de longitud al límite (voice_auto_send, ADR 25)', () => {
  beforeEach(resetRecorder);
  afterEach(() => vi.clearAllMocks());

  /**
   * Resuelve el texto de marca del aviso con {max}→15 (mismo interpolado que el
   * componente). Tolera que el schema aún no exponga `maxLengthReached` (RED de la
   * capa schema): en ese caso usa el default esperado del ADR 25, de modo que el
   * fallo del test sea por AUSENCIA del aviso en el DOM (comportamiento de
   * NameField), no por un TypeError en este helper.
   */
  function maxReachedText(brandConfig: typeof brand): string {
    const template = brandConfig.text.maxLengthReached ?? 'Máximo {max} caracteres';
    return template.replace('{max}', '15');
  }

  it('con value de 15 caracteres (tope alcanzado) muestra el aviso text.maxLengthReached con {max}→15', () => {
    renderNameField('QuinceCaracter1'); // exactamente 15 chars
    expect(screen.getByText(maxReachedText(brand))).toBeInTheDocument();
  });

  it('con value < 15 NO muestra el aviso de longitud', () => {
    renderNameField('Ana'); // 3 chars
    expect(screen.queryByText(maxReachedText(brand))).not.toBeInTheDocument();
  });

  // Unificado — camino TECLADO: escribir un string largo → clampToMax deja 15 → aviso.
  it('unificado (teclado): escribir un nombre que supera el tope deja 15 y muestra el aviso', async () => {
    const user = userEvent.setup();
    renderStatefulNameField();
    await user.type(screen.getByRole('textbox'), 'NombreDemasiadoLargoParaElCampo');
    // El input controlado quedó recortado a 15 por maxLength/clamp.
    expect(screen.getByRole('textbox')).toHaveValue('NombreDemasiado'); // 15 chars
    expect(screen.getByText(maxReachedText(brand))).toBeInTheDocument();
  });

  // Unificado — camino DICTADO: onResult con string largo → clamp a 15 → mismo aviso.
  it('unificado (dictado): onResult con un texto que supera el tope deja 15 y muestra el aviso', () => {
    // El wrapper stateful refleja en el input el value que propaga applyName.
    const onChange = renderStatefulNameField();
    // onResult → applyName → onChange → setName actualiza el estado del wrapper:
    // se envuelve en act() para que React flushee el re-render antes de afirmar
    // (mismo patrón que el bloque de useVoiceRecorder). onResult→onChange es
    // síncrono, así que basta un act() síncrono.
    act(() => {
      recorderMock.onResult?.('NombreLarguísimoDeMás');
    });
    // El dictado recortó a 15 (sanitiza + clamp).
    expect((onChange.mock.calls.at(-1)?.[0] as string).length).toBe(15);
    expect(screen.getByText(maxReachedText(brand))).toBeInTheDocument();
  });

  // Regresión — el aviso de longitud NO tapa el error de voz existente.
  it('regresión: con value al tope Y un error de voz, ambos textos siguen visibles', () => {
    recorderMock.status = 'error';
    recorderMock.errorCode = 'permission-denied';
    renderNameField('QuinceCaracter1'); // 15 chars
    // El error de voz sigue en su región role="status".
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.permissionDenied);
    // Y el aviso de longitud también está presente, sin taparlo.
    expect(screen.getByText(maxReachedText(brand))).toBeInTheDocument();
  });

  // Regresión — value corto y sin error: no aparece ni el aviso ni el error.
  it('regresión: con value corto y sin error de voz, no hay aviso de longitud ni error', () => {
    renderNameField('Ana');
    expect(screen.queryByText(maxReachedText(brand))).not.toBeInTheDocument();
    expect(screen.queryByText(brand.voice.permissionDenied)).not.toBeInTheDocument();
    expect(screen.queryByText(brand.voice.noSpeech)).not.toBeInTheDocument();
    expect(screen.queryByText(brand.voice.genericError)).not.toBeInTheDocument();
  });

  // White-label — el aviso se observa por el copy de OTRA marca, no por un literal.
  it('white-label: el aviso al tope usa el text.maxLengthReached de la marca activa (cero literal)', () => {
    const otherBrand = parseBrandConfig({
      key: 'otra',
      name: 'Otra',
      text: { maxLengthReached: 'No más de {max} caracteres, por favor' },
    });
    render(
      <ThemeProvider config={otherBrand}>
        <NameField value="QuinceCaracter1" onChange={vi.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByText(maxReachedText(otherBrand))).toBeInTheDocument();
    // El copy del seed shopinbaz no se filtra.
    expect(screen.queryByText(maxReachedText(brand))).not.toBeInTheDocument();
  });
});
