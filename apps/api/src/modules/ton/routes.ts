import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getCurrentSession } from '../auth/session.js';
import {
  disconnectTonWallet,
  getTonWalletCapability,
  issueTonProofChallenge,
  TonProofChallengeError,
  TonProofInvalidError,
  TonProofUnsupportedWalletError,
  TonProofUnavailableForGuestError,
  TonProofWrongNetworkError,
  TonWalletAlreadyLinkedError,
  verifyAndLinkTonWallet,
} from './proof.js';
import { getVerifiedWalletBalance, TonRpcUnavailableError } from './balance.js';
import {
  createDepositIntent,
  DepositIdempotencyMismatchError,
  DepositUnavailableError,
  DepositUnavailableForGuestError,
  DepositWalletNotVerifiedError,
  getDepositOperation,
  getPendingDepositOperation,
  InvalidDepositAmountError,
} from './deposits.js';
import {
  createWithdrawalHold,
  getWithdrawalOperation,
  InsufficientWithdrawalBalanceError,
  InvalidWithdrawalAmountError,
  WithdrawalIdempotencyMismatchError,
  WithdrawalUnavailableError,
  WithdrawalUnavailableForGuestError,
  WithdrawalWalletNotVerifiedError,
} from './withdrawals.js';
import { z } from 'zod';

const DepositCommandSchema = z.object({
  operationId: z.string().uuid(),
  amount: z.string().min(1).max(32),
}).strict();

const DepositOperationParamsSchema = z.object({ operationId: z.string().uuid() });
const WithdrawalCommandSchema = z.object({
  operationId: z.string().uuid(),
  amount: z.string().min(1).max(32),
}).strict();

const WithdrawalOperationParamsSchema = z.object({ operationId: z.string().uuid() });

async function requireSession(request: FastifyRequest, reply: FastifyReply) {
  const session = await getCurrentSession(request);
  if (!session) {
    reply.status(401).send({ ok: false, error: 'unauthorized' });
    return null;
  }
  return session;
}

function sendProofError(reply: FastifyReply, error: unknown) {
  if (error instanceof TonProofUnavailableForGuestError) {
    return reply.status(403).send({ ok: false, error: 'guest_fun_only' });
  }
  if (error instanceof TonProofWrongNetworkError) {
    return reply.status(422).send({ ok: false, error: 'wrong_ton_network' });
  }
  if (error instanceof TonProofUnsupportedWalletError) {
    return reply.status(422).send({ ok: false, error: 'unsupported_ton_wallet' });
  }
  if (error instanceof TonWalletAlreadyLinkedError) {
    return reply.status(409).send({ ok: false, error: 'wallet_already_linked' });
  }
  if (error instanceof TonProofChallengeError) {
    return reply.status(409).send({ ok: false, error: 'ton_proof_challenge_invalid' });
  }
  if (error instanceof TonProofInvalidError) {
    // Do not distinguish malformed address, bad signature, stale timestamp or
    // an unsupported wallet implementation for an unauthenticated caller.
    return reply.status(401).send({ ok: false, error: 'invalid_ton_proof' });
  }
  if (error instanceof TonRpcUnavailableError) {
    return reply.status(503).send({ ok: false, error: 'ton_rpc_unavailable' });
  }
  if (error instanceof DepositUnavailableForGuestError) {
    return reply.status(403).send({ ok: false, error: 'guest_fun_only' });
  }
  if (error instanceof DepositWalletNotVerifiedError) {
    return reply.status(403).send({ ok: false, error: 'wallet_not_verified' });
  }
  if (error instanceof DepositUnavailableError) {
    return reply.status(503).send({ ok: false, error: 'deposits_unavailable' });
  }
  if (error instanceof InvalidDepositAmountError) {
    return reply.status(422).send({ ok: false, error: 'invalid_deposit_amount' });
  }
  if (error instanceof DepositIdempotencyMismatchError) {
    return reply.status(409).send({ ok: false, error: 'idempotency_mismatch' });
  }
  if (error instanceof WithdrawalUnavailableForGuestError) {
    return reply.status(403).send({ ok: false, error: 'guest_fun_only' });
  }
  if (error instanceof WithdrawalWalletNotVerifiedError) {
    return reply.status(403).send({ ok: false, error: 'wallet_not_verified' });
  }
  if (error instanceof WithdrawalUnavailableError) {
    return reply.status(503).send({ ok: false, error: 'withdrawals_unavailable' });
  }
  if (error instanceof InvalidWithdrawalAmountError) {
    return reply.status(422).send({ ok: false, error: 'invalid_withdrawal_amount' });
  }
  if (error instanceof InsufficientWithdrawalBalanceError) {
    return reply.status(409).send({ ok: false, error: 'insufficient_real_balance' });
  }
  if (error instanceof WithdrawalIdempotencyMismatchError) {
    return reply.status(409).send({ ok: false, error: 'idempotency_mismatch' });
  }
  throw error;
}

