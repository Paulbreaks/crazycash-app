import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  clearSessionCookie,
  createAuthenticatedSession,
  createGuestSession,
  getCurrentSession,
  revokeCurrentSession,
  setSessionCookie,
} from './session.js';
import { env } from '../../plugins/env.js';
import { getPlayerSession } from '../slot777/service.js';
import { upsertTelegramPlayer } from './service.js';
import { TelegramInitDataError, verifyTelegramInitData } from './telegram.js';

const EmptyBodySchema = z.object({}).strict();
const ConnectActionQuerySchema = z.object({
  surface: z.enum(['browser', 'telegram']),
});
const TelegramAuthBodySchema = z.object({
  // This is raw `Telegram.WebApp.initData`; never accept initDataUnsafe or an
  // arbitrary Telegram ID/username from the client.
  initData: z.string().min(1).max(8_192),
}).strict();

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/guest', {
    config: {
      // Снижает ценность массового создания одноразовых гостевых аккаунтов.
      rateLimit: { max: 10, timeWindow: '1 hour' },
    },
  }, async (request, reply) => {
    const body = EmptyBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ ok: false, error: 'invalid_guest_request' });

    const session = await createGuestSession(request);
    setSessionCookie(reply, session.token, session.expiresAt);
    return reply.status(201).send({
      authorized: true,
      activeMode: 'fun',
      realModeAvailable: false,
      user: { uuid: session.user.uuid, username: session.user.username, accountType: session.user.accountType },
      balances: { fun: session.user.funBalance.toString(), real: session.user.realBalance.toString() },
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    await revokeCurrentSession(request);
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  /**
   * Единственный серверный источник маршрута для кнопки CONNECT в Godot.
   * Клиент может сообщить только своё окружение; URL строится из проверенного
   * конфигурационного имени бота, а не принимается из запроса.
   */
  app.get('/auth/connect-action', async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.status(401).send({ ok: false, error: 'unauthorized' });

    const query = ConnectActionQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ ok: false, error: 'invalid_connect_surface' });

    if (query.data.surface === 'telegram') {
      // Этот сигнал открывает только UI TonConnect. Он не подтверждает wallet
      // proof и не предоставляет доступ к REAL-операциям.
      return { action: 'open_ton_connect' as const };
    }

    if (!env.TELEGRAM_BOT_USERNAME) {
      return { action: 'unavailable' as const };
    }

    return {
      action: 'open_telegram' as const,
      url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=play`,
    };
  });

  app.post('/auth/telegram', {
    // A valid initData has a short replay window, but throttling still limits
    // brute-force and unnecessary repeated session rotations.
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const body = TelegramAuthBodySchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ ok: false, error: 'invalid_telegram_request' });
    if (!env.TELEGRAM_BOT_TOKEN) {
      return reply.status(503).send({ ok: false, error: 'telegram_auth_unavailable' });
    }

    try {
      const identity = verifyTelegramInitData(body.data.initData, {
        botToken: env.TELEGRAM_BOT_TOKEN,
        maxAgeSeconds: env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
      });
      const user = await upsertTelegramPlayer(identity, request.ip.slice(0, 45));
      const session = await createAuthenticatedSession(request, user.id);

      // Do this only after signature verification and successful creation of
      // the new session. A forged or malformed request cannot log anyone out.
      await revokeCurrentSession(request);
      setSessionCookie(reply, session.token, session.expiresAt);

      return {
        ...await getPlayerSession(user),
        expiresAt: session.expiresAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof TelegramInitDataError) {
        // Do not reveal whether the failure was malformed, expired or had a
        // bad signature; the client cannot safely act differently either way.
        return reply.status(401).send({ ok: false, error: 'invalid_telegram_init_data' });
      }
      throw error;
    }
  });
}
