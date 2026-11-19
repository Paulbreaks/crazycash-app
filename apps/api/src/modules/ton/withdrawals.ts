import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { uuidv7 } from '../../lib/uuid.js';
import { env } from '../../plugins/env.js';
import { prisma } from '../../plugins/prisma.js';
import type { CurrentUser } from '../auth/session.js';
import { formatCanonicalTon } from './deposits.js';

const OPERATION_TYPE = 'ton_withdrawal' as const;
const CANONICAL_UNITS_PER_TON = 1_000n;

export class WithdrawalUnavailableError extends Error {}
export class WithdrawalUnavailableForGuestError extends Error {}
export class WithdrawalWalletNotVerifiedError extends Error {}
export class InvalidWithdrawalAmountError extends Error {}
export class InsufficientWithdrawalBalanceError extends Error {}
export class WithdrawalIdempotencyMismatchError extends Error {}

export type WithdrawalOperationView = {
  operationId: string;
  type: typeof OPERATION_TYPE;
  status: 'completed';
  withdrawal: {
    uuid: string;
    status: 'held' | 'requested' | 'sent' | 'finalized' | 'failed' | 'cancelled';
    amount: string;
    createdAt: string;
  };
  balance: { mode: 'real'; value: string };
};

type StoredOperation = {
  idempotencyKey: string;
  requestFingerprint: string;
  status: string;
  result: Prisma.JsonValue | null;
};

/**
 * Parse a decimal TON amount without a JavaScript floating-point conversion.
 * A canonical unit is 0.001 TON, while accepted values must be 0.01 TON.
 */
export function parseWithdrawalAmount(value: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new InvalidWithdrawalAmountError();

  const whole = BigInt(match[1]);
  const hundredths = BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  const units = whole * CANONICAL_UNITS_PER_TON + hundredths * 10n;
  const minimum = BigInt(env.TON_WITHDRAW_MIN_UNITS);
  const maximum = BigInt(env.TON_WITHDRAW_MAX_UNITS);
  if (units < minimum || units > maximum || units % 10n !== 0n) {
    throw new InvalidWithdrawalAmountError();
  }
  return units;
}

function assertWithdrawalEnabled(): void {
  const enabled = env.TON_NETWORK === 'testnet'
    ? env.TON_WITHDRAW_ENABLE_TESTNET === '1'
    : env.TON_WITHDRAW_ENABLE_MAINNET === '1';
  if (!enabled) {
    throw new WithdrawalUnavailableError();
  }
}

function requestFingerprint(amountUnits: bigint): string {
  return createHash('sha256')
    .update(`crazy-cash:ton-withdrawal:v1:${env.TON_NETWORK}:${amountUnits.toString()}`)
    .digest('hex');
}

function assertMatchingOperation(operation: StoredOperation, amountUnits: bigint): void {
  if (operation.requestFingerprint !== requestFingerprint(amountUnits)) {
    throw new WithdrawalIdempotencyMismatchError();
  }
}

/**
 * Atomically places a withdrawal hold. It intentionally makes no RPC call and
 * never sends TON: an isolated payout worker owns that later side effect.
 */
