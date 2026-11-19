import { createHash } from 'node:crypto';
import { Address, beginCell } from '@ton/ton';
import { Prisma } from '@prisma/client';
import { env } from '../../plugins/env.js';
import { prisma } from '../../plugins/prisma.js';
import { uuidv7 } from '../../lib/uuid.js';
import type { CurrentUser } from '../auth/session.js';

const CANONICAL_UNITS_PER_TON = 1_000n;
const NANOTONS_PER_CANONICAL_UNIT = 1_000_000n;
const MINIMUM_DEPOSIT_UNITS = 100n;
const OPERATION_TYPE = 'ton_deposit' as const;
const INVOICE_PREFIX = 'CC:D:';

export class DepositUnavailableError extends Error {}
export class DepositUnavailableForGuestError extends Error {}
export class DepositWalletNotVerifiedError extends Error {}
export class InvalidDepositAmountError extends Error {}
export class DepositIdempotencyMismatchError extends Error {}

export type DepositOperationView = {
  operationId: string;
  type: typeof OPERATION_TYPE;
  status: 'processing' | 'completed' | 'rejected' | 'failed';
  deposit: {
    uuid: string;
    status: 'pending' | 'observed' | 'credited' | 'expired' | 'rejected';
    amount: string;
    amountNanotons: string;
    destination?: string;
    payload?: string;
    expiresAt: string;
  };
  balance?: { mode: 'real'; value: string };
  error?: 'deposit_expired';
};

type StoredOperation = {
  idempotencyKey: string;
  requestFingerprint: string;
  status: string;
  errorCode: string | null;
  result: Prisma.JsonValue | null;
};

function configuredRecipient(): { address: Address; rawAddress: string } {
  if (env.TON_NETWORK === 'mainnet' && env.TON_DEPOSIT_ENABLE_MAINNET !== '1') {
    throw new DepositUnavailableError();
  }
  const configured = env.TON_NETWORK === 'testnet'
    ? env.TON_DEPOSIT_RECIPIENT_TESTNET
    : env.TON_DEPOSIT_RECIPIENT_MAINNET;
  if (!configured || configured === 'CHANGE_ME') throw new DepositUnavailableError();
  try {
    const address = Address.parse(configured);
    return { address, rawAddress: address.toRawString() };
  } catch {
    throw new DepositUnavailableError();
  }
}

export function getTonDepositRecipient(): { address: Address; rawAddress: string } {
  return configuredRecipient();
}

export function formatCanonicalTon(units: bigint): string {
  const whole = units / CANONICAL_UNITS_PER_TON;
  const hundredths = (units % CANONICAL_UNITS_PER_TON) / 10n;
  return `${whole}.${hundredths.toString().padStart(2, '0')}`;
}

/** Parses decimal TON text without ever passing through a floating-point value. */
export function parseDepositAmount(value: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new InvalidDepositAmountError();
  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  const units = whole * CANONICAL_UNITS_PER_TON + fractional * 10n;
  if (units < MINIMUM_DEPOSIT_UNITS || units > BigInt(env.TON_DEPOSIT_MAX_UNITS)) {
    throw new InvalidDepositAmountError();
  }
  return units;
}

export function depositInvoicePayload(depositUuid: string): string {
  return `${INVOICE_PREFIX}${depositUuid}`;
}

export function encodeDepositPayload(depositUuid: string): string {
  return beginCell()
    // Standard TON text-comment opcode. The watcher accepts only this exact
    // body and invoice format; a browser cannot substitute a free-form memo.
    .storeUint(0, 32)
    .storeStringTail(depositInvoicePayload(depositUuid))
    .endCell()
    .toBoc()
    .toString('base64');
}

function requestFingerprint(amountUnits: bigint): string {
  return createHash('sha256')
    .update(`crazy-cash:ton-deposit:v1:${env.TON_NETWORK}:${amountUnits.toString()}`)
    .digest('hex');
}

function parseOperationResult(operation: StoredOperation): Omit<DepositOperationView, 'operationId' | 'type' | 'status' | 'error'> | null {
  if (!operation.result || typeof operation.result !== 'object' || Array.isArray(operation.result)) return null;
  const value = operation.result as Record<string, unknown>;
  const deposit = value.deposit;
  if (!deposit || typeof deposit !== 'object' || Array.isArray(deposit)) return null;
  const source = deposit as Record<string, unknown>;
  const statuses = new Set(['pending', 'observed', 'credited', 'expired', 'rejected']);
  if (typeof source.uuid !== 'string' || typeof source.status !== 'string' || !statuses.has(source.status)
    || typeof source.amount !== 'string' || typeof source.amountNanotons !== 'string' || typeof source.expiresAt !== 'string') {
    return null;
  }
  const view: DepositOperationView['deposit'] = {
    uuid: source.uuid,
    status: source.status as DepositOperationView['deposit']['status'],
    amount: source.amount,
    amountNanotons: source.amountNanotons,
    expiresAt: source.expiresAt,
  };
  if (typeof source.destination === 'string') view.destination = source.destination;
  if (typeof source.payload === 'string') view.payload = source.payload;
  const result: Omit<DepositOperationView, 'operationId' | 'type' | 'status' | 'error'> = { deposit: view };
  const balance = value.balance;
  if (balance && typeof balance === 'object' && !Array.isArray(balance)
    && (balance as Record<string, unknown>).mode === 'real' && typeof (balance as Record<string, unknown>).value === 'string') {
    result.balance = { mode: 'real', value: (balance as Record<string, string>).value };
  }
  return result;
}

