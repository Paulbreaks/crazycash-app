import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateGuestSessionLifetime } from './session-lifetime.js';

test('guest lifetime never lets the cookie outlive its account', () => {
  const now = new Date('2026-11-17T00:00:00.000Z');
  const result = calculateGuestSessionLifetime(now, {
    guestAccountTtlHours: 24,
    sessionTtlHours: 72,
  });

  assert.equal(result.guestExpiresAt.toISOString(), '2026-11-18T00:00:00.000Z');
  assert.equal(result.sessionExpiresAt.toISOString(), '2026-11-18T00:00:00.000Z');
});

test('guest renewal honors a shorter configured session TTL', () => {
  const now = new Date('2026-11-17T00:00:00.000Z');
  const result = calculateGuestSessionLifetime(now, {
    guestAccountTtlHours: 48,
    sessionTtlHours: 12,
  });

  assert.equal(result.guestExpiresAt.toISOString(), '2026-11-19T00:00:00.000Z');
  assert.equal(result.sessionExpiresAt.toISOString(), '2026-11-17T12:00:00.000Z');
});