export async function createWithdrawalHold(
  user: CurrentUser,
  operationId: string,
  amountText: string,
): Promise<WithdrawalOperationView> {
  if (user.accountType !== 'telegram') throw new WithdrawalUnavailableForGuestError();
  assertWithdrawalEnabled();
  const amount = parseWithdrawalAmount(amountText);

  const existing = await prisma.clientOperation.findUnique({
    where: { userId_type_idempotencyKey: { userId: user.id, type: OPERATION_TYPE, idempotencyKey: operationId } },
  });
  if (existing) {
    assertMatchingOperation(existing, amount);
    const replay = await getWithdrawalOperation(user, operationId);
    if (!replay) throw new Error('TON withdrawal is missing for its client operation');
    return replay;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.clientOperation.findUnique({
        where: { userId_type_idempotencyKey: { userId: user.id, type: OPERATION_TYPE, idempotencyKey: operationId } },
      });
      if (duplicate) {
        assertMatchingOperation(duplicate, amount);
        const replay = await getWithdrawalOperation(user, operationId);
        if (!replay) throw new Error('TON withdrawal is missing for its client operation');
        return replay;
      }

      // The destination is loaded only from a currently verified wallet. The
      // browser is never allowed to put an address in this request.
      const wallet = await tx.wallet.findUnique({
        where: { userId_network: { userId: user.id, network: env.TON_NETWORK } },
      });
      if (!wallet || wallet.disconnectedAt !== null) throw new WithdrawalWalletNotVerifiedError();

      // This lock serializes a REAL spin and a withdrawal for the same user.
      // The check, cached balance update and ledger append are one transaction.
      const locked = await tx.$queryRaw<Array<{ real_balance: bigint }>>`
        SELECT real_balance FROM users WHERE id = ${user.id} FOR UPDATE
      `;
      if (locked.length !== 1 || locked[0].real_balance < amount) {
        throw new InsufficientWithdrawalBalanceError();
      }

      const now = new Date();
      const balanceAfter = locked[0].real_balance - amount;
      const withdrawalUuid = uuidv7();
      const operation = await tx.clientOperation.create({
        data: {
          uuid: uuidv7(),
          userId: user.id,
          type: OPERATION_TYPE,
          idempotencyKey: operationId,
          requestFingerprint: requestFingerprint(amount),
          status: 'processing',
        },
      });
      const withdrawal = await tx.withdrawal.create({
        data: {
          uuid: withdrawalUuid,
          userId: user.id,
          walletId: wallet.id,
          network: env.TON_NETWORK,
          amount,
          status: 'held',
          idempotencyKey: operationId,
          heldAt: now,
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { realBalance: balanceAfter } });
      await tx.ledgerEntry.create({
        data: {
          uuid: uuidv7(),
          userId: user.id,
          kind: 'withdrawal_hold',
          amount: -amount,
          balanceAfter,
          idempotencyKey: `withdrawal:${withdrawal.uuid}:hold`,
          referenceUuid: withdrawal.uuid,
        },
      });
      const result: Prisma.InputJsonValue = {
        withdrawal: {
          uuid: withdrawal.uuid,
          status: 'held',
          amount: formatCanonicalTon(withdrawal.amount),
          createdAt: withdrawal.createdAt.toISOString(),
        },
        balance: { mode: 'real', value: balanceAfter.toString() },
      };
      await tx.clientOperation.update({
        where: { id: operation.id },
        data: { status: 'completed', result, completedAt: now },
      });
      return {
        operationId,
        type: OPERATION_TYPE,
        status: 'completed' as const,
        withdrawal: {
          uuid: withdrawal.uuid,
          status: 'held' as const,
          amount: formatCanonicalTon(withdrawal.amount),
          createdAt: withdrawal.createdAt.toISOString(),
        },
        balance: { mode: 'real' as const, value: balanceAfter.toString() },
      };
    });
  } catch (error) {
    // The unique client-operation key is the final idempotency boundary during
    // concurrent requests. Re-read the durable result after a losing race.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await prisma.clientOperation.findUnique({
        where: { userId_type_idempotencyKey: { userId: user.id, type: OPERATION_TYPE, idempotencyKey: operationId } },
      });
      if (replay) {
        assertMatchingOperation(replay, amount);
        const replayResult = await getWithdrawalOperation(user, operationId);
        if (!replayResult) throw new Error('TON withdrawal is missing for its client operation');
        return replayResult;
      }
    }
    throw error;
  }
}

/** Owner-scoped recovery for a POST response lost after the hold committed. */
export async function getWithdrawalOperation(
  user: CurrentUser,
  operationId: string,
): Promise<WithdrawalOperationView | null> {
  const [operation, withdrawal, account] = await Promise.all([
    prisma.clientOperation.findUnique({
    where: { userId_type_idempotencyKey: { userId: user.id, type: OPERATION_TYPE, idempotencyKey: operationId } },
    }),
    prisma.withdrawal.findUnique({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey: operationId } } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { realBalance: true } }),
  ]);
  if (!operation || !withdrawal || !account || operation.status !== 'completed') return null;
  return {
    operationId: operation.idempotencyKey,
    type: OPERATION_TYPE,
    status: 'completed',
    withdrawal: {
      uuid: withdrawal.uuid,
      status: withdrawal.status,
      amount: formatCanonicalTon(withdrawal.amount),
      createdAt: withdrawal.createdAt.toISOString(),
    },
    balance: { mode: 'real', value: account.realBalance.toString() },
  };
}
