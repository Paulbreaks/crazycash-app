import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const TelegramUserSchema = z.object({
  // Telegram documents IDs as values that may exceed 32 bits. They remain
  // within JavaScript's safe integer range, then are stored as MySQL BIGINT.
  id: z.number().int().positive().safe(),
  username: z.string().regex(/^[A-Za-z0-9_]{5,32}$/).optional(),
  // This field remains inside signed `initData` and is therefore trusted only
  // after the HMAC check below succeeds. It is never accepted as a standalone
  // client request.
  photo_url: z.string().url().max(2_048).optional(),
}).passthrough();

export type VerifiedTelegramIdentity = {
  telegramId: string;
  username: string | null;
  photoUrl: string | null;
};

export class TelegramInitDataError extends Error {
  constructor(readonly code: 'malformed' | 'invalid_signature' | 'expired') {
    super('Telegram initData validation failed');
  }
}

type VerifyOptions = {
  botToken: string;
  maxAgeSeconds: number;
  now?: Date;
};

/**
 * Validates raw `Telegram.WebApp.initData`, never `initDataUnsafe`.
 *
 * Algorithm follows Telegram's HMAC-SHA-256 specification. All unknown fields
 * remain inside the signed data-check-string so additions by Telegram don't
 * weaken verification. Duplicate keys are rejected rather than interpreted
 * differently by URLSearchParams and the signature construction.
 */
export function verifyTelegramInitData(initData: string, options: VerifyOptions): VerifiedTelegramIdentity {
  if (!options.botToken || initData.length === 0 || initData.length > 8_192) {
    throw new TelegramInitDataError('malformed');
  }

  const parameters = new URLSearchParams(initData);
  const pairs = [...parameters.entries()];
  const seen = new Set<string>();
  for (const [key] of pairs) {
    if (!key || seen.has(key)) throw new TelegramInitDataError('malformed');
    seen.add(key);
  }

  const receivedHash = parameters.get('hash');
  const authDate = parameters.get('auth_date');
  const userValue = parameters.get('user');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)
    || !authDate || !/^\d{1,16}$/.test(authDate) || !userValue) {
    throw new TelegramInitDataError('malformed');
  }

  const dataCheckString = pairs
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(options.botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(receivedHash, 'hex');
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    throw new TelegramInitDataError('invalid_signature');
  }

  const authDateSeconds = Number(authDate);
  const nowSeconds = Math.floor((options.now?.getTime() ?? Date.now()) / 1_000);
  // A small positive clock skew allows Telegram/client clock differences but
  // prevents a signed future timestamp from remaining valid indefinitely.
  if (authDateSeconds > nowSeconds + 30 || nowSeconds - authDateSeconds > options.maxAgeSeconds) {
    throw new TelegramInitDataError('expired');
  }

  let parsedUser: unknown;
  try {
    parsedUser = JSON.parse(userValue);
  } catch {
    throw new TelegramInitDataError('malformed');
  }
  const user = TelegramUserSchema.safeParse(parsedUser);
  if (!user.success) throw new TelegramInitDataError('malformed');

  return {
    telegramId: String(user.data.id),
    username: user.data.username ?? null,
    photoUrl: user.data.photo_url ?? null,
  };
}
