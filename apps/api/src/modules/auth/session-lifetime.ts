export type SessionLifetimeConfig = {
  guestAccountTtlHours: number;
  sessionTtlHours: number;
};

function addHours(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

/**
 * One source of truth for a browser guest's rolling account and cookie window.
 * The cookie may never outlive the disposable account that owns it.
 */
export function calculateGuestSessionLifetime(
  now: Date,
  config: SessionLifetimeConfig,
): { guestExpiresAt: Date; sessionExpiresAt: Date } {
  const guestExpiresAt = addHours(now, config.guestAccountTtlHours);
  const sessionExpiresAt = addHours(now, Math.min(config.guestAccountTtlHours, config.sessionTtlHours));
  return { guestExpiresAt, sessionExpiresAt };
}
