/**
 * Tests RED — features/welcome/useNameSubmission.
 *
 * Orquestación del flujo end-to-end (acceptance #3, #4, #5 de welcome_screen y la
 * máquina idle/loading/success/error de design.md). El hook encadena:
 *   fetchPublicKey → encryptName → apiFetch('/names', POST) → decryptNumber → número.
 *
 * Se mockean las cuatro piezas del borde (crypto/API), NO la máquina de estados
 * bajo prueba. Se verifica el ORDEN de llamadas, el body EXACTO del POST
 * ({ encryptedKey, iv, ciphertext }), y el mapeo de errores (red vs HTTP vs fallo
 * de descifrado) a los textos de marca, sin filtrar detalle criptográfico.
 *
 * RED esperado: `./useNameSubmission` aún no existe → import falla, tests en rojo.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api';
import { useNameSubmission } from './useNameSubmission';

// --- Mocks del borde (crypto + capa API). ---
const fetchPublicKeyMock = vi.hoisted(() => vi.fn());
const encryptNameMock = vi.hoisted(() => vi.fn());
const apiFetchMock = vi.hoisted(() => vi.fn());
const decryptNumberMock = vi.hoisted(() => vi.fn());

vi.mock('../../crypto/fetchPublicKey', () => ({
  fetchPublicKey: fetchPublicKeyMock,
}));
vi.mock('../../crypto/encryptName', () => ({
  encryptName: encryptNameMock,
}));
vi.mock('../../crypto/decryptNumber', () => ({
  decryptNumber: decryptNumberMock,
}));
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return { ...actual, apiFetch: apiFetchMock };
});

// Payload cifrado de referencia (base64 ficticio; el orden y la forma son lo que
// importa, no la criptografía real — eso ya lo cubren los tests de crypto/).
const FAKE_PAYLOAD = {
  encryptedKey: 'ENC_KEY_B64',
  iv: 'IV_B64',
  ciphertext: 'CT_B64',
};
const FAKE_SESSION_KEY = { type: 'session-key' } as unknown as CryptoKey;
const FAKE_ENVELOPE = { iv: 'RET_IV_B64', ciphertext: 'RET_CT_B64' };

function armHappyPath() {
  fetchPublicKeyMock.mockResolvedValue('-----BEGIN PUBLIC KEY-----PEM-----END PUBLIC KEY-----');
  encryptNameMock.mockResolvedValue({ payload: FAKE_PAYLOAD, sessionKey: FAKE_SESSION_KEY });
  apiFetchMock.mockResolvedValue(FAKE_ENVELOPE);
  decryptNumberMock.mockResolvedValue('7');
}

describe('useNameSubmission — flujo feliz (acceptance #3)', () => {
  beforeEach(() => {
    armHappyPath();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('estado inicial es idle, sin número ni error', () => {
    const { result } = renderHook(() => useNameSubmission());
    expect(result.current.status).toBe('idle');
    expect(result.current.numero).toBeNull();
    expect(result.current.errorMessage).toBeNull();
  });

  it('encadena fetchPublicKey → encryptName → apiFetch → decryptNumber y expone el número', async () => {
    const { result } = renderHook(() => useNameSubmission());

    await act(async () => {
      await result.current.submit('Ana');
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.numero).toBe('7');

    // encryptName recibe el nombre y el PEM devuelto por fetchPublicKey.
    expect(encryptNameMock).toHaveBeenCalledWith(
      'Ana',
      '-----BEGIN PUBLIC KEY-----PEM-----END PUBLIC KEY-----',
    );
    // decryptNumber recibe el envelope de vuelta y la sessionKey de encryptName.
    expect(decryptNumberMock).toHaveBeenCalledWith(FAKE_ENVELOPE, FAKE_SESSION_KEY);
  });

  it('respeta el ORDEN del flujo: pública → cifrar → POST → descifrar', async () => {
    const order: string[] = [];
    fetchPublicKeyMock.mockImplementation(() => {
      order.push('fetchPublicKey');
      return Promise.resolve('PEM');
    });
    encryptNameMock.mockImplementation(() => {
      order.push('encryptName');
      return Promise.resolve({ payload: FAKE_PAYLOAD, sessionKey: FAKE_SESSION_KEY });
    });
    apiFetchMock.mockImplementation(() => {
      order.push('apiFetch');
      return Promise.resolve(FAKE_ENVELOPE);
    });
    decryptNumberMock.mockImplementation(() => {
      order.push('decryptNumber');
      return Promise.resolve('7');
    });

    const { result } = renderHook(() => useNameSubmission());
    await act(async () => {
      await result.current.submit('Ana');
    });

    expect(order).toEqual(['fetchPublicKey', 'encryptName', 'apiFetch', 'decryptNumber']);
  });

  it('hace POST a /names con el payload EXACTO { encryptedKey, iv, ciphertext }', async () => {
    const { result } = renderHook(() => useNameSubmission());
    await act(async () => {
      await result.current.submit('Ana');
    });

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/names');
    expect((init as RequestInit).method).toBe('POST');
    // El body serializa exactamente el payload cifrado, sin campos de más.
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual(FAKE_PAYLOAD);
  });

  it('no vuelve a pedir la clave pública en un segundo submit (cachea el PEM en la sesión)', async () => {
    const { result } = renderHook(() => useNameSubmission());

    await act(async () => {
      await result.current.submit('Ana');
    });
    await act(async () => {
      await result.current.submit('Ana');
    });

    expect(fetchPublicKeyMock).toHaveBeenCalledTimes(1);
  });
});

describe('useNameSubmission — estado loading (acceptance #4)', () => {
  afterEach(() => vi.clearAllMocks());

  it('pasa a loading mientras el flujo está en vuelo y a success al resolver', async () => {
    let resolveKey!: (pem: string) => void;
    fetchPublicKeyMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveKey = resolve;
      }),
    );
    encryptNameMock.mockResolvedValue({ payload: FAKE_PAYLOAD, sessionKey: FAKE_SESSION_KEY });
    apiFetchMock.mockResolvedValue(FAKE_ENVELOPE);
    decryptNumberMock.mockResolvedValue('7');

    const { result } = renderHook(() => useNameSubmission());

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.submit('Ana');
    });

    // En vuelo: loading.
    await waitFor(() => expect(result.current.status).toBe('loading'));

    // Liberamos la promesa de la clave y dejamos que el flujo termine.
    await act(async () => {
      resolveKey('PEM');
      await pending;
    });

    expect(result.current.status).toBe('success');
  });
});

describe('useNameSubmission — errores (acceptance #5, textos de marca)', () => {
  afterEach(() => vi.clearAllMocks());

  it('error de red (ApiError status 0) → estado error con la clave de mensaje de red', async () => {
    fetchPublicKeyMock.mockResolvedValue('PEM');
    encryptNameMock.mockResolvedValue({ payload: FAKE_PAYLOAD, sessionKey: FAKE_SESSION_KEY });
    apiFetchMock.mockRejectedValue(new ApiError('sin conexión', 0));

    const { result } = renderHook(() => useNameSubmission());
    await act(async () => {
      await result.current.submit('Ana');
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    // El hook expone QUÉ mensaje de marca mostrar (red vs genérico), no el detalle.
    expect(result.current.errorKind).toBe('network');
  });

  it('error HTTP (ApiError status 422) → estado error genérico, sin filtrar detalle criptográfico', async () => {
    fetchPublicKeyMock.mockResolvedValue('PEM');
    encryptNameMock.mockResolvedValue({ payload: FAKE_PAYLOAD, sessionKey: FAKE_SESSION_KEY });
    apiFetchMock.mockRejectedValue(
      new ApiError('El servidor respondió con un error (HTTP 422)', 422),
    );

    const { result } = renderHook(() => useNameSubmission());
    await act(async () => {
      await result.current.submit('Ana');
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorKind).toBe('generic');
    // No expone el mensaje crudo del error (nada de "422"/"decryption_failed").
    expect(result.current.errorMessage ?? '').not.toMatch(/422|decrypt/i);
  });

  it('fallo de descifrado (decryptNumber rechaza) → estado error genérico', async () => {
    fetchPublicKeyMock.mockResolvedValue('PEM');
    encryptNameMock.mockResolvedValue({ payload: FAKE_PAYLOAD, sessionKey: FAKE_SESSION_KEY });
    apiFetchMock.mockResolvedValue(FAKE_ENVELOPE);
    decryptNumberMock.mockRejectedValue(new Error('tag inválido'));

    const { result } = renderHook(() => useNameSubmission());
    await act(async () => {
      await result.current.submit('Ana');
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorKind).toBe('generic');
  });

  it('retry vuelve a ejecutar el flujo y llega a success cuando el back se recupera', async () => {
    fetchPublicKeyMock.mockResolvedValue('PEM');
    encryptNameMock.mockResolvedValue({ payload: FAKE_PAYLOAD, sessionKey: FAKE_SESSION_KEY });
    apiFetchMock.mockRejectedValueOnce(new ApiError('sin conexión', 0));
    apiFetchMock.mockResolvedValue(FAKE_ENVELOPE);
    decryptNumberMock.mockResolvedValue('7');

    const { result } = renderHook(() => useNameSubmission());
    await act(async () => {
      await result.current.submit('Ana');
    });
    await waitFor(() => expect(result.current.status).toBe('error'));

    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.numero).toBe('7');
  });
});
