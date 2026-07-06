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
import { render, screen } from '@testing-library/react';
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
