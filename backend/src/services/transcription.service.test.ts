/**
 * Tests RED — services/transcription.service (aísla el proveedor de IA tras la
 * firma `transcribeAudio`). Feature voice_universal, design §5.2 (S1-S2).
 *
 * `transcription.service` es la ÚNICA capa que conoce Groq. Se mockea el SDK
 * (`groq-sdk`) —el borde del sistema, la red al proveedor— con `vi.mock` +
 * factory; NUNCA se llama a la API real. La lógica bajo prueba (construir el
 * fichero desde el buffer, fijar model/language, devolver el text) NO se mockea.
 *
 * NOTA sobre el mock del SDK: `groq-sdk` es una dependencia que el gate aún no ha
 * aprobado ni instalado. `vi.mock` con factory intercepta el especificador aunque
 * el paquete no esté resuelto en `node_modules`, así que este test NO depende de
 * que la dep exista para expresar el contrato. El RED viene de que el módulo de
 * producción `./transcription.service.js` todavía NO existe.
 *
 * MOTIVO DE FALLO ESPERADO (RED legítimo): `./transcription.service.js` no existe
 * → el import dinámico rechaza y ambos tests quedan en rojo por "módulo ausente".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Doble controlable del SDK de Groq. Reproduce la superficie que el service usa:
 * `new Groq({ apiKey }).audio.transcriptions.create({ file, model, language })`.
 * Se publica la spy `createMock` para inspeccionar los argumentos.
 */
const createMock = vi.fn<(params: Record<string, unknown>) => Promise<{ text: string }>>();
const groqCtorMock = vi.fn();

vi.mock('groq-sdk', () => {
  class GroqMock {
    audio = { transcriptions: { create: createMock } };
    constructor(opts: unknown) {
      groqCtorMock(opts);
    }
  }
  return { default: GroqMock };
});

/**
 * Carga fresca del service con la env de la key inyectada. El `vi.resetModules()`
 * fuerza a releer `env.groqApiKey` y a re-evaluar el módulo con el mock del SDK.
 */
async function loadService(groqApiKey = 'sk-test-groq') {
  vi.resetModules();
  vi.stubEnv('GROQ_API_KEY', groqApiKey);
  return import('./transcription.service.js');
}

describe('transcription.service — transcribeAudio (SDK de Groq mockeado)', () => {
  beforeEach(() => {
    createMock.mockReset();
    groqCtorMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('S1 llama al SDK con model whisper-large-v3-turbo, language es y el fichero del buffer; devuelve text', async () => {
    createMock.mockResolvedValue({ text: 'Ana' });
    const { transcribeAudio } = await loadService();

    const text = await transcribeAudio({
      audio: Buffer.from('fake-webm-bytes'),
      mimeType: 'audio/webm',
      language: 'es',
    });

    expect(text).toBe('Ana');
    expect(createMock).toHaveBeenCalledTimes(1);
    const params = createMock.mock.calls[0]?.[0];
    expect(params?.model).toBe('whisper-large-v3-turbo');
    expect(params?.language).toBe('es');
    // El fichero se construye desde el buffer (Groq acepta webm directo, sin transcodificar).
    expect(params?.file).toBeDefined();
  });

  it('S2 el SDK lanza → transcribeAudio propaga el error (el controller lo traduce a 502)', async () => {
    createMock.mockRejectedValue(new Error('Groq upstream 500'));
    const { transcribeAudio } = await loadService();

    await expect(
      transcribeAudio({ audio: Buffer.from('x'), mimeType: 'audio/webm', language: 'es' }),
    ).rejects.toThrow();
  });
});
