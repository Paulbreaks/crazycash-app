import { config } from './config';

/**
 * Optional signal lets the browser shell terminate a request when a mobile
 * browser freezes or discards the page. The game itself never owns HTTP.
 */
export type ApiRequestOptions = {
  signal?: AbortSignal;
};

export async function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    // Гостевая сессия живёт только в HttpOnly cookie API, а не в localStorage.
    credentials: 'include',
    signal: options.signal,
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status);
  }
  return response.json() as Promise<T>;
}

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(`API request failed: ${status}`);
  }
}

export async function apiPost<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const responseBody = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new ApiRequestError(response.status, responseBody?.error);
  }
  return responseBody as T;
}
