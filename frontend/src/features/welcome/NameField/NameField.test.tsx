/**
 * Tests RED — features/welcome/NameField.
 *
 * Deriva de welcome_screen (acceptance #2 de feature_list.json y "Límite / contador"
 * y "Voz" del plan de testeo de design.md):
 *  - El input está limitado a 15 caracteres (DOM + recorte defensivo en el handler).
 *  - El contador se renderiza desde `text.counterTemplate` interpolando {count}/{max};
 *    estado inicial "0/15 caracteres" como en las maquetas.
 *  - El dictado por voz (onResult de useVoiceInput) rellena el mismo estado y también
 *    se trunca a 15.
 *  - Botón de voz con aria-label de marca (`voice.startLabel`), degradación elegante
 *    si no hay soporte.
 *  - Cero literales de marca en el componente: placeholder, contador y label de voz
 *    salen de la config.
 *
 * `NameField` es CONTROLADO: dueño del estado del nombre es el padre (WelcomeScreen).
 * Se le pasan `value`/`onChange`; el componente aplica el tope de 15 al llamar a
 * `onChange` (tanto por teclado como por voz). Se mockea `useVoiceInput` (borde del
 * sistema: la SpeechRecognition API), NO la lógica del contador/límite bajo prueba.
 *
 * RED esperado: `./NameField` aún no existe → import falla, tests en rojo.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../../brand/ThemeProvider';
import { parseBrandConfig } from '../../../brand/core/schema';
import shopinbazSeed from '../../../brand/seeds/shopinbaz.json';
import { NameField } from './NameField';

// --- Mock del hook de voz (borde del sistema). Controlable desde cada test. ---
type VoiceStatus = 'unsupported' | 'idle' | 'listening' | 'error';
interface VoiceMock {
  onResult: ((t: string) => void) | undefined;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  status: VoiceStatus;
  isSupported: boolean;
  isListening: boolean;
  errorCode: string | null;
  transcript: string;
  // voice_reliability: latch de sesión que oculta el mic tras un 'network'.
  voiceUnavailable: boolean;
}
const voiceMock = vi.hoisted<VoiceMock>(() => ({
  onResult: undefined,
  start: vi.fn(),
  stop: vi.fn(),
  status: 'idle',
  isSupported: true,
  isListening: false,
  errorCode: null,
  transcript: '',
  voiceUnavailable: false,
}));

vi.mock('../../../voice/useVoiceInput', () => ({
  useVoiceInput: (opts: { onResult: (t: string) => void }) => {
    // Guardamos el onResult del componente para simular el dictado desde el test.
    voiceMock.onResult = opts.onResult;
    return {
      status: voiceMock.status,
      isSupported: voiceMock.isSupported,
      isListening: voiceMock.isListening,
      errorCode: voiceMock.errorCode,
      transcript: voiceMock.transcript,
      start: voiceMock.start,
      stop: voiceMock.stop,
      voiceUnavailable: voiceMock.voiceUnavailable,
    };
  },
}));

const brand = parseBrandConfig(shopinbazSeed);

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

describe('NameField — contador y límite de 15 (acceptance #2)', () => {
  beforeEach(() => {
    voiceMock.status = 'idle';
    voiceMock.isSupported = true;
    voiceMock.isListening = false;
    voiceMock.errorCode = null;
    voiceMock.voiceUnavailable = false;
    voiceMock.start.mockClear();
    voiceMock.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('muestra el contador inicial "0/15 caracteres" desde counterTemplate', () => {
    renderNameField('');
    expect(screen.getByText('0/15 caracteres')).toBeInTheDocument();
  });

  it('el contador refleja el largo actual del nombre (interpola {count})', () => {
    renderNameField('Ana');
    expect(screen.getByText('3/15 caracteres')).toBeInTheDocument();
  });

  it('escribir texto propaga el valor a onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = renderNameField('');
    await user.type(screen.getByRole('textbox'), 'A');
    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('el input aplica maxLength=15 en el DOM', () => {
    renderNameField('');
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '15');
  });

  it('el dictado por voz con un texto de más de 15 caracteres se trunca a 15', () => {
    const { onChange } = renderNameField('');
    // Simula la transcripción final entregada por useVoiceInput.
    voiceMock.onResult?.('NombreLarguísimoDeMás');
    expect(onChange).toHaveBeenCalledWith('NombreLarguísim'); // exactamente 15 chars
    expect((onChange.mock.calls.at(-1)?.[0] as string).length).toBe(15);
  });

  it('el dictado por voz rellena el mismo estado que la escritura manual', () => {
    const { onChange } = renderNameField('');
    voiceMock.onResult?.('Lucía');
    expect(onChange).toHaveBeenCalledWith('Lucía');
  });
});

describe('NameField — botón de voz y textos de marca (acceptance #1, voz)', () => {
  beforeEach(() => {
    voiceMock.status = 'idle';
    voiceMock.isSupported = true;
    voiceMock.isListening = false;
    voiceMock.errorCode = null;
    voiceMock.voiceUnavailable = false;
    voiceMock.start.mockClear();
    voiceMock.stop.mockClear();
  });

  it('el placeholder del input viene de la config de marca (cero literal)', () => {
    renderNameField('');
    expect(screen.getByPlaceholderText(brand.text.inputPlaceholder)).toBeInTheDocument();
  });

  it('el botón de voz expone el aria-label de marca (voice.startLabel)', () => {
    renderNameField('');
    expect(screen.getByRole('button', { name: brand.voice.startLabel })).toBeInTheDocument();
  });

  it('pulsar el botón de voz arranca el reconocimiento (start)', async () => {
    const user = userEvent.setup();
    renderNameField('');
    await user.click(screen.getByRole('button', { name: brand.voice.startLabel }));
    expect(voiceMock.start).toHaveBeenCalledTimes(1);
  });

  it('sin soporte de voz degrada con elegancia: no rompe el formulario (input sigue presente)', () => {
    voiceMock.isSupported = false;
    voiceMock.status = 'unsupported';
    renderNameField('');
    // El input manual sigue disponible aunque la voz no esté soportada.
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});

/**
 * RED — voice_ux. Cablea el resto de la API del hook (`isListening`/`status`/
 * `errorCode`/`stop`) que hoy `NameField` ignora: toggle start↔stop, aria-label
 * conmutado + aria-pressed, indicación de escucha, errores→texto de marca en una
 * región aria-live, y no-soporte comunicado en el botón. Casos 1-15 del design
 * "Criterios de aceptación traducibles a tests". Todo se observa por rol/aria/
 * texto de marca (nunca por clase CSS de color ni string hardcodeado).
 */
