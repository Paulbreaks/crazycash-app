import { apiGet, apiPost } from '../../shared/api-client';
import { config } from '../../shared/config';

/**
 * Ответ после создания браузерного гостя. Сессионный токен намеренно не
 * возвращается: API записывает его только в HttpOnly cookie.
 */
export type GuestSession = {
  authorized: true;
  activeMode: 'fun';
  realModeAvailable: false;
  user: {
    uuid: string;
    username: string | null;
    accountType: 'guest';
  };
  balances: {
    fun: string;
    real: string;
  };
  expiresAt: string;
};

export function createGuestSession() {
  return apiPost<GuestSession>('/auth/guest', {});
}

export type TelegramSession = {
  authorized: true;
  activeMode: 'fun';
  realModeAvailable: boolean;
  user: {
    uuid: string;
    username: string | null;
    accountType: 'telegram';
  };
  balances: {
    fun: string;
    real: string;
  };
  expiresAt: string;
};

/** Sends the opaque, signed raw initData; no Telegram user fields are trusted here. */
export function authenticateTelegram(initData: string) {
  return apiPost<TelegramSession>('/auth/telegram', { initData });
}

export type TonConnectAction =
  | { action: 'open_telegram'; url: string }
  | { action: 'open_ton_connect' }
  | { action: 'unavailable' };

export function getTonConnectAction(surface: 'browser' | 'telegram') {
  return apiGet<TonConnectAction>(`/auth/connect-action?surface=${surface}`);
}

const AVATAR_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
] as const);

export type TelegramAvatar = {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/svg+xml';
  data: string;
};

/**
 * Reads the avatar only from our authenticated API endpoint. `fetch` is used
 * here rather than the JSON client because Godot needs the image bytes.
 */
export async function getTelegramAvatar(signal?: AbortSignal): Promise<TelegramAvatar | null> {
  const response = await fetch(`${config.apiBaseUrl}/me/avatar`, {
    credentials: 'include',
    signal,
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`avatar_request_failed:${response.status}`);

  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !AVATAR_CONTENT_TYPES.has(contentType as TelegramAvatar['contentType'])) return null;

  const bytes = new Uint8Array(await response.arrayBuffer());
  // Kept in sync with API and Godot limits. Do not forward an unexpectedly
  // large body into postMessage / the WebAssembly runtime.
  if (bytes.byteLength < 1 || bytes.byteLength > 1_000_000) return null;

  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return {
    contentType: contentType as TelegramAvatar['contentType'],
    data: btoa(binary),
  };
}
