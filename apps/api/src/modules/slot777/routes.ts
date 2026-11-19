import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  getSlot777RuleSummary,
  getSlot777TheoreticalRtpBasisPoints,
  simulateSlot777,
  spinSlot777,
} from './engine.js';
import { getCurrentSession, type CurrentUser } from '../auth/session.js';
import {
  executeSpin,
  claimFunCredits,
  getFunCreditOperation,
  getSpinByRequestId,
  getSpinByUuid,
  getSpinHistory,
  GuestFunOnlyError,
  IdempotencyMismatchError,
  InsufficientFunBalanceError,
  InsufficientRealBalanceError,
  REAL_DENOMINATIONS,
  SLOT777_ALLOWED_CREDIT_BETS,
} from './service.js';

const SimulationQuerySchema = z.object({
  spins: z.coerce.number().int().min(1).max(2_000_000).default(100_000),
});

const CreditBetSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform((value) => BigInt(value))
  .refine((value) => SLOT777_ALLOWED_CREDIT_BETS.includes(value as (typeof SLOT777_ALLOWED_CREDIT_BETS)[number]));

const SpinRequestBaseSchema = z.object({
  bet: CreditBetSchema,
  requestId: z.string().min(1).max(128),
});

const SpinBodySchema = z.discriminatedUnion('mode', [
  SpinRequestBaseSchema.extend({ mode: z.literal('fun') }),
  SpinRequestBaseSchema.extend({
    mode: z.literal('real'),
    denomination: z.enum(REAL_DENOMINATIONS),
  }),
]);

const SpinHistoryQuerySchema = z.object({
  mode: z.enum(['fun', 'real']).default('fun'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

const SpinParamsSchema = z.object({
  uuid: z.string().uuid(),
});

const FunCreditCommandSchema = z.object({
  // The Shell creates one ID for one deliberate click and reuses it while
  // reconciling a timeout. UUID format prevents arbitrary unbounded keys.
  operationId: z.string().uuid(),
});

const OperationParamsSchema = z.object({
  operationId: z.string().uuid(),
});

const OperationQuerySchema = z.object({
  type: z.literal('fun_credit_claim'),
});

const SpinDetailQuerySchema = z.object({
  mode: z.enum(['fun', 'real']).default('fun'),
});

const SpinRequestLookupQuerySchema = z.object({
  mode: z.enum(['fun', 'real']),
  requestId: z.string().min(1).max(128),
});

async function requireCurrentUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<CurrentUser | null> {
  const session = await getCurrentSession(request);
  if (!session) {
    reply.status(401).send({ ok: false, error: 'unauthorized' });
    return null;
  }
  return session.user;
}

export async function slot777Routes(app: FastifyInstance) {
  app.get('/crazy-cash/theory', async () => ({
    targetRtpBasisPoints: getSlot777TheoreticalRtpBasisPoints(),
    rules: getSlot777RuleSummary(),
  }));

  app.get('/crazy-cash/spin', async () => spinSlot777());

  app.get('/crazy-cash/config', async () => ({
    modes: [
      { id: 'fun', available: true },
      // This describes that the REAL engine is enabled. Per-user permission
      // comes only from /me/session.realModeAvailable and is rechecked on
      // every POST /spins by the service.
      { id: 'real', available: true, requires: ['telegram'] },
    ],
    bet: {
      values: SLOT777_ALLOWED_CREDIT_BETS.map(String),
    },
    realDenominations: REAL_DENOMINATIONS,
    targetRtpBasisPoints: getSlot777TheoreticalRtpBasisPoints(),
    rules: getSlot777RuleSummary(),
  }));

  // FUN-подпитка — это игровая механика без денежной ценности. Сервер сам
  // проверяет порог, поэтому клиент не может нарисовать себе кредиты.
  app.post('/crazy-cash/fun-credits', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = FunCreditCommandSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ ok: false, error: 'invalid_operation_request' });
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const operation = await claimFunCredits(user, body.data.operationId);
    if (operation.status === 'rejected') {
      return reply.status(409).send({ ok: false, error: operation.error, operation });
    }
    return operation;
  });

  // This endpoint is the recovery path after a browser loses a POST response.
  // It is owner-scoped and returns only the public result saved by the command.
  app.get('/crazy-cash/operations/:operationId', async (request, reply) => {
    const params = OperationParamsSchema.safeParse(request.params);
    const query = OperationQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ ok: false, error: 'invalid_operation_query' });
    }
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const operation = await getFunCreditOperation(user, params.data.operationId);
    if (!operation) return reply.status(404).send({ ok: false, error: 'operation_not_found' });
    return operation;
  });

  app.post('/crazy-cash/spins', {
    // Отдельный лимит для реальных действий игрока; глобальный лимит не
    // заменяет этот, потому что его могут занять посторонние запросы.
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = SpinBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: 'invalid_spin_request' });
    }
    const user = await requireCurrentUser(request, reply);
    if (!user) return;

    try {
      return await executeSpin(user, body.data);
    } catch (error) {
      if (error instanceof InsufficientFunBalanceError) {
        return reply.status(409).send({ ok: false, error: 'insufficient_fun_balance' });
      }
      if (error instanceof InsufficientRealBalanceError) {
        return reply.status(409).send({ ok: false, error: 'insufficient_real_balance' });
      }
      if (error instanceof IdempotencyMismatchError) {
        return reply.status(409).send({ ok: false, error: 'idempotency_mismatch' });
      }
      if (error instanceof GuestFunOnlyError) {
        return reply.status(403).send({ ok: false, error: 'guest_fun_only' });
      }
      throw error;
    }
  });

  // A network timeout after a committed spin is not an instruction to spin
  // again. The Shell uses this owner-scoped lookup with the same request ID.
  app.get('/crazy-cash/spins/by-request', async (request, reply) => {
    const query = SpinRequestLookupQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ ok: false, error: 'invalid_spin_request_lookup' });
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    try {
      const spin = await getSpinByRequestId(user, query.data.requestId, query.data.mode);
      if (!spin) return reply.status(404).send({ ok: false, error: 'spin_not_found' });
      return spin;
    } catch (error) {
      if (error instanceof GuestFunOnlyError) return reply.status(403).send({ ok: false, error: 'guest_fun_only' });
      throw error;
    }
  });

  app.get('/crazy-cash/spins', async (request, reply) => {
    const query = SpinHistoryQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ ok: false, error: 'invalid_spin_history_query' });
    const user = await requireCurrentUser(request, reply);
    if (!user) return;

    try {
      return await getSpinHistory(user, query.data);
    } catch (error) {
      if (error instanceof GuestFunOnlyError) return reply.status(403).send({ ok: false, error: 'guest_fun_only' });
      throw error;
    }
  });

  app.get('/crazy-cash/spins/:uuid', async (request, reply) => {
    const params = SpinParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: 'invalid_spin_uuid' });

    const query = SpinDetailQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ ok: false, error: 'invalid_spin_query' });
    const user = await requireCurrentUser(request, reply);
    if (!user) return;

    try {
      const spin = await getSpinByUuid(user, params.data.uuid, query.data.mode);
      if (!spin) return reply.status(404).send({ ok: false, error: 'spin_not_found' });
      return spin;
    } catch (error) {
      if (error instanceof GuestFunOnlyError) return reply.status(403).send({ ok: false, error: 'guest_fun_only' });
      throw error;
    }
  });

  app.get('/crazy-cash/simulate', async (request, reply) => {
    const query = SimulationQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ ok: false, error: 'invalid_simulation_count' });
    }

    return simulateSlot777(query.data.spins);
  });
}
