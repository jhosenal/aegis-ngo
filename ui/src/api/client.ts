export class ApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type ErrorEnvelope = { error: { code: string; message: string } };
export const SESSION_EXPIRED_EVENT = 'aegis-session-expired';

export async function apiRequest<T>(
  path: string,
  options: { method?: string; token?: string | null; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,   // aborting closes the connection, which also cancels the model request on the server
  });
  if (!response.ok) {
    if (response.status === 401 && options.token && typeof window !== 'undefined') {
      // Match the rejected token at the consumer: an old request must not sign out a newer session.
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token: options.token } }));
    }
    let envelope: ErrorEnvelope;
    try {
      envelope = await response.json() as ErrorEnvelope;
    } catch {
      throw new ApiError('E_INTERNAL', `Request failed with status ${response.status}`);
    }
    if (typeof envelope.error?.code !== 'string' || typeof envelope.error.message !== 'string') {
      throw new ApiError('E_INTERNAL', `Request failed with status ${response.status}`);
    }
    throw new ApiError(envelope.error.code, envelope.error.message);
  }
  return await response.json() as T;
}
