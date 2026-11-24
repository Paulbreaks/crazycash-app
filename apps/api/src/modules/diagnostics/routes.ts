import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const ClientDiagnosticSchema = z.object({
  event: z.enum([
    'shell_runtime_error',
    'shell_unhandled_rejection',
    'game_webgl2_unavailable',
  ]),
  message: z.string().trim().min(1).max(500),
  route: z.literal('/game'),
}).strict();

/** Operational-only browser diagnostics; never persisted or tied to a session. */
export async function diagnosticsRoutes(app: FastifyInstance) {
  app.post('/client-diagnostics', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = ClientDiagnosticSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ ok: false, error: 'invalid_client_diagnostic' });

    app.log.warn({
      clientEvent: body.data.event,
      clientMessage: body.data.message,
      route: body.data.route,
      userAgent: request.headers['user-agent']?.slice(0, 512),
    }, 'Client diagnostic');
    return reply.status(204).send();
  });
}
