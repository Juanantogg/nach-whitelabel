/**
 * Tests RED — NameField, orquestación nativo↔fallback (feature voice_universal).
 * Deriva de `progress/voice_universal/design.md` §5.5 (N1-N7).
 *
 * NameField hoy usa SOLO `useVoiceInput` y OCULTA el mic cuando el nativo no
 * sirve (`!isSupported` o `voiceUnavailable`). voice_universal convierte esa
 * ocultación en DEGRADACIÓN: en esos casos el botón usa el hook `useVoiceFallback`
 * (captura + transcripción por IA). Con nativo disponible, sigue el hook nativo.
 *
 * Se mockean AMBOS hooks (borde del sistema): `useVoiceInput` y `useVoiceFallback`.
 * La lógica bajo prueba (elegir fuente, clamp de 15, textos de marca, aria) NO se
 * mockea. Todo se observa por rol/aria/texto de marca — nunca por clase CSS ni
 * literal.
 *
 * RED esperado:
 *  - `../../../voice/useVoiceFallback` aún no existe → el mock apunta a un módulo
 *    inexistente y NameField todavía no lo consume.
 *  - Con `useVoiceInput` a `isSupported:false`/`voiceUnavailable:true`, el
 *    NameField actual NO renderiza botón alguno (lo oculta), así que N1/N2 fallan
 *    (no hay botón que dispare el fallback).
 *  - `voice.transcribingLabel` aún no existe en el schema → N5 falla.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../../brand/ThemeProvider';
import { parseBrandConfig } from '../../../brand/core/schema';
import shopinbazSeed from '../../../brand/seeds/shopinbaz.json';
import { NameField } from './NameField';

// --- Mock del hook nativo (useVoiceInput). ---
interface NativeMock {
  onResult: ((t: string) => void) | undefined;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  status: 'unsupported' | 'idle' | 'listening' | 'error';
  isSupported: boolean;
  isListening: boolean;
  errorCode: string | null;
  transcript: string;
  voiceUnavailable: boolean;
}
const nativeMock = vi.hoisted<NativeMock>(() => ({
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
    nativeMock.onResult = opts.onResult;
    return {
      status: nativeMock.status,
      isSupported: nativeMock.isSupported,
      isListening: nativeMock.isListening,
      errorCode: nativeMock.errorCode,
      transcript: nativeMock.transcript,
      start: nativeMock.start,
      stop: nativeMock.stop,
      voiceUnavailable: nativeMock.voiceUnavailable,
    };
  },
}));

// --- Mock del hook de fallback (useVoiceFallback). ---
interface FallbackMock {
  onResult: ((t: string) => void) | undefined;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  status: 'idle' | 'recording' | 'transcribing' | 'error';
  isRecording: boolean;
  isTranscribing: boolean;
  errorCode: 'permission-denied' | 'no-audio' | 'network' | 'unknown' | null;
}
const fallbackMock = vi.hoisted<FallbackMock>(() => ({
  onResult: undefined,
  start: vi.fn(),
  stop: vi.fn(),
  status: 'idle',
  isRecording: false,
  isTranscribing: false,
  errorCode: null,
}));

vi.mock('../../../voice/useVoiceFallback', () => ({
  useVoiceFallback: (opts: { onResult: (t: string) => void }) => {
    fallbackMock.onResult = opts.onResult;
    return {
      status: fallbackMock.status,
      isRecording: fallbackMock.isRecording,
      isTranscribing: fallbackMock.isTranscribing,
      errorCode: fallbackMock.errorCode,
      start: fallbackMock.start,
      stop: fallbackMock.stop,
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

  return { ...utils, onChange, getValue: () => current };
}

function resetMocks(): void {
  nativeMock.status = 'idle';
  nativeMock.isSupported = true;
  nativeMock.isListening = false;
  nativeMock.errorCode = null;
  nativeMock.voiceUnavailable = false;
  nativeMock.start.mockClear();
  nativeMock.stop.mockClear();

  fallbackMock.status = 'idle';
  fallbackMock.isRecording = false;
  fallbackMock.isTranscribing = false;
  fallbackMock.errorCode = null;
  fallbackMock.start.mockClear();
  fallbackMock.stop.mockClear();
}

/**
 * El botón de mic (haya fuente nativa o fallback) se localiza por su rol. Con
 * cualquiera de las dos fuentes activas debe existir un único botón de mic con el
 * aria-label de arranque de la marca.
 */
function micButton(): HTMLElement {
  return screen.getByRole('button', { name: brand.voice.startLabel });
}

