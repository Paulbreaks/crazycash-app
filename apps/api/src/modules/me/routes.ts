import type { FastifyInstance } from 'fastify';
import { getCurrentSession } from '../auth/session.js';
import { getPlayerBalances, getPlayerSession } from '../slot777/service.js';
import { getTelegramAvatar } from './telegram-avatar.js';

function sendUnauthorized(reply: { status: (statusCode: number) => { send: (body: unknown) => unknown } }) {
	return reply.status(401).send({ ok: false, error: 'unauthorized' });
}

/** Current-user endpoints always resolve the server-side cookie session. */
export async function meRoutes(app: FastifyInstance) {
  app.get('/me/session', async (request, reply) => {
		const session = await getCurrentSession(request);
		if (!session) return sendUnauthorized(reply);
		return await getPlayerSession(session.user);
  });

  app.get('/me/balances', async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return sendUnauthorized(reply);
    return getPlayerBalances(session.user);
  });

  // The avatar is fetched by the API after the signed Telegram initData was
  // verified. The browser Shell receives image bytes, while Godot never sees
  // or requests the Telegram CDN URL.
  app.get('/me/avatar', async (request, reply) => {
    const session = await getCurrentSession(request);
    if (!session) return sendUnauthorized(reply);

    const avatar = await getTelegramAvatar(session.user);
    if (!avatar) return reply.status(204).send();

    reply
      // A device can switch from a guest to another Telegram account. Do not
      // let an HTTP cache reuse one account's photo for the next session.
      .header('Cache-Control', 'private, no-store')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .type(avatar.contentType)
      .send(avatar.body);
  });
}
