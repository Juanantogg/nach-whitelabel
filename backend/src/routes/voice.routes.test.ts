/**
 * Tests RED — POST /voice/transcribe (feature voice_universal, fallback Whisper).
 *
 * Deriva de `progress/voice_universal/design.md` §5.1 (B1-B7). El endpoint recibe
 * el audio como `multipart/form-data` (campo `audio`), el backend lo reenvía a un
 * proveedor de IA (Groq) vía la capa de services y devuelve `{ text }`.
 *
 * Estilo idéntico a `names.routes.test.ts`:
 *  - `vi.mock` del service de transcripción (borde del sistema: el proveedor de IA)
 *    para inyectar el resultado y ESPIAR con qué argumentos se invoca, sin red real.
 *  - `vi.resetModules()` + import dinámico de `createApp` para variar la env
 *    (`GROQ_API_KEY`) por test sin fugas de estado.
 *  - `vi.stubEnv` para inyectar/omitir la key.
 *  - Supertest contra la app construida (`app.ts`), nunca `server.ts`.
 *
 * MOTIVO DE FALLO ESPERADO (RED legítimo): aún NO existen `voice.routes.ts`,
 * `voice.controller.ts` ni `transcription.service.ts`, y `app.ts` no monta
 * `/voice`. Express responde 404 a todas las peticiones en vez de los códigos del
 * contrato (200/400/413/500/502), y el service mockeado nunca se invoca. El
 * `vi.mock('../services/transcription.service.js', …)` apunta al especificador que
 * el controller de producción deberá usar para importar `transcribeAudio`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/**
 * Mock del service de transcripción. `vi.mock` se hoistea; la spy se reconfigura
 * por test. La firma acordada (design §2.4) es
 * `transcribeAudio({ audio: Buffer, mimeType: string }): Promise<string>`.
 */
const transcribeAudioMock =
  vi.fn<(input: { audio: Buffer; mimeType: string; language?: string }) => Promise<string>>();
vi.mock('../services/transcription.service.js', () => ({
  transcribeAudio: (input: {
    audio: Buffer;
    mimeType: string;
    language?: string;
  }): Promise<string> => transcribeAudioMock(input),
}));

/** Forma del body de respuesta (Supertest tipa `res.body` como `any`). */
interface VoiceBody {
  text?: string;
  error?: string;
  message?: string;
}

/** Privada de test cualquiera: `createApp` la lee, pero /voice no la usa. Basta con que la app arranque. */
const ANY_PRIVATE_KEY = 'no-importa-para-voice';

/**
 * Carga una app fresca con la `GROQ_API_KEY` dada inyectada en el entorno.
 * `undefined` → la key queda ausente (stub a '') para el caso B6.
 */
async function appWithGroqKey(groqApiKey: string | undefined): Promise<Express> {
  vi.resetModules();
  // La app no valida la privada al construirse (solo /names la usa); se stubea
  // por completitud, coherente con names.routes.test.ts.
  vi.stubEnv('CRYPTO_PRIVATE_KEY', ANY_PRIVATE_KEY);
  vi.stubEnv('GROQ_API_KEY', groqApiKey ?? '');
  const { createApp } = await import('../app.js');
  return createApp();
}

/** WEBM mínimo sintético con el MIME que emite MediaRecorder en Chrome/Firefox. */
const WEBM_MIME = 'audio/webm';

