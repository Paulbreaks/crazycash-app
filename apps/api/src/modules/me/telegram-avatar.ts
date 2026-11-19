import type { CurrentUser } from '../auth/session.js';

const MAX_AVATAR_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 2;

// Telegram documents profile images as https URLs. Keeping the allow-list
// narrow prevents a signed-but-unexpected URL from becoming an SSRF primitive.
const TELEGRAM_AVATAR_HOSTS = new Set([
  't.me',
  'telegram.me',
  'telegram.org',
]);
const TELEGRAM_AVATAR_CDN_HOST = /^cdn\d+\.telesco\.pe$/i;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
]);

export type TelegramAvatar = {
  contentType: string;
  body: Buffer;
};

function isAllowedTelegramAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      // `t.me/i/userpic/...` currently redirects to Telegram's numbered
      // telesco CDN hosts (for example cdn5.telesco.pe). Accept only that
      // strict hostname shape, never an arbitrary `*.telesco.pe` host.
      && (TELEGRAM_AVATAR_HOSTS.has(hostname) || TELEGRAM_AVATAR_CDN_HOST.test(hostname));
  } catch {
    return false;
  }
}

async function readBodyWithinLimit(response: Response): Promise<Buffer | null> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && (declaredSize < 1 || declaredSize > MAX_AVATAR_BYTES)) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_AVATAR_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function fetchAllowedAvatar(urlText: string): Promise<TelegramAvatar | null> {
  let currentUrl = urlText;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isAllowedTelegramAvatarUrl(currentUrl)) return null;

    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml;q=0.9,*/*;q=0.1' },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!response.ok) return null;
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) return null;
    const body = await readBodyWithinLimit(response);
    return body ? { contentType, body } : null;
  }

  return null;
}

/**
 * Returns only a bounded image obtained from the signed Telegram identity.
 * Failures intentionally collapse to `null`: an avatar is cosmetic and must
 * never prevent the session or game from working.
 */
export async function getTelegramAvatar(user: CurrentUser): Promise<TelegramAvatar | null> {
  if (user.accountType !== 'telegram' || !user.telegramPhotoUrl) return null;
  try {
    return await fetchAllowedAvatar(user.telegramPhotoUrl);
  } catch {
    return null;
  }
}
