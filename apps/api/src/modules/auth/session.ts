import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type AccountType } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uuidv7 } from '../../lib/uuid.js';
import { env } from '../../plugins/env.js';
import { prisma } from '../../plugins/prisma.js';
import { calculateGuestSessionLifetime } from './session-lifetime.js';

export const SESSION_COOKIE_NAME = 'cc_session';

const currentUserSelect = {
  id: true,
  uuid: true,
  username: true,
  telegramPhotoUrl: true,
  accountType: true,
  funBalance: true,
  realBalance: true,
  guestExpiresAt: true,
} satisfies Prisma.UserSelect;

export type CurrentUser = {
  id: number;
  uuid: string;
  username: string | null;
  telegramPhotoUrl: string | null;
  accountType: AccountType;
  funBalance: bigint;
  realBalance: bigint;
  guestExpiresAt: Date | null;
};

type AuthenticatedSession = {
	id: bigint;
	user: CurrentUser;
};

type CreatedGuestSession = {
  token: string;
  expiresAt: Date;
  user: CurrentUser;
};

type CreatedAuthenticatedSession = {
  token: string;
  expiresAt: Date;
};

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function requestUserAgent(request: FastifyRequest): string | null {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 512) : null;
}

/**
 * Создаёт гостя и серверную сессию в одной транзакции. В cookie отправляется
 * только случайный токен; в MySQL остаётся лишь его SHA-256 хэш.
 */
export async function createGuestSession(request: FastifyRequest): Promise<CreatedGuestSession> {
  const now = new Date();
  const { guestExpiresAt, sessionExpiresAt } = calculateGuestSessionLifetime(now, {
    guestAccountTtlHours: env.GUEST_ACCOUNT_TTL_HOURS,
    sessionTtlHours: env.SESSION_TTL_HOURS,
  });

  // Коллизия 256-битного токена практически невозможна, но повтор гарантирует
  // корректное поведение даже при срабатывании уникального индекса.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashSessionToken(token);

    try {
      const user = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            uuid: uuidv7(),
            accountType: 'guest',
            guestExpiresAt,
            funBalance: BigInt(env.GUEST_FUN_START_BALANCE),
          },
          select: currentUserSelect,
        });

        await tx.session.create({
          data: {
            uuid: uuidv7(),
            tokenHash,
            userId: createdUser.id,
            expiresAt: sessionExpiresAt,
            createdIp: request.ip.slice(0, 45),
            userAgent: requestUserAgent(request),
          },
        });
        await tx.playerStatistics.create({
          data: {
            sourceUserUuid: createdUser.uuid,
            accountType: 'guest',
            firstIp: request.ip.slice(0, 45),
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
        return createdUser;
      });

      return { token, expiresAt: sessionExpiresAt, user };
    } catch (error) {
      const isTokenHashCollision = error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002';
      if (!isTokenHashCollision || attempt === 2) throw error;
    }
  }

  throw new Error('Unable to create guest session');
}

/** Creates a fresh session after a verified non-guest authentication flow. */
export async function createAuthenticatedSession(
  request: FastifyRequest,
  userId: number,
): Promise<CreatedAuthenticatedSession> {
  const now = new Date();
  const expiresAt = addHours(now, env.SESSION_TTL_HOURS);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString('base64url');
    try {
      await prisma.session.create({
        data: {
          uuid: uuidv7(),
          tokenHash: hashSessionToken(token),
          userId,
          expiresAt,
          createdIp: request.ip.slice(0, 45),
          userAgent: requestUserAgent(request),
        },
      });
      return { token, expiresAt };
    } catch (error) {
      const isTokenHashCollision = error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002';
      if (!isTokenHashCollision || attempt === 2) throw error;
    }
  }

  throw new Error('Unable to create authenticated session');
}

/** Returns null for an absent, expired or revoked session without disclosing why. */
export async function getCurrentSession(request: FastifyRequest): Promise<AuthenticatedSession | null> {
  const token = request.cookies[SESSION_COOKIE_NAME];
	if (!token || token.length > 256) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: currentUserSelect },
    },
  });
	if (!session) return null;

  const now = new Date();
  const guestExpired = session.user.accountType === 'guest'
    && (!session.user.guestExpiresAt || session.user.guestExpiresAt <= now);
	if (session.revokedAt || session.expiresAt <= now || guestExpired) {
    await prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });
		return null;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastUsedAt: now },
  });
	return { id: session.id, user: session.user };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  const maxAgeSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // localhost over HTTP cannot retain Secure cookies. Production always
    // sends Secure; the cookie is still HttpOnly and SameSite=Lax locally.
    secure: env.NODE_ENV === 'production',
    expires: expiresAt,
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
  });
}

export async function revokeCurrentSession(request: FastifyRequest): Promise<void> {
  const current = await getCurrentSession(request);
  if (!current) return;
  await prisma.session.updateMany({
    where: { id: current.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