/** TON proof endpoints: cookie session identifies the challenge owner. */
export async function tonRoutes(app: FastifyInstance) {
  app.post('/ton-proof/payload', {
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    try {
      return await issueTonProofChallenge(session);
    } catch (error) {
      return sendProofError(reply, error);
    }
  });

  app.post('/ton-proof/verify', {
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    try {
      return { wallet: await verifyAndLinkTonWallet(session, request.body) };
    } catch (error) {
      return sendProofError(reply, error);
    }
  });

  app.get('/me/wallet', async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    return { wallet: await getTonWalletCapability(session.user) };
  });

  // This endpoint never accepts an address. It reads the current user's
  // server-verified wallet and returns a display amount from the configured
  // network's RPC. It does not alter Crazy Cash balances.
  app.get('/me/wallet/balance', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    try {
      return { wallet: await getVerifiedWalletBalance(session.user) };
    } catch (error) {
      return sendProofError(reply, error);
    }
  });

  app.post('/me/wallet/disconnect', async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    try {
      await disconnectTonWallet(session.user);
      return reply.status(204).send();
    } catch (error) {
      return sendProofError(reply, error);
    }
  });

  // Creates only a server-authoritative invoice. TonConnect returning a BOC
  // is intentionally not a credit confirmation; the worker observes chain
  // state and settles the ledger later.
  app.post('/deposits', {
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = DepositCommandSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ ok: false, error: 'invalid_deposit_request' });
    const session = await requireSession(request, reply);
    if (!session) return;
    try {
      return await createDepositIntent(session.user, body.data.operationId, body.data.amount);
    } catch (error) {
      return sendProofError(reply, error);
    }
  });

  // Recovery endpoint for a lost POST response or a pending settlement. The
  // operation belongs to this cookie user; no UUID reveals another account.
  app.get('/deposits/:operationId', async (request, reply) => {
    const params = DepositOperationParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: 'invalid_deposit_operation' });
    const session = await requireSession(request, reply);
    if (!session) return;
    const operation = await getDepositOperation(session.user, params.data.operationId);
    if (!operation) return reply.status(404).send({ ok: false, error: 'deposit_operation_not_found' });
    return operation;
  });

  // Mini Apps can be suspended while Tonkeeper is foregrounded. On restore,
  // Shell asks for the caller's latest durable non-terminal deposit instead of
  // trusting in-memory browser state or an address supplied by the client.
  app.get('/deposits/pending', async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    return { operation: await getPendingDepositOperation(session.user) };
  });

  // Places a durable reserve only. The API never signs or sends an on-chain
  // transfer; the isolated payout worker owns that later side effect.
  app.post('/withdrawals', {
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = WithdrawalCommandSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ ok: false, error: 'invalid_withdrawal_request' });
    const session = await requireSession(request, reply);
    if (!session) return;
    try {
      return await createWithdrawalHold(session.user, body.data.operationId, body.data.amount);
    } catch (error) {
      return sendProofError(reply, error);
    }
  });

  // Retry-safe recovery after a response loss. It is scoped to the current
  // cookie user and needs no wallet ID or withdrawal UUID from the browser.
  app.get('/withdrawals/:operationId', async (request, reply) => {
    const params = WithdrawalOperationParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ ok: false, error: 'invalid_withdrawal_operation' });
    const session = await requireSession(request, reply);
    if (!session) return;
    const operation = await getWithdrawalOperation(session.user, params.data.operationId);
    if (!operation) return reply.status(404).send({ ok: false, error: 'withdrawal_operation_not_found' });
    return operation;
  });
}
