import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../plugins/prisma.js';
import type { CurrentUser } from '../auth/session.js';
import { spinSlot777, type Slot777Spin } from './engine.js';
import { uuidv7 } from '../../lib/uuid.js';
import { calculateGuestSessionLifetime } from '../auth/session-lifetime.js';
import { env } from '../../plugins/env.js';

export class InsufficientFunBalanceError extends Error {}
export class InsufficientRealBalanceError extends Error {}
export class IdempotencyMismatchError extends Error {}
export class GuestFunOnlyError extends Error {}

export type SlotMode = 'fun' | 'real';
export const REAL_DENOMINATIONS = ['0.01', '0.1', '1', '10'] as const;
export type RealDenomination = (typeof REAL_DENOMINATIONS)[number];

// Ставки — кредиты, а не TON. Клиент может показать только эти три значения,
// но сервер повторно закрепляет правило, потому что браузер не является доверенным.
export const SLOT777_ALLOWED_CREDIT_BETS = [10n, 100n, 1000n] as const;

// real_balance хранится в тысячных TON: 1 unit = 0.001 TON.
// Каждая деноминация задаёт, сколько таких units стоит один отображаемый кредит.
export const REAL_DENOMINATION_UNITS: Readonly<Record<RealDenomination, bigint>> = {
  '0.01': 1n,
  '0.1': 10n,
  '1': 100n,
  '10': 1000n,
};

// Железное правило real_balance: 10 целых units = 0.01 TON.
// Это дополнительно закреплено CHECK-констрейнтом в MySQL.
export const REAL_BALANCE_MIN_UNIT = 10n;

const FUN_CREDIT_THRESHOLD = 100n;
const FUN_CREDIT_AMOUNT = 1_000n;
const FUN_CREDIT_OPERATION_TYPE = 'fun_credit_claim' as const;
const FUN_CREDIT_REQUEST_FINGERPRINT = createHash('sha256').update('crazy-cash:fun-credit-claim:v1').digest('hex');

type PersistedSpin = {
  uuid: string;
  requestId: string;
  denomination?: string;
  combination: string;
  rule: string;
  multiplier: number;
  bet: bigint;
  payout: bigint;
  balanceAfter: bigint;
  createdAt: Date;
};

export type SpinRequest =
  | { bet: bigint; mode: 'fun'; requestId: string }
  | { bet: bigint; mode: 'real'; requestId: string; denomination: RealDenomination };

export interface SlotSpinView extends Slot777Spin {
  uuid: string;
  // Public amounts remain credits for both modes. For REAL the database keeps
  // canonical TON units and this DTO converts them using the denomination.
  bet: string;
  payout: string;
  denomination?: RealDenomination;
  balance: {
    mode: SlotMode;
    // FUN: credits. REAL: canonical internal TON units (never a float).
    value: string;
  };
  createdAt: string;
}

export interface SlotSpinResult extends SlotSpinView {
  replayed: boolean;
}

export type FunCreditOperationView = {
  operationId: string;
  type: typeof FUN_CREDIT_OPERATION_TYPE;
  status: 'completed' | 'rejected' | 'processing' | 'failed';
  credited?: string;
  balance?: { mode: 'fun'; value: string };
  error?: 'fun_credit_balance_too_high';
};

type StoredFunCreditOperation = {
  idempotencyKey: string;
  requestFingerprint: string;
  status: string;
  errorCode: string | null;
  result: Prisma.JsonValue | null;
};

function isRealDenomination(value: string | undefined): value is RealDenomination {
  return value !== undefined && Object.hasOwn(REAL_DENOMINATION_UNITS, value);
}

function getRealDenominationUnits(denomination: RealDenomination): bigint {
  return REAL_DENOMINATION_UNITS[denomination];
}

function toSpinView(spin: PersistedSpin, mode: SlotMode): SlotSpinView {
  const denomination = mode === 'real' && isRealDenomination(spin.denomination)
    ? spin.denomination
    : undefined;
  const creditUnit = denomination ? getRealDenominationUnits(denomination) : 1n;

  return {
    uuid: spin.uuid,
    combination: spin.combination,
    digits: spin.combination.split('').map(Number) as [number, number, number],
    rule: spin.rule as Slot777Spin['rule'],
    multiplier: spin.multiplier,
    bet: (spin.bet / creditUnit).toString(),
    payout: (spin.payout / creditUnit).toString(),
    ...(denomination ? { denomination } : {}),
    balance: {
      mode,
      value: spin.balanceAfter.toString(),
    },
    createdAt: spin.createdAt.toISOString(),
  };
}

