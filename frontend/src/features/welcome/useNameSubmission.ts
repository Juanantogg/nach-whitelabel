import { useCallback, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../../api';
import { fetchPublicKey } from '../../crypto/fetchPublicKey';
import { encryptName } from '../../crypto/encryptName';
import { decryptNumber } from '../../crypto/decryptNumber';

export type SubmissionStatus = 'idle' | 'loading' | 'success' | 'error';
export type ErrorKind = 'network' | 'generic';

export interface UseNameSubmissionResult {
  status: SubmissionStatus;
  numero: string | null;
  errorMessage: string | null;
  errorKind: ErrorKind | null;
  submit: (name: string) => Promise<void>;
  retry: () => Promise<void>;
}

/**
 * Orquesta el flujo end-to-end de captura de nombre, aislado de la UI:
 *   fetchPublicKey → encryptName → apiFetch('/names', POST) → decryptNumber.
 *
 * Máquina idle → loading → success | error. Cachea el PEM de la pública en una
 * `ref` durante la vida de la pantalla, así los reintentos no repiten el GET.
 * El mapeo de errores no expone detalle criptográfico: un `ApiError` de red
 * (status 0) → `network`; cualquier otro fallo → `generic`. El `errorMessage`
 * concreto de marca lo elige la UI a partir de `errorKind`.
 */
export function useNameSubmission(): UseNameSubmissionResult {
  const [status, setStatus] = useState<SubmissionStatus>('idle');
  const [numero, setNumero] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Caché de sesión del PEM público: se pide una sola vez por vida de pantalla.
  const publicKeyRef = useRef<string | null>(null);
  // Último nombre enviado, para que `retry` reejecute el mismo flujo.
  const lastNameRef = useRef<string | null>(null);

  const run = useCallback(async (name: string): Promise<void> => {
    lastNameRef.current = name;
    setStatus('loading');
    setErrorKind(null);
    setErrorMessage(null);

    try {
      if (publicKeyRef.current === null) {
        publicKeyRef.current = await fetchPublicKey();
      }
      const { payload, sessionKey } = await encryptName(name, publicKeyRef.current);

      const envelope = await apiFetch<{ iv: string; ciphertext: string }>('/names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const decoded = await decryptNumber(envelope, sessionKey);

      setNumero(decoded);
      setStatus('success');
    } catch (error) {
      const kind: ErrorKind =
        error instanceof ApiError && error.status === 0 ? 'network' : 'generic';
      setErrorKind(kind);
      // Clave neutra para la UI; nunca el mensaje crudo del error.
      setErrorMessage(kind);
      setStatus('error');
    }
  }, []);

  const submit = useCallback((name: string) => run(name), [run]);

  const retry = useCallback(() => {
    const name = lastNameRef.current;
    if (name === null) return Promise.resolve();
    return run(name);
  }, [run]);

  return { status, numero, errorMessage, errorKind, submit, retry };
}
