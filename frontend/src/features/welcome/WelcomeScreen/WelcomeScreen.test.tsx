/**
 * Tests RED — features/welcome/WelcomeScreen.
 *
 * Integración de UI de la pantalla de bienvenida (welcome_screen):
 *  - Render/layout desde las maquetas con SOLO textos/tokens de marca, cero
 *    literales (acceptance #1): título, subtítulo, pregunta, input, botón de voz,
 *    contador y botón "Comenzar".
 *  - Estados idle/loading/success/error VISIBLES (acceptance #4, #5): loading
 *    deshabilita el botón; error muestra el texto de marca + Reintentar; success
 *    muestra el número en ResultView.
 *  - Render multi-marca (acceptance #6): el MISMO componente con la seed de
 *    shopinbaz y la de elektra muestra títulos/ilustración distintos y CSS vars
 *    --brand-* distintas.
 *
 * Se mockea `useNameSubmission` (la orquestación async ya se prueba aislada en su
 * propio test) para conducir la máquina de estados desde el test, y `useVoiceInput`
 * (borde del sistema). NO se mockea el layout ni el consumo de la config de marca,
 * que es lo que aquí se verifica.
 *
 * RED esperado: `./WelcomeScreen` aún no existe → import falla, tests en rojo.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../../brand/ThemeProvider';
import { parseBrandConfig, type BrandConfig } from '../../../brand/core/schema';
import shopinbazSeed from '../../../brand/seeds/shopinbaz.json';
import elektraSeed from '../../../brand/seeds/elektra.json';
import { WelcomeScreen } from './WelcomeScreen';

// --- Mock del hook de orquestación: conduce la máquina de estados desde el test. ---
type SubmissionStatus = 'idle' | 'loading' | 'success' | 'error';
interface SubmissionMock {
  status: SubmissionStatus;
  numero: string | null;
  errorMessage: string | null;
  errorKind: 'network' | 'generic' | null;
  submit: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}
const submissionMock = vi.hoisted<SubmissionMock>(() => ({
  status: 'idle',
  numero: null,
  errorMessage: null,
  errorKind: null,
  submit: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('../useNameSubmission', () => ({
  useNameSubmission: () => submissionMock,
}));

// --- Mock del hook de voz (borde del sistema). ---
vi.mock('../../../voice/useVoiceInput', () => ({
  useVoiceInput: () => ({
    status: 'idle',
    isSupported: true,
    isListening: false,
    errorCode: null,
    transcript: '',
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

const shopinbazConfig = parseBrandConfig(shopinbazSeed);
const elektraConfig = parseBrandConfig(elektraSeed);

function renderScreen(config: BrandConfig = shopinbazConfig) {
  return render(
    <ThemeProvider config={config}>
      <WelcomeScreen />
    </ThemeProvider>,
  );
}

function resetSubmission() {
  submissionMock.status = 'idle';
  submissionMock.numero = null;
  submissionMock.errorMessage = null;
  submissionMock.errorKind = null;
  submissionMock.submit.mockClear();
  submissionMock.retry.mockClear();
}

function readVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

describe('WelcomeScreen — layout desde config de marca (acceptance #1)', () => {
  beforeEach(resetSubmission);
  afterEach(() => document.documentElement.removeAttribute('style'));

  it('renderiza el título de marca', () => {
    renderScreen();
    expect(screen.getByText(shopinbazConfig.text.title)).toBeInTheDocument();
  });

  it('renderiza subtítulo y pregunta de nombre desde la config', () => {
    renderScreen();
    expect(screen.getByText(shopinbazConfig.text.subtitle)).toBeInTheDocument();
    expect(screen.getByText(shopinbazConfig.text.namePrompt)).toBeInTheDocument();
  });

  it('renderiza el input con el placeholder de marca', () => {
    renderScreen();
    expect(screen.getByPlaceholderText(shopinbazConfig.text.inputPlaceholder)).toBeInTheDocument();
  });

  it('renderiza el botón "Comenzar" desde submitLabel', () => {
    renderScreen();
    expect(
      screen.getByRole('button', { name: shopinbazConfig.text.submitLabel }),
    ).toBeInTheDocument();
  });

  it('renderiza el contador inicial "0/15 caracteres" desde counterTemplate', () => {
    renderScreen();
    expect(screen.getByText('0/15 caracteres')).toBeInTheDocument();
  });

  it('renderiza el botón de voz con el aria-label de marca', () => {
    renderScreen();
    expect(
      screen.getByRole('button', { name: shopinbazConfig.voice.startLabel }),
    ).toBeInTheDocument();
  });

  it('renderiza la ilustración de marca con su alt', () => {
    renderScreen();
    expect(
      screen.getByRole('img', { name: shopinbazConfig.assets.illustrationAlt }),
    ).toBeInTheDocument();
  });
});

describe('WelcomeScreen — envío y estado inicial (acceptance #3, #4)', () => {
  beforeEach(resetSubmission);

  it('el botón "Comenzar" está deshabilitado con el nombre vacío', () => {
    renderScreen();
    expect(screen.getByRole('button', { name: shopinbazConfig.text.submitLabel })).toBeDisabled();
  });

  it('al escribir un nombre y pulsar Comenzar se invoca submit con ese nombre', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByPlaceholderText(shopinbazConfig.text.inputPlaceholder), 'Ana');
    await user.click(screen.getByRole('button', { name: shopinbazConfig.text.submitLabel }));
    expect(submissionMock.submit).toHaveBeenCalledWith('Ana');
  });
});

describe('WelcomeScreen — estado loading visible (acceptance #4)', () => {
  beforeEach(resetSubmission);

  it('en loading el botón de envío está deshabilitado', () => {
    submissionMock.status = 'loading';
    renderScreen();
    // El botón visible durante loading no permite reenviar.
    const buttons = screen.getAllByRole('button');
    const submit = buttons.find((b) => b.getAttribute('type') === 'submit') ?? buttons[0];
    expect(submit).toBeDisabled();
  });

  it('en loading muestra el label de carga de marca (loadingLabel)', () => {
    submissionMock.status = 'loading';
    renderScreen();
    expect(screen.getByText(shopinbazConfig.text.loadingLabel)).toBeInTheDocument();
  });
});

describe('WelcomeScreen — estado success visible (acceptance #3)', () => {
  beforeEach(resetSubmission);

  it('en success muestra el número descifrado (ResultView)', () => {
    submissionMock.status = 'success';
    submissionMock.numero = '7';
    renderScreen();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(shopinbazConfig.text.resultLabel)).toBeInTheDocument();
  });
});

describe('WelcomeScreen — estado error visible (acceptance #5)', () => {
  beforeEach(resetSubmission);

  it('error de red muestra el texto errorNetwork de marca en un role="alert"', () => {
    submissionMock.status = 'error';
    submissionMock.errorKind = 'network';
    renderScreen();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(shopinbazConfig.text.errorNetwork);
  });

  it('error genérico muestra el texto errorGeneric de marca', () => {
    submissionMock.status = 'error';
    submissionMock.errorKind = 'generic';
    renderScreen();
    expect(screen.getByText(shopinbazConfig.text.errorGeneric)).toBeInTheDocument();
  });

  it('en error ofrece un botón "Reintentar" (retryLabel) que llama a retry', async () => {
    const user = userEvent.setup();
    submissionMock.status = 'error';
    submissionMock.errorKind = 'generic';
    renderScreen();

    const retryBtn = screen.getByRole('button', { name: shopinbazConfig.text.retryLabel });
    await user.click(retryBtn);
    expect(submissionMock.retry).toHaveBeenCalledTimes(1);
  });
});

describe('WelcomeScreen — render multi-marca (acceptance #6)', () => {
  beforeEach(resetSubmission);
  afterEach(() => document.documentElement.removeAttribute('style'));

  it.each([
    ['shopinbaz', shopinbazConfig],
    ['elektra', elektraConfig],
  ] as const)(
    'el MISMO componente refleja título, ilustración y color primario de %s',
    (_name, config) => {
      renderScreen(config);
      expect(screen.getByText(config.text.title)).toBeInTheDocument();
      expect(screen.getByRole('img', { name: config.assets.illustrationAlt })).toHaveAttribute(
        'src',
        config.assets.illustration,
      );
      expect(readVar('--brand-primary')).toBe(config.colors.primary);
    },
  );

  it('ANCLA: shopinbaz es morado (170 59 255) y elektra es rojo (242 74 45) — distintos', () => {
    const { unmount } = renderScreen(shopinbazConfig);
    expect(readVar('--brand-primary')).toBe('170 59 255');
    unmount();

    document.documentElement.removeAttribute('style');
    renderScreen(elektraConfig);
    expect(readVar('--brand-primary')).toBe('242 74 45');
    expect(screen.getByText('¡Te damos la bienvenida a Préstamo Elektra!')).toBeInTheDocument();
  });
});
