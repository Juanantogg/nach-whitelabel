/**
 * Tests RED→GREEN — App.
 *
 * Tras el design aprobado de welcome_screen (acceptance #7), `App` deja de ser el
 * placeholder de Fase 0 y renderiza `<WelcomeScreen />`. La marca activa la provee
 * `<ThemeProvider>` (config ya resuelta), como hará `main.tsx`.
 *
 * Este test verifica el CABLEADO: montado bajo el ThemeProvider, `App` muestra la
 * pantalla de bienvenida con los textos de la marca activa (título desde config).
 * La cobertura fina del layout/estados vive en `WelcomeScreen.test.tsx`; aquí solo
 * se afirma que `App` compone la pantalla real bajo la marca inyectada.
 *
 * Se mockean los hooks del borde (`useNameSubmission`, `useVoiceRecorder`) igual
 * que en los tests de welcome, para no arrastrar red/crypto/getUserMedia. Tras el
 * REWORK de voz (ADR 23) el único motor es `useVoiceRecorder` (Groq); ya no existe
 * `useVoiceInput`.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { ThemeProvider } from './brand/ThemeProvider';
import { parseBrandConfig } from './brand/core/schema';
import shopinbazSeed from './brand/seeds/shopinbaz.json';

vi.mock('./features/welcome/useNameSubmission', () => ({
  useNameSubmission: () => ({
    status: 'idle',
    numero: null,
    errorMessage: null,
    errorKind: null,
    submit: vi.fn(),
    retry: vi.fn(),
  }),
}));

vi.mock('./voice/useVoiceRecorder', () => ({
  useVoiceRecorder: () => ({
    status: 'idle',
    isRecording: false,
    isTranscribing: false,
    errorCode: null,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

const brand = parseBrandConfig(shopinbazSeed);

describe('App', () => {
  it('renderiza la pantalla de bienvenida con los textos de la marca activa', () => {
    render(
      <ThemeProvider config={brand}>
        <App />
      </ThemeProvider>,
    );

    // El título mostrado proviene de la config de marca (cero literal en App).
    expect(screen.getByText(brand.text.title)).toBeInTheDocument();
    // Y el botón de envío de la pantalla de bienvenida está presente.
    expect(screen.getByRole('button', { name: brand.text.submitLabel })).toBeInTheDocument();
  });
});