describe('NameField — activación del fallback donde el nativo no sirve (N1, N2, N3)', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.clearAllMocks());

  it('N1 !isSupported (Firefox): pulsar el botón invoca el fallback.start, NO el nativo.start', async () => {
    const user = userEvent.setup();
    nativeMock.isSupported = false;
    nativeMock.status = 'unsupported';
    renderNameField('');

    await user.click(micButton());

    expect(fallbackMock.start).toHaveBeenCalledTimes(1);
    expect(nativeMock.start).not.toHaveBeenCalled();
  });

  it('N2 voiceUnavailable (Brave): pulsar el botón invoca el fallback.start, NO el nativo.start', async () => {
    const user = userEvent.setup();
    nativeMock.isSupported = true;
    nativeMock.voiceUnavailable = true;
    renderNameField('');

    await user.click(micButton());

    expect(fallbackMock.start).toHaveBeenCalledTimes(1);
    expect(nativeMock.start).not.toHaveBeenCalled();
  });

  it('N3 nativo disponible (isSupported, !voiceUnavailable): pulsar el botón invoca el nativo.start, NO el fallback', async () => {
    const user = userEvent.setup();
    renderNameField('');

    await user.click(micButton());

    expect(nativeMock.start).toHaveBeenCalledTimes(1);
    expect(fallbackMock.start).not.toHaveBeenCalled();
  });
});

describe('NameField — clamp de 15 sobre el resultado del fallback (N4)', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.clearAllMocks());

  it('N4 el onResult del fallback con 20 chars → onChange recibe exactamente 15', () => {
    nativeMock.isSupported = false;
    nativeMock.status = 'unsupported';
    const { onChange } = renderNameField('');

    // Simula la transcripción entregada por el fallback (20 chars).
    fallbackMock.onResult?.('NombreLarguisimoAbcd');

    const last = onChange.mock.calls.at(-1)?.[0] as string;
    expect(last.length).toBe(15);
    expect(last).toBe('NombreLarguisim'); // exactamente 15 chars, mismo clamp que el nativo
  });
});

describe('NameField — estado de carga del fallback visible (N5)', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.clearAllMocks());

  it('N5 con el fallback en "transcribing": se muestra voice.transcribingLabel y el botón queda aria-busy', () => {
    nativeMock.isSupported = false;
    nativeMock.status = 'unsupported';
    fallbackMock.status = 'transcribing';
    fallbackMock.isTranscribing = true;
    renderNameField('');

    // La etiqueta de marca (cero literal) está en pantalla.
    expect(screen.getByText(brand.voice.transcribingLabel)).toBeInTheDocument();
    // El botón de mic comunica ocupado.
    expect(micButton()).toHaveAttribute('aria-busy', 'true');
  });
});

describe('NameField — errores del fallback en la región aria-live (N6)', () => {
  beforeEach(() => {
    resetMocks();
    nativeMock.isSupported = false;
    nativeMock.status = 'unsupported';
  });
  afterEach(() => vi.clearAllMocks());

  it('N6 permission-denied → voice.permissionDenied en role="status"', () => {
    fallbackMock.status = 'error';
    fallbackMock.errorCode = 'permission-denied';
    renderNameField('');
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.permissionDenied);
  });

  it('N6 no-audio → voice.noSpeech en role="status"', () => {
    fallbackMock.status = 'error';
    fallbackMock.errorCode = 'no-audio';
    renderNameField('');
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.noSpeech);
  });

  it('N6 network → voice.genericError en role="status"', () => {
    fallbackMock.status = 'error';
    fallbackMock.errorCode = 'network';
    renderNameField('');
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.genericError);
  });

  it('N6 unknown → voice.genericError en role="status"', () => {
    fallbackMock.status = 'error';
    fallbackMock.errorCode = 'unknown';
    renderNameField('');
    expect(screen.getByRole('status')).toHaveTextContent(brand.voice.genericError);
  });
});

describe('NameField — el input manual sigue funcionando con el fallback activo (N7)', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.clearAllMocks());

  it('N7 con el fallback activo (Firefox): escribir rellena el campo y respeta el tope de 15', async () => {
    const user = userEvent.setup();
    nativeMock.isSupported = false;
    nativeMock.status = 'unsupported';
    const { onChange } = renderNameField('');

    await user.type(screen.getByRole('textbox'), 'A');
    expect(onChange).toHaveBeenCalledWith('A');

    // El input mantiene el maxLength de producto.
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '15');
  });

  it('N7 con voiceUnavailable (Brave): el textbox sigue presente y el formulario no se rompe', () => {
    nativeMock.isSupported = true;
    nativeMock.voiceUnavailable = true;
    renderNameField('Ana');
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByText('3/15 caracteres')).toBeInTheDocument();
  });
});