function toSpinResult(spin: PersistedSpin, mode: SlotMode): SlotSpinResult {
  return { ...toSpinView(spin, mode), replayed: false };
}

function isAllowedCreditBet(bet: bigint): boolean {
  return SLOT777_ALLOWED_CREDIT_BETS.includes(bet as (typeof SLOT777_ALLOWED_CREDIT_BETS)[number]);
}

function isSameFunRequest(spin: PersistedSpin, input: Extract<SpinRequest, { mode: 'fun' }>): boolean {
  return spin.bet === input.bet;
}

function isSameRealRequest(spin: PersistedSpin, input: Extract<SpinRequest, { mode: 'real' }>): boolean {
  return spin.denomination === input.denomination
    && spin.bet === input.bet * getRealDenominationUnits(input.denomination);
}

function assertRealBalanceIntegrity(realBalance: bigint): void {
  if (realBalance % REAL_BALANCE_MIN_UNIT !== 0n) {
    throw new Error('Invalid real_balance: value must be divisible by 10');
  }
}

export function getPlayerSession(player: CurrentUser) {
  assertRealBalanceIntegrity(player.realBalance);
  return {
    authorized: true,
    activeMode: 'fun' as const,
    // REAL credits are held by the authenticated Telegram account, not by the
    // currently connected wallet transport. Disconnecting a wallet therefore
    // removes TOP-UP/WITHDRAW capability but never strands real_balance.
    realModeAvailable: player.accountType === 'telegram',
    user: { uuid: player.uuid, username: player.username, accountType: player.accountType },
    balances: { fun: player.funBalance.toString(), real: player.realBalance.toString() },
  };
}

export function getPlayerBalances(player: CurrentUser) {
  assertRealBalanceIntegrity(player.realBalance);
  return {
    balances: { fun: player.funBalance.toString(), real: player.realBalance.toString() },
  };
}

function parseFunCreditResult(value: Prisma.JsonValue | null): { credited?: string; balance?: { mode: 'fun'; value: string } } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = value as Record<string, unknown>;
  const balance = result.balance;
  const validBalance = balance && typeof balance === 'object' && !Array.isArray(balance)
    && (balance as Record<string, unknown>).mode === 'fun'
    && typeof (balance as Record<string, unknown>).value === 'string'
    ? { mode: 'fun' as const, value: (balance as Record<string, string>).value }
    : undefined;
  return {
    ...(typeof result.credited === 'string' ? { credited: result.credited } : {}),
    ...(validBalance ? { balance: validBalance } : {}),
  };
}

function toFunCreditOperationView(operation: StoredFunCreditOperation): FunCreditOperationView {
  const result = parseFunCreditResult(operation.result);
  const status = operation.status as FunCreditOperationView['status'];
  return {
    operationId: operation.idempotencyKey,
    type: FUN_CREDIT_OPERATION_TYPE,
    status,
    ...result,
    ...(operation.errorCode === 'fun_credit_balance_too_high'
      ? { error: 'fun_credit_balance_too_high' as const }
      : {}),
  };
}

function assertMatchingFunCreditOperation(operation: StoredFunCreditOperation): void {
  if (operation.requestFingerprint !== FUN_CREDIT_REQUEST_FINGERPRINT) {
    throw new IdempotencyMismatchError();
  }
}

/**
 * A FUN claim is a durable command, not merely a conditional balance update.
 * If HTTP drops after MySQL commits, the same operation ID returns this saved
 * terminal result instead of attempting a second grant or leaving UI guessing.
 */