describe('POST /voice/transcribe — transcripción por IA (service mockeado)', () => {
  beforeEach(() => {
    transcribeAudioMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('B1 audio webm válido + service devuelve "Ana" → 200 { text: "Ana" } e invoca el service una vez con el buffer y el MIME', async () => {
    transcribeAudioMock.mockResolvedValue('Ana');
    const app = await appWithGroqKey('sk-test-groq');

    const res = await request(app)
      .post('/voice/transcribe')
      .attach('audio', Buffer.from('fake-webm-bytes'), {
        filename: 'voice.webm',
        contentType: WEBM_MIME,
      });
    const body = res.body as VoiceBody;

    expect(res.status).toBe(200);
    expect(body.text).toBe('Ana');
    expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
    // El service recibe el audio como Buffer y el MIME del fichero subido.
    const arg = transcribeAudioMock.mock.calls[0]?.[0];
    expect(Buffer.isBuffer(arg?.audio)).toBe(true);
    expect(arg?.audio.equals(Buffer.from('fake-webm-bytes'))).toBe(true);
    expect(arg?.mimeType).toMatch(/^audio\/webm/);
  });

  it('B2 petición SIN campo audio → 400 invalid_payload y el service NO se invoca', async () => {
    transcribeAudioMock.mockResolvedValue('Ana');
    const app = await appWithGroqKey('sk-test-groq');

    // multipart pero sin el campo `audio` (un campo de texto cualquiera).
    const res = await request(app).post('/voice/transcribe').field('foo', 'bar');
    const body = res.body as VoiceBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_payload');
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });

  it('B3 MIME fuera de la allowlist (image/png) → 400 invalid_payload y el service NO se invoca', async () => {
    transcribeAudioMock.mockResolvedValue('Ana');
    const app = await appWithGroqKey('sk-test-groq');

    const res = await request(app)
      .post('/voice/transcribe')
      .attach('audio', Buffer.from('\x89PNG\r\n'), {
        filename: 'foto.png',
        contentType: 'image/png',
      });
    const body = res.body as VoiceBody;

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_payload');
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });

  it('B4 fichero mayor que MAX_AUDIO_BYTES → 413 audio_too_large y el service NO se invoca', async () => {
    transcribeAudioMock.mockResolvedValue('Ana');
    const app = await appWithGroqKey('sk-test-groq');

    // 3 MB > 2 MB (MAX_AUDIO_BYTES del design §2.2). El límite de multer debe
    // cortarlo antes de llegar al service, sin subir un audio real.
    const tooBig = Buffer.alloc(3 * 1024 * 1024, 0);
    const res = await request(app)
      .post('/voice/transcribe')
      .attach('audio', tooBig, { filename: 'voice.webm', contentType: WEBM_MIME });
    const body = res.body as VoiceBody;

    expect(res.status).toBe(413);
    expect(body.error).toBe('audio_too_large');
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });

  it('B5 el service (proveedor) rechaza → 502 transcription_failed y sin detalle del proveedor en el body', async () => {
    // El mensaje del error del proveedor NO debe filtrarse al cliente.
    transcribeAudioMock.mockRejectedValue(new Error('Groq 401: invalid api key xyz'));
    const app = await appWithGroqKey('sk-test-groq');

    const res = await request(app)
      .post('/voice/transcribe')
      .attach('audio', Buffer.from('fake-webm-bytes'), {
        filename: 'voice.webm',
        contentType: WEBM_MIME,
      });
    const body = res.body as VoiceBody;

    expect(res.status).toBe(502);
    expect(body.error).toBe('transcription_failed');
    // Nada del proveedor se filtra (ni status, ni "Groq", ni la api key).
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/groq/i);
    expect(serialized).not.toContain('401');
    expect(serialized).not.toContain('invalid api key');
  });

  it('B6 GROQ_API_KEY ausente + audio válido → 500 internal_error y el service NO se invoca', async () => {
    transcribeAudioMock.mockResolvedValue('Ana');
    const app = await appWithGroqKey(''); // key ausente

    const res = await request(app)
      .post('/voice/transcribe')
      .attach('audio', Buffer.from('fake-webm-bytes'), {
        filename: 'voice.webm',
        contentType: WEBM_MIME,
      });
    const body = res.body as VoiceBody;

    expect(res.status).toBe(500);
    expect(body.error).toBe('internal_error');
    // Falla-cerrado: sin key no se llama al proveedor.
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });

  it('B7 el backend fija language:"es" al invocar el service (no lo manda el cliente)', async () => {
    transcribeAudioMock.mockResolvedValue('Ana');
    const app = await appWithGroqKey('sk-test-groq');

    await request(app)
      .post('/voice/transcribe')
      .attach('audio', Buffer.from('fake-webm-bytes'), {
        filename: 'voice.webm',
        contentType: WEBM_MIME,
      });

    expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
    const arg = transcribeAudioMock.mock.calls[0]?.[0];
    expect(arg?.language).toBe('es');
  });
});
