import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { TelegramInitDataError, verifyTelegramInitData } from './telegram.js';

const BOT_TOKEN = '123456:unit-test-bot-token';
const NOW = new Date('2026-11-17T00:00:00.000Z');

function signInitData(values: Record<string, string>): string {
  const dataCheckString = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...values, hash }).toString();
}

function verify(initData: string) {
  return verifyTelegramInitData(initData, { botToken: BOT_TOKEN, maxAgeSeconds: 300, now: NOW });
}

test('accepts a valid signed Telegram initData packet', () => {
  const initData = signInitData({
    auth_date: String(Math.floor(NOW.getTime() / 1_000)),
    query_id: 'AAH-test',
    user: JSON.stringify({ id: 123456789, username: 'test_player', photo_url: 'https://t.me/i/userpic/320/test.jpg' }),
  });

  assert.deepEqual(verify(initData), {
    telegramId: '123456789',
    username: 'test_player',
    photoUrl: 'https://t.me/i/userpic/320/test.jpg',
  });
});

test('rejects a modified signed field', () => {
  const initData = signInitData({
    auth_date: String(Math.floor(NOW.getTime() / 1_000)),
    user: JSON.stringify({ id: 123456789, username: 'test_player' }),
  }).replace('test_player', 'other_player');

  assert.throws(() => verify(initData), (error: unknown) => error instanceof TelegramInitDataError && error.code === 'invalid_signature');
});

test('rejects duplicate parameters before interpreting the packet', () => {
  const initData = `${signInitData({
    auth_date: String(Math.floor(NOW.getTime() / 1_000)),
    user: JSON.stringify({ id: 123456789 }),
  })}&user=${encodeURIComponent(JSON.stringify({ id: 1 }))}`;

  assert.throws(() => verify(initData), (error: unknown) => error instanceof TelegramInitDataError && error.code === 'malformed');
});

test('rejects a valid signature outside the replay window', () => {
  const initData = signInitData({
    auth_date: String(Math.floor(NOW.getTime() / 1_000) - 301),
    user: JSON.stringify({ id: 123456789 }),
  });

  assert.throws(() => verify(initData), (error: unknown) => error instanceof TelegramInitDataError && error.code === 'expired');
});