export async function claimFunCredits(player: CurrentUser, operationId: string): Promise<FunCreditOperationView> {
  const existing = await prisma.clientOperation.findUnique({
    where: {
      userId_type_idempotencyKey: {
        userId: player.id,
        type: FUN_CREDIT_OPERATION_TYPE,
        idempotencyKey: operationId,
      },
    },
  });
  if (existing) {
    assertMatchingFunCreditOperation(existing);
    return toFunCreditOperationView(existing);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const alreadyCreated = await tx.clientOperation.findUnique({
        where: {
          userId_type_idempotencyKey: {
            userId: player.id,
            type: FUN_CREDIT_OPERATION_TYPE,
            idempotencyKey: operationId,
          },
        },
      });
      if (alreadyCreated) {
        assertMatchingFunCreditOperation(alreadyCreated);
        return toFunCreditOperationView(alreadyCreated);
      }

      const credit = await tx.user.updateMany({
        where: { id: player.id, funBalance: { lt: FUN_CREDIT_THRESHOLD } },
        data: { funBalance: { increment: FUN_CREDIT_AMOUNT } },
      });
      const updatedPlayer = await tx.user.findUniqueOrThrow({
        where: { id: player.id },
        select: { funBalance: true },
      });
      const balance = { mode: 'fun' as const, value: updatedPlayer.funBalance.toString() };
      const now = new Date();

      if (credit.count !== 1) {
        const result = { balance };
        const rejected = await tx.clientOperation.create({
          data: {
            uuid: uuidv7(), userId: player.id, type: FUN_CREDIT_OPERATION_TYPE,
            idempotencyKey: operationId, requestFingerprint: FUN_CREDIT_REQUEST_FINGERPRINT,
            status: 'rejected', errorCode: 'fun_credit_balance_too_high', result,
            completedAt: now,
          },
        });
        return toFunCreditOperationView(rejected);
      }

      const result = { credited: FUN_CREDIT_AMOUNT.toString(), balance };
      const completed = await tx.clientOperation.create({
        data: {
          uuid: uuidv7(), userId: player.id, type: FUN_CREDIT_OPERATION_TYPE,
          idempotencyKey: operationId, requestFingerprint: FUN_CREDIT_REQUEST_FINGERPRINT,
          status: 'completed', result, completedAt: now,
        },
      });
      return toFunCreditOperationView(completed);
    });
  } catch (error) {
    // Two transports may deliver the same command concurrently. MySQL's
    // unique key elects the winner; both callers receive that one outcome.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const saved = await prisma.clientOperation.findUniqueOrThrow({
        where: {
          userId_type_idempotencyKey: {
            userId: player.id,
            type: FUN_CREDIT_OPERATION_TYPE,
            idempotencyKey: operationId,
          },
        },
      });
      assertMatchingFunCreditOperation(saved);
      return toFunCreditOperationView(saved);
    }
    throw error;
  }
}

/** The client calls this after any ambiguous transport failure. */
export async function getFunCreditOperation(player: CurrentUser, operationId: string): Promise<FunCreditOperationView | null> {
  const operation = await prisma.clientOperation.findUnique({
    where: {
      userId_type_idempotencyKey: {
        userId: player.id,
        type: FUN_CREDIT_OPERATION_TYPE,
        idempotencyKey: operationId,
      },
    },
  });
  if (!operation) return null;
  assertMatchingFunCreditOperation(operation);
  return toFunCreditOperationView(operation);
}

function assertModeAllowed(player: CurrentUser, mode: SlotMode): void {
  if (mode !== 'real') return;
  if (player.accountType === 'guest') throw new GuestFunOnlyError();
}

/** History remains owner-scoped after a voluntary wallet disconnect. */
function assertModeReadable(player: CurrentUser, mode: SlotMode): void {
  if (mode === 'real' && player.accountType === 'guest') throw new GuestFunOnlyError();
}

export async function executeSpin(player: CurrentUser, input: SpinRequest): Promise<SlotSpinResult> {
  if (!isAllowedCreditBet(input.bet)) throw new Error('Invalid credit bet');
  assertModeAllowed(player, input.mode);
  return input.mode === 'fun'
    ? executeFunSpin(player, input)
    : executeRealSpin(player, input);
}

