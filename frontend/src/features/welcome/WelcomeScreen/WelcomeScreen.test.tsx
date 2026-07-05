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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../../brand/ThemeProvider';
import { parseBrandConfig, type BrandConfig } from '../../../brand/core/schema';
import { DEFAULT_BRAND } from '../../../brand/core/registry';
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

describe('WelcomeScreen — fondo de marca (bug: fondo blanco)', () => {
  beforeEach(resetSubmission);

  // Criterio #1: el contenedor raíz de la pantalla debe pintar el fondo con el
  // token de marca `bg-brand-bg`. Sin esta clase el <main> es transparente y se
  // ve el blanco por defecto del navegador en vez del fondo oscuro de la marca.
  it('el <main> aplica el token de fondo de marca bg-brand-bg', () => {
    renderScreen();
    const main = screen.getByRole('main');
    expect(main).toHaveClass('bg-brand-bg');
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

describe('WelcomeScreen — fallback de assets de marca rotos (degradación white-label)', () => {
  beforeEach(resetSubmission);
  afterEach(() => document.documentElement.removeAttribute('style'));

  // La marca elektra apunta sus assets a un bucket remoto
  // (https://brands.garcia3apps.com/elektra/...) que en muchos entornos da
  // 404/red/CORS: el <img> falla al cargar y el navegador pinta el ícono roto.
  // El contrato deseado: al disparar `onError`, el src cae al asset BUNDLEADO de
  // la marca default (DEFAULT_BRAND), que sí existe en public/.
  //
  // Anclas de la fuente de verdad: el test NO hardcodea rutas sueltas, sino que
  // afirma contra DEFAULT_BRAND.assets. Se deja constancia de la ruta esperada
  // para que un cambio accidental en el default también rompa aquí.
  it('ANCLA: DEFAULT_BRAND expone las rutas bundleadas de fallback', () => {
    expect(DEFAULT_BRAND.assets.logo).toBe('/brands/default/logo.svg');
    expect(DEFAULT_BRAND.assets.illustration).toBe('/brands/default/illustration.svg');
    // Las de elektra son remotas y distintas: por eso pueden fallar.
    expect(elektraConfig.assets.logo).not.toBe(DEFAULT_BRAND.assets.logo);
    expect(elektraConfig.assets.illustration).not.toBe(DEFAULT_BRAND.assets.illustration);
  });

  it('cuando el logo de marca falla al cargar, su src cae al logo de default', () => {
    renderScreen(elektraConfig);

    const logo = screen.getByRole('img', { name: elektraConfig.assets.logoAlt });
    // Precondición: arranca con la ruta remota de la marca.
    expect(logo).toHaveAttribute('src', elektraConfig.assets.logo);

    // jsdom no carga imágenes reales: simulamos el fallo de carga con el evento
    // `error` sobre el propio <img>.
    fireEvent.error(logo);

    expect(logo).toHaveAttribute('src', DEFAULT_BRAND.assets.logo);
  });

  it('cuando la ilustración de marca falla al cargar, su src cae a la ilustración de default', () => {
    renderScreen(elektraConfig);

    const illustration = screen.getByRole('img', { name: elektraConfig.assets.illustrationAlt });
    expect(illustration).toHaveAttribute('src', elektraConfig.assets.illustration);

    fireEvent.error(illustration);

    expect(illustration).toHaveAttribute('src', DEFAULT_BRAND.assets.illustration);
  });

  // GUARDA ANTI-BUCLE: si el asset de fallback también fallara (o si por lo que
  // sea el src ya es el de default), `onError` NO debe re-asignar. De lo
  // contrario cada error re-dispara un onError → bucle infinito. El swap ocurre
  // como mucho una vez.
  it('no re-entra si el src ya es el de default (guarda anti-bucle)', () => {
    // La marca default ya sirve el asset bundleado: el src arranca en el de
    // default. Un `error` sobre él no debe volver a tocarlo.
    renderScreen(DEFAULT_BRAND);

    const logo = screen.getByRole('img', { name: DEFAULT_BRAND.assets.logoAlt });
    const setAttrSpy = vi.spyOn(logo, 'setAttribute');
    expect(logo).toHaveAttribute('src', DEFAULT_BRAND.assets.logo);

    fireEvent.error(logo);

    // El src sigue siendo el de default y no se reasignó (no hubo setAttribute('src', ...)).
    expect(logo).toHaveAttribute('src', DEFAULT_BRAND.assets.logo);
    const reassignedSrc = setAttrSpy.mock.calls.some(([attr]) => attr === 'src');
    expect(reassignedSrc).toBe(false);

    setAttrSpy.mockRestore();
  });

  it('guarda anti-bucle end-to-end: dos errores seguidos sobre el logo de marca dejan el src estable en default', () => {
    renderScreen(elektraConfig);

    const logo = screen.getByRole('img', { name: elektraConfig.assets.logoAlt });

    // Primer error: marca remota -> default.
    fireEvent.error(logo);
    expect(logo).toHaveAttribute('src', DEFAULT_BRAND.assets.logo);

    // Segundo error (el fallback también "falla"): NO re-asigna, queda estable.
    fireEvent.error(logo);
    expect(logo).toHaveAttribute('src', DEFAULT_BRAND.assets.logo);
  });
});

// Criterio #2 (defensa en profundidad): además del token en el <main>, el fondo
// global debe estar pintado en body/#root con la variable de marca --brand-bg,
// para cubrir el área fuera del contenedor (overscroll, min-h no completo, etc.)
// y que nunca asome el blanco del navegador. Se verifica leyendo el CSS global
// estático (aserción sobre archivo, no sobre DOM) para no acoplarse al pipeline
// de Tailwind en runtime.
describe('index.css — fondo global de marca (bug: fondo blanco)', () => {
  // Vitest corre con cwd = raíz del paquete @nach/frontend.
  const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

  it('pinta el fondo global en body o #root usando rgb(var(--brand-bg))', () => {
    // Regla tipo `body { background: rgb(var(--brand-bg)); }` (o #root, o
    // background-color). Se ignoran espacios/orden de canal alfa opcional.
    const rule =
      /(?:^|\s)(?:body|#root)\s*\{[^}]*background(?:-color)?\s*:[^;}]*rgb\(\s*var\(\s*--brand-bg\s*\)/is;
    expect(indexCss).toMatch(rule);
  });
});