function toOperationView(operation: StoredOperation): DepositOperationView {
  const result = parseOperationResult(operation);
  if (!result) throw new Error('Invalid stored TON deposit operation result');
  const status = operation.status as DepositOperationView['status'];
  return {
    operationId: operation.idempotencyKey,
    type: OPERATION_TYPE,
    status,
    ...result,
    ...(operation.errorCode === 'deposit_expired' ? { error: 'deposit_expired' as const } : {}),
  };
}

function assertMatchingOperation(operation: StoredOperation, amountUnits: bigint): void {
  if (operation.requestFingerprint !== requestFingerprint(amountUnits)) {
    throw new DepositIdempotencyMismatchError();
  }
}

function initialResult(deposit: { uuid: string; expectedAmount: bigint; expiresAt: Date }, recipient: Address): Prisma.InputJsonValue {
  return {
    deposit: {
      uuid: deposit.uuid,
      status: 'pending',
      amount: formatCanonicalTon(deposit.expectedAmount),
      amountNanotons: (deposit.expectedAmount * NANOTONS_PER_CANONICAL_UNIT).toString(),
      destination: recipient.toString({ urlSafe: true, bounceable: false, testOnly: env.TON_NETWORK === 'testnet' }),
      payload: encodeDepositPayload(deposit.uuid),
      expiresAt: deposit.expiresAt.toISOString(),
    },
  };
}

/** Creates one durable invoice; it never mutates the playable REAL balance. */
export async function createDepositIntent(
  user: CurrentUser,
  operationId: string,
  amountText: string,
): Promise<DepositOperationView> {
  if (user.accountType !== 'telegram') throw new DepositUnavailableForGuestError();
  const amountUnits = parseDepositAmount(amountText);
  const recipient = configuredRecipient();

  const existing = await prisma.clientOperation.findUnique({
    where: { userId_type_idempotencyKey: { userId: user.id, type: OPERATION_TYPE, idempotencyKey: operationId } },
  });
  if (existing) {
    assertMatchingOperation(existing, amountUnits);
    return toOperationView(existing);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.TON_DEPOSIT_TTL_SECONDS * 1_000);
  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.clientOperation.findUnique({
        where: { userId_type_idempotencyKey: { userId: user.id, type: OPERATION_TYPE, idempotencyKey: operationId } },
      });
      if (duplicate) {
        assertMatchingOperation(duplicate, amountUnits);
        return toOperationView(duplicate);
      }

      const wallet = await tx.wallet.findUnique({
        where: { userId_network: { userId: user.id, network: env.TON_NETWORK } },
      });
      if (!wallet || wallet.disconnectedAt !== null) throw new DepositWalletNotVerifiedError();

      const operation = await tx.clientOperation.create({
        data: {
          uuid: uuidv7(), userId: user.id, type: OPERATION_TYPE, idempotencyKey: operationId,
          requestFingerprint: requestFingerprint(amountUnits), status: 'processing',
        },
      });
      const deposit = await tx.deposit.create({
        data: {
          uuid: uuidv7(), userId: user.id, walletId: wallet.id, clientOperationId: operation.id,
          network: env.TON_NETWORK, expectedAmount: amountUnits, expiresAt,
        },
      });
      const saved = await tx.clientOperation.update({
        where: { id: operation.id },
        data: { result: initialResult(deposit, recipient.address) },
      });
      return toOperationView(saved);
    });
  } catch (error) {
    // The unique operation key is the final concurrency boundary. A retry
    // after a losing create race returns the same original command result.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await prisma.clientOperation.findUnique({
        where: { userId_type_idempotencyKey: { userId: user.id, type: OPERATION_TYPE, idempotencyKey: operationId } },
      });
      if (replay) {
        assertMatchingOperation(replay, amountUnits);
        return toOperationView(replay);
      }
    }
    throw error;
  }
}

export async function getDepositOperation(user: CurrentUser, operationId: string): Promise<DepositOperationView | null> {
  const operation = await prisma.clientOperation.findUnique({
    where: { userId_type_idempotencyKey: { userId: user.id, type: OPERATION_TYPE, idempotencyKey: operationId } },
  });
  return operation ? toOperationView(operation) : null;
}

/**
 * Recovery lookup for an iframe restored after TonConnect switched apps. Only
 * a non-terminal operation belonging to this exact cookie user is returned;
 * a client never supplies a user, wallet or deposit identifier here.
 */
export async function getPendingDepositOperation(user: CurrentUser): Promise<DepositOperationView | null> {
  const operation = await prisma.clientOperation.findFirst({
    where: {
      userId: user.id,
      type: OPERATION_TYPE,
      status: 'processing',
      deposit: { is: { status: { in: ['pending', 'observed'] } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return operation ? toOperationView(operation) : null;
}

export const TON_DEPOSIT_NANOTONS_PER_CANONICAL_UNIT = NANOTONS_PER_CANONICAL_UNIT;