async function executeFunSpin(
  player: CurrentUser,
  input: Extract<SpinRequest, { mode: 'fun' }>,
): Promise<SlotSpinResult> {
  const replay = await prisma.funSpin.findUnique({
    where: { userId_requestId: { userId: player.id, requestId: input.requestId } },
  });
  if (replay) {
    if (!isSameFunRequest(replay, input)) throw new IdempotencyMismatchError();
    return { ...toSpinResult(replay, 'fun'), replayed: true };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.funSpin.findUnique({
        where: { userId_requestId: { userId: player.id, requestId: input.requestId } },
      });
      if (existing) {
        if (!isSameFunRequest(existing, input)) throw new IdempotencyMismatchError();
        return { ...toSpinResult(existing, 'fun'), replayed: true };
      }

      const deduction = await tx.user.updateMany({
        where: { id: player.id, funBalance: { gte: input.bet } },
        data: { funBalance: { decrement: input.bet } },
      });
      if (deduction.count !== 1) throw new InsufficientFunBalanceError();

      const outcome = spinSlot777();
      const payout = input.bet * BigInt(outcome.multiplier);
      const updatedPlayer = await tx.user.update({
        where: { id: player.id },
        data: { funBalance: { increment: payout } },
      });
      const saved = await tx.funSpin.create({
        data: {
          uuid: uuidv7(), requestId: input.requestId, userId: player.id, bet: input.bet,
          combination: outcome.combination, rule: outcome.rule, multiplier: outcome.multiplier,
          payout, balanceAfter: updatedPlayer.funBalance,
        },
      });
      const now = new Date();
      // A successful guest bet renews both account and cookie windows.
      if (player.accountType === 'guest') {
        const { guestExpiresAt, sessionExpiresAt } = calculateGuestSessionLifetime(now, {
          guestAccountTtlHours: env.GUEST_ACCOUNT_TTL_HOURS,
          sessionTtlHours: env.SESSION_TTL_HOURS,
        });
        await tx.user.update({ where: { id: player.id }, data: { guestExpiresAt } });
        await tx.session.updateMany({ where: { userId: player.id, revokedAt: null }, data: { expiresAt: sessionExpiresAt } });
      }
      await tx.playerStatistics.upsert({
        where: { sourceUserUuid: player.uuid },
        create: {
          sourceUserUuid: player.uuid,
          accountType: player.accountType,
          firstSeenAt: now,
          lastSeenAt: now,
          funSpinsCount: 1,
          funWagered: input.bet,
          funPayout: payout,
          lastFunSpinAt: now,
        },
        update: { lastSeenAt: now, lastFunSpinAt: now, funSpinsCount: { increment: 1 }, funWagered: { increment: input.bet }, funPayout: { increment: payout } },
      });
      return toSpinResult(saved, 'fun');
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const saved = await prisma.funSpin.findUniqueOrThrow({
        where: { userId_requestId: { userId: player.id, requestId: input.requestId } },
      });
      if (!isSameFunRequest(saved, input)) throw new IdempotencyMismatchError();
      return { ...toSpinResult(saved, 'fun'), replayed: true };
    }
    throw error;
  }
}

