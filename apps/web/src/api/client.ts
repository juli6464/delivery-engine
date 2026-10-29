import type { ChatResponse, MerchantBilling, Role } from './types';

/** Todas las llamadas pasan por el proxy de Vite (/api), que agrega la API key del lado del servidor. */
const BASE = '/api';
const TIMEOUT_MS = 45_000;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      signal,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
  } catch (err) {
    if (init.signal?.aborted) throw err; // cancelada por el componente: no es un error para mostrar
    const timedOut = timeout.aborted;
    throw new ApiError(timedOut ? 'La solicitud tardó demasiado.' : 'No hay conexión con el servidor.', 0, true);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Error ${res.status}`;
    throw new ApiError(message, res.status, body?.retryable ?? res.status >= 500);
  }
  return body as T;
}

export const api = {
  chat: (messages: { role: Role; content: string }[], signal?: AbortSignal) =>
    request<ChatResponse>('/chat', { method: 'POST', body: JSON.stringify({ messages }), signal }),

  billing: (from: string, to: string, signal?: AbortSignal) =>
    request<{ results: MerchantBilling[] }>(`/reports/billing?${new URLSearchParams({ from, to })}`, { signal }),
};