describe('NameField — UX de voz: toggle start↔stop (voice_ux casos 1-4)', () => {
  beforeEach(() => {
    voiceMock.status = 'idle';
    voiceMock.isSupported = true;
    voiceMock.isListening = false;
    voiceMock.errorCode = null;
    voiceMock.voiceUnavailable = false;
    voiceMock.start.mockClear();
    voiceMock.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Caso 1
  it('idle (isListening=false): pulsar el botón llama start() una vez y no stop()', async () => {
    const user = userEvent.setup();
    renderNameField('');
    await user.click(screen.getByRole('button', { name: brand.voice.startLabel }));
    expect(voiceMock.start).toHaveBeenCalledTimes(1);
    expect(voiceMock.stop).not.toHaveBeenCalled();
  });

  // Caso 2
  it('escuchando (isListening=true): pulsar el botón llama stop() una vez y no start()', async () => {
    const user = userEvent.setup();
    voiceMock.status = 'listening';
    voiceMock.isListening = true;
    renderNameField('');
    await user.click(screen.getByRole('button', { name: brand.voice.listeningLabel }));
    expect(voiceMock.stop).toHaveBeenCalledTimes(1);
    expect(voiceMock.start).not.toHaveBeenCalled();
  });

  // Caso 3
  it('escuchando: el botón expone aria-label=listeningLabel y aria-pressed="true"', () => {
    voiceMock.status = 'listening';
    voiceMock.isListening = true;
    renderNameField('');
    const button = screen.getByRole('button', { name: brand.voice.listeningLabel });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  // Caso 4
  it('idle: el botón expone aria-label=startLabel y aria-pressed="false"', () => {
    renderNameField('');
    const button = screen.getByRole('button', { name: brand.voice.startLabel });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('NameField — UX de voz: indicación de escucha (voice_ux casos 5-6)', () => {
  beforeEach(() => {
    voiceMock.status = 'idle';
    voiceMock.isSupported = true;
    voiceMock.isListening = false;
    voiceMock.errorCode = null;
    voiceMock.voiceUnavailable = false;
    voiceMock.start.mockClear();
    voiceMock.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Caso 5
  it('status=listening: muestra en pantalla el texto de marca listeningLabel', () => {
    voiceMock.status = 'listening';
    voiceMock.isListening = true;
    renderNameField('');
    expect(screen.getByText(brand.voice.listeningLabel)).toBeInTheDocument();
  });

  // Caso 6
  it('status=idle: listeningLabel NO está en el documento como texto visible', () => {
    renderNameField('');
    expect(screen.queryByText(brand.voice.listeningLabel)).not.toBeInTheDocument();
  });
});

describe('NameField — UX de voz: errores → texto de marca en aria-live (voice_ux casos 7-12)', () => {
  beforeEach(() => {
    voiceMock.status = 'idle';
    voiceMock.isSupported = true;
    voiceMock.isListening = false;
    voiceMock.errorCode = null;
    voiceMock.voiceUnavailable = false;
    voiceMock.start.mockClear();
    voiceMock.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Caso 7
  it('error not-allowed: la región role="status" muestra voice.permissionDenied', () => {
    voiceMock.status = 'error';
    voiceMock.errorCode = 'not-allowed';
    renderNameField('');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(brand.voice.permissionDenied);
  });

  // Caso 8
  it('error no-speech: la región role="status" muestra voice.noSpeech', () => {
    voiceMock.status = 'error';
    voiceMock.errorCode = 'no-speech';
    renderNameField('');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(brand.voice.noSpeech);
  });

  // Caso 9
  it('error audio-capture: la región role="status" muestra voice.genericError', () => {
    voiceMock.status = 'error';
    voiceMock.errorCode = 'audio-capture';
    renderNameField('');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(brand.voice.genericError);
  });

  // Caso 10
  it('error network: la región role="status" muestra voice.genericError', () => {
    voiceMock.status = 'error';
    voiceMock.errorCode = 'network';
    renderNameField('');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(brand.voice.genericError);
  });

  // Caso 11
  it('error unknown: la región role="status" muestra voice.genericError', () => {
    voiceMock.status = 'error';
    voiceMock.errorCode = 'unknown';
    renderNameField('');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(brand.voice.genericError);
  });

  // Caso 12
  it('idle sin errorCode: ningún texto de error de voz está presente', () => {
    renderNameField('');
    expect(screen.queryByText(brand.voice.permissionDenied)).not.toBeInTheDocument();
    expect(screen.queryByText(brand.voice.noSpeech)).not.toBeInTheDocument();
    expect(screen.queryByText(brand.voice.genericError)).not.toBeInTheDocument();
  });
});

describe('NameField — UX de voz: no-soporte (voice_ux casos 13-14, actualizados por voice_reliability)', () => {
  beforeEach(() => {
    voiceMock.status = 'idle';
    voiceMock.isSupported = true;
    voiceMock.isListening = false;
    voiceMock.errorCode = null;
    voiceMock.voiceUnavailable = false;
    voiceMock.start.mockClear();
    voiceMock.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Caso 13 — REGRESIÓN (cambio de spec voice_reliability: de "deshabilitar" a "ocultar").
  // Antes: el botón existía disabled con aria-label voice.unsupported.
  // Ahora: sin soporte NO se renderiza botón de mic alguno (ni startLabel ni unsupported).
  it('sin soporte: NO se renderiza botón de mic (ni startLabel ni unsupported ausentes)', () => {
    voiceMock.isSupported = false;
    voiceMock.status = 'unsupported';
    renderNameField('');
    expect(screen.queryByRole('button', { name: brand.voice.unsupported })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: brand.voice.startLabel })).not.toBeInTheDocument();
  });

  // Caso 14 — se mantiene: el formulario no se rompe, el input manual sigue disponible.
  it('sin soporte: el textbox sigue presente (formulario no roto)', () => {
    voiceMock.isSupported = false;
    voiceMock.status = 'unsupported';
    renderNameField('');
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});

/**
 * Caso 15 — regresión white-label. Todas las aserciones anteriores de voice_ux ya
 * afirman contra `brand.voice.*` (nunca contra strings hardcodeados). Este test lo
 * blinda explícitamente: renderiza con OTRA marca (defaults del schema, textos de
 * voz distintos a los del seed shopinbaz) y comprueba que el botón y la región de
 * error se observan por los textos de ESA marca. Si el componente hardcodeara un
 * literal, este test —con textos de marca diferentes— fallaría.
 */
describe('NameField — UX de voz: cero literal / white-label (voice_ux caso 15)', () => {
  const otherBrand = parseBrandConfig({
    key: 'otra',
    name: 'Otra',
    voice: {
      startLabel: 'Habla tu nombre aquí',
      listeningLabel: 'Te estamos oyendo',
      permissionDenied: 'Micrófono bloqueado por la otra marca',
      noSpeech: 'No captamos audio (otra marca)',
      genericError: 'Fallo de dictado (otra marca)',
      unsupported: 'Voz no disponible aquí (otra marca)',
    },
  });

  function renderWithBrand(brandConfig: typeof otherBrand) {
    return render(
      <ThemeProvider config={brandConfig}>
        <NameField value="" onChange={vi.fn()} />
      </ThemeProvider>,
    );
  }

  beforeEach(() => {
    voiceMock.status = 'idle';
    voiceMock.isSupported = true;
    voiceMock.isListening = false;
    voiceMock.errorCode = null;
    voiceMock.voiceUnavailable = false;
    voiceMock.start.mockClear();
    voiceMock.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('el aria-label de arranque proviene de la marca activa (no de un literal)', () => {
    renderWithBrand(otherBrand);
    expect(screen.getByRole('button', { name: otherBrand.voice.startLabel })).toBeInTheDocument();
  });

  it('la etiqueta de escucha proviene de la marca activa', () => {
    voiceMock.status = 'listening';
    voiceMock.isListening = true;
    renderWithBrand(otherBrand);
    expect(screen.getByText(otherBrand.voice.listeningLabel)).toBeInTheDocument();
  });

  it('el texto de error proviene de la marca activa', () => {
    voiceMock.status = 'error';
    voiceMock.errorCode = 'not-allowed';
    renderWithBrand(otherBrand);
    expect(screen.getByRole('status')).toHaveTextContent(otherBrand.voice.permissionDenied);
  });

  // REGRESIÓN (voice_reliability): el no-soporte ya no muestra un botón con
  // voice.unsupported, sino que oculta el mic. El white-label del no-soporte se
  // reconvierte: con otra marca sin soporte, tampoco hay botón de mic (ni con el
  // startLabel ni con el unsupported de ESA marca) — la ocultación es agnóstica de
  // marca y no filtra literales.
  it('sin soporte: no se renderiza botón de mic con textos de la marca activa (ocultación white-label)', () => {
    voiceMock.isSupported = false;
    voiceMock.status = 'unsupported';
    renderWithBrand(otherBrand);
    expect(
      screen.queryByRole('button', { name: otherBrand.voice.unsupported }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: otherBrand.voice.startLabel }),
    ).not.toBeInTheDocument();
  });
});

/**
 * RED — voice_reliability (bloque B). Deriva de
 * `progress/voice_reliability/design.md` → "(B) Tests de NameField" y sus
 * "Criterios de aceptación traducibles a tests".
 *
 * Fallan hasta que NameField: (B11) NO renderice el botón de mic si !isSupported;
 * (B12) lo oculte también si voiceUnavailable (latch de network); (B13) lo
 * muestre en el caso normal (regresión de no ocultar de más); (B14) comunique el
 * no-speech sintético por la región role="status" con voice.noSpeech; (B15)
 * recorte a 15 cada emisión de voz (parcial o final) antes de onChange. Todo se
 * observa por rol/aria/texto de marca (nunca por clase CSS ni literal).
 */
describe('NameField — voice_reliability: ocultación del mic (B11, B12, B13)', () => {
  beforeEach(() => {
    voiceMock.status = 'idle';
    voiceMock.isSupported = true;
    voiceMock.isListening = false;
    voiceMock.errorCode = null;
    voiceMock.voiceUnavailable = false;
    voiceMock.start.mockClear();
    voiceMock.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Caso B11 — mic NO renderizado si !isSupported (el textbox sigue).
  it('!isSupported: no hay botón de mic (startLabel ni unsupported) y el textbox sigue presente', () => {
    voiceMock.isSupported = false;
    voiceMock.status = 'unsupported';
    renderNameField('');
    expect(screen.queryByRole('button', { name: brand.voice.startLabel })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: brand.voice.unsupported })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  // Caso B12 — mic oculto tras network (voiceUnavailable) aunque isSupported siga true.
  it('voiceUnavailable=true (latch network): el botón de mic se oculta; textbox y contador siguen', () => {
    voiceMock.isSupported = true;
    voiceMock.voiceUnavailable = true;
    renderNameField('Ana');
    expect(screen.queryByRole('button', { name: brand.voice.startLabel })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByText('3/15 caracteres')).toBeInTheDocument();
  });

  // Caso B13 — regresión: en el caso normal el mic SÍ se muestra (no se oculta de más).
  it('caso normal (isSupported=true, voiceUnavailable=false): el botón de mic startLabel está presente', () => {
    renderNameField('');
    expect(screen.getByRole('button', { name: brand.voice.startLabel })).toBeInTheDocument();
  });
});

describe('NameField — voice_reliability: aviso no-speech y clamp de parciales (B14, B15)', () => {
  beforeEach(() => {
    voiceMock.status = 'idle';
    voiceMock.isSupported = true;
    voiceMock.isListening = false;
    voiceMock.errorCode = null;
    voiceMock.voiceUnavailable = false;
    voiceMock.start.mockClear();
    voiceMock.stop.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Caso B14 — el no-speech (real o sintético) se comunica por role="status" con voice.noSpeech.
  it('errorCode="no-speech": la región role="status" muestra voice.noSpeech', () => {
    voiceMock.status = 'error';
    voiceMock.errorCode = 'no-speech';
    renderNameField('');
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.noSpeech);
  });

  // Caso B15 — cada emisión de voz (parcial o final) se recorta a 15 antes de onChange.
  it('interim rellena con clamp: "Ju" propaga tal cual; un parcial >15 se recorta a 15', () => {
    const { onChange } = renderNameField('');

    voiceMock.onResult?.('Ju');
    expect(onChange).toHaveBeenCalledWith('Ju');

    voiceMock.onResult?.('JuanNombreLarguísimoDeMás');
    const last = onChange.mock.calls.at(-1)?.[0] as string;
    expect(last.length).toBe(15);
    expect(last).toBe('JuanNombreLargu'); // exactamente 15 chars
  });
});