async function executeRealSpin(
  player: CurrentUser,
  input: Extract<SpinRequest, { mode: 'real' }>,
): Promise<SlotSpinResult> {
  const creditUnit = getRealDenominationUnits(input.denomination);
  const realBet = input.bet * creditUnit;
  if (realBet % REAL_BALANCE_MIN_UNIT !== 0n) throw new Error('Invalid real bet unit');

  const replay = await prisma.realSpin.findUnique({
    where: { userId_requestId: { userId: player.id, requestId: input.requestId } },
  });
  if (replay) {
    if (!isSameRealRequest(replay, input)) throw new IdempotencyMismatchError();
    return { ...toSpinResult(replay, 'real'), replayed: true };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.realSpin.findUnique({
        where: { userId_requestId: { userId: player.id, requestId: input.requestId } },
      });
      if (existing) {
        if (!isSameRealRequest(existing, input)) throw new IdempotencyMismatchError();
        return { ...toSpinResult(existing, 'real'), replayed: true };
      }

      // `FOR UPDATE` serializes REAL rounds for one user. It lets the ledger
      // record the exact intermediate balance after the stake and before a
      // possible payout; no external RPC or UI work happens in this lock.
      const locked = await tx.$queryRaw<Array<{ real_balance: bigint }>>`
        SELECT real_balance FROM users WHERE id = ${player.id} FOR UPDATE
      `;
      if (locked.length !== 1 || locked[0].real_balance < realBet) {
        throw new InsufficientRealBalanceError();
      }
      const balanceAfterBet = locked[0].real_balance - realBet;
      const outcome = spinSlot777();
      const payout = realBet * BigInt(outcome.multiplier);
      const balanceAfter = balanceAfterBet + payout;
      assertRealBalanceIntegrity(balanceAfter);
      const updatedPlayer = await tx.user.update({
        where: { id: player.id },
        data: { realBalance: balanceAfter },
      });
      const spinUuid = uuidv7();
      const saved = await tx.realSpin.create({
        data: {
          uuid: spinUuid, requestId: input.requestId, denomination: input.denomination,
          userId: player.id, bet: realBet, combination: outcome.combination, rule: outcome.rule,
          multiplier: outcome.multiplier, payout, balanceAfter: updatedPlayer.realBalance,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          uuid: uuidv7(), userId: player.id, kind: 'spin_bet', amount: -realBet,
          balanceAfter: balanceAfterBet, idempotencyKey: `real-spin:${spinUuid}:bet`, referenceUuid: spinUuid,
        },
      });
      if (payout > 0n) {
        await tx.ledgerEntry.create({
          data: {
            uuid: uuidv7(), userId: player.id, kind: 'spin_payout', amount: payout,
            balanceAfter, idempotencyKey: `real-spin:${spinUuid}:payout`, referenceUuid: spinUuid,
          },
        });
      }
      const now = new Date();
      await tx.playerStatistics.upsert({
        where: { sourceUserUuid: player.uuid },
        create: {
          sourceUserUuid: player.uuid,
          accountType: player.accountType,
          firstSeenAt: now,
          lastSeenAt: now,
          realSpinsCount: 1,
          realWagered: realBet,
          realPayout: payout,
          lastRealSpinAt: now,
        },
        update: { lastSeenAt: now, lastRealSpinAt: now, realSpinsCount: { increment: 1 }, realWagered: { increment: realBet }, realPayout: { increment: payout } },
      });
      return toSpinResult(saved, 'real');
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const saved = await prisma.realSpin.findUniqueOrThrow({
        where: { userId_requestId: { userId: player.id, requestId: input.requestId } },
      });
      if (!isSameRealRequest(saved, input)) throw new IdempotencyMismatchError();
      return { ...toSpinResult(saved, 'real'), replayed: true };
    }
    throw error;
  }
}

export async function getSpinHistory(player: CurrentUser, input: {
  cursor?: string;
  limit: number;
  mode: SlotMode;
}) {
  assertModeReadable(player, input.mode);
  const spins = input.mode === 'fun'
    ? await prisma.funSpin.findMany({
        where: { userId: player.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        cursor: input.cursor ? { uuid: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0, take: input.limit + 1,
      })
    : await prisma.realSpin.findMany({
        where: { userId: player.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        cursor: input.cursor ? { uuid: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0, take: input.limit + 1,
      });
  const hasNextPage = spins.length > input.limit;
  const items = spins.slice(0, input.limit).map((spin) => toSpinView(spin, input.mode));
  return { items, nextCursor: hasNextPage ? items.at(-1)?.uuid ?? null : null };
}

export async function getSpinByUuid(player: CurrentUser, uuid: string, mode: SlotMode) {
  assertModeReadable(player, mode);
  const spin = mode === 'fun'
    ? await prisma.funSpin.findFirst({ where: { uuid, userId: player.id } })
    : await prisma.realSpin.findFirst({ where: { uuid, userId: player.id } });
  return spin ? toSpinView(spin, mode) : null;
}

/**
 * Recovery lookup for a POST /spins response lost by the browser. `requestId`
 * already has a per-user unique constraint on both spin tables, so returning
 * this saved round is safe and never performs another debit.
 */
export async function getSpinByRequestId(player: CurrentUser, requestId: string, mode: SlotMode): Promise<SlotSpinResult | null> {
  assertModeReadable(player, mode);
  const spin = mode === 'fun'
    ? await prisma.funSpin.findUnique({ where: { userId_requestId: { userId: player.id, requestId } } })
    : await prisma.realSpin.findUnique({ where: { userId_requestId: { userId: player.id, requestId } } });
  return spin ? { ...toSpinResult(spin, mode), replayed: true } : null;
}
