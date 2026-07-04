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
