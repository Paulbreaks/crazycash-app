import { pathToFileURL } from 'node:url';
import { Address, TonClient, type Transaction } from '@ton/ton';
import { Prisma } from '@prisma/client';
import { env } from '../plugins/env.js';
import { prisma } from '../plugins/prisma.js';
import {
  depositInvoicePayload,
  formatCanonicalTon,
  getTonDepositRecipient,
  TON_DEPOSIT_NANOTONS_PER_CANONICAL_UNIT,
} from '../modules/ton/deposits.js';
import { uuidv7 } from '../lib/uuid.js';

const PAGE_SIZE = 50;
const MAX_PAGES_PER_RUN = 20;
const OVERLAP_TRANSACTIONS = 20;
const RETRYABLE_RPC_ATTEMPTS = 3;
const RETRYABLE_RPC_DELAY_MS = 250;

type WatcherResult = {
  scannedTransactions: number;
  observedDeposits: number;
  creditedDeposits: number;
  expiredDeposits: number;
  recoveredStaleCheckpoint: boolean;
};

function configuredRpc(): { endpoint: string; apiKey?: string } {
  const endpoint = env.TON_NETWORK === 'testnet' ? env.TON_RPC_TESTNET_URL : env.TON_RPC_MAINNET_URL;
  const tonCenterKey = env.TON_NETWORK === 'testnet'
    ? env.TONCENTER_TESTNET_API_KEY
    : env.TONCENTER_MAINNET_API_KEY;
  const hostname = new URL(endpoint).hostname.toLowerCase();
  const isTonCenter = hostname === 'toncenter.com' || hostname.endsWith('.toncenter.com');
  return { endpoint, ...(isTonCenter && tonCenterKey ? { apiKey: tonCenterKey } : {}) };
}

function transactionIdentity(transaction: Transaction): { hash: string; lt: string } {
  return { hash: transaction.hash().toString('base64'), lt: transaction.lt.toString() };
}

function readInvoice(transaction: Transaction, recipient: Address): {
  invoice: string;
  source: string;
  amountNanotons: bigint;
  transactionAt: Date;
  hash: string;
  lt: string;
} | null {
  const message = transaction.inMessage;
  if (!message || message.info.type !== 'internal' || !message.info.dest.equals(recipient)) return null;
  // A transaction with an aborted generic phase is not an accepted deposit.
  if (transaction.description.type === 'generic' && transaction.description.aborted) return null;
  try {
    const body = message.body.beginParse();
    if (body.remainingBits < 32 || body.loadUint(32) !== 0) return null;
    const invoice = body.loadStringTail();
    if (!/^CC:D:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoice)) return null;
    const { hash, lt } = transactionIdentity(transaction);
    return {
      invoice,
      source: message.info.src.toRawString(),
      amountNanotons: message.info.value.coins,
      transactionAt: new Date(transaction.now * 1_000),
      hash,
      lt,
    };
  } catch {
    return null;
  }
}

async function expireDeposits(now: Date): Promise<number> {
  const expired = await prisma.deposit.findMany({
    // An `observed` transfer has already passed all invoice binding checks and
    // only waits for finality. Expiring it here could reject a payment that
    // reached the chain shortly before its valid-until timestamp.
    where: { network: env.TON_NETWORK, status: 'pending', expiresAt: { lte: now } },
    select: { id: true, clientOperationId: true },
  });
  for (const deposit of expired) {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.deposit.updateMany({
        where: { id: deposit.id, status: { in: ['pending', 'observed'] }, expiresAt: { lte: now } },
        data: { status: 'expired' },
      });
      if (changed.count !== 1 || deposit.clientOperationId === null) return;
      const operation = await tx.clientOperation.findUnique({ where: { id: deposit.clientOperationId } });
      if (!operation || !operation.result || typeof operation.result !== 'object' || Array.isArray(operation.result)) return;
      await tx.clientOperation.update({
        where: { id: operation.id },
        data: { status: 'failed', errorCode: 'deposit_expired', result: operation.result as Prisma.InputJsonValue, completedAt: now },
      });
    });
  }
  return expired.length;
}

/**
 * Do not spend an RPC request parsing account history when there is no active
 * invoice to reconcile. `observed` stays active even after its invoice TTL:
 * its matched chain transfer must still complete the finality delay.
 */
async function hasActiveDeposit(): Promise<boolean> {
  const deposit = await prisma.deposit.findFirst({
    where: {
      network: env.TON_NETWORK,
      status: { in: ['pending', 'observed'] },
    },
    select: { id: true },
  });
  return deposit !== null;
}

async function observeOrCredit(
  found: NonNullable<ReturnType<typeof readInvoice>>,
  now: Date,
): Promise<'ignored' | 'observed' | 'credited'> {
  const depositUuid = found.invoice.slice('CC:D:'.length);
  const deposit = await prisma.deposit.findUnique({
    where: { uuid: depositUuid },
    include: { wallet: true },
  });
  if (!deposit || deposit.network !== env.TON_NETWORK || !['pending', 'observed'].includes(deposit.status)) return 'ignored';
  // Sender, exact amount and invoice bind the chain message to the wallet that
  // created this intent. A wrong message is ignored rather than rejecting a
  // valid invoice: an observer must not be able to grief a player by copying a
  // public memo into their own transfer.
  if (deposit.wallet.rawAddress !== found.source
    || found.amountNanotons !== deposit.expectedAmount * TON_DEPOSIT_NANOTONS_PER_CANONICAL_UNIT) return 'ignored';
  // A copied invoice/comment sent after valid-until must never be accepted.
  // Use the chain's transaction timestamp, not the time this worker happened
  // to poll RPC, so a valid transaction near the deadline can still finalize.
  if (found.transactionAt.getTime() > deposit.expiresAt.getTime()) return 'ignored';

  if (deposit.status === 'pending') {
    const observed = await prisma.deposit.updateMany({
      where: { id: deposit.id, status: 'pending' },
      data: { status: 'observed', transactionHash: found.hash, transactionLt: found.lt, receivedAmount: deposit.expectedAmount, observedAt: now },
    });
    return observed.count === 1 ? 'observed' : 'ignored';
  }

  if (deposit.transactionHash !== found.hash || deposit.transactionLt !== found.lt || !deposit.observedAt) return 'ignored';
  const matureAt = now.getTime() - env.TON_DEPOSIT_FINALITY_SECONDS * 1_000;
  if (deposit.observedAt.getTime() > matureAt) return 'ignored';

  const credited = await prisma.$transaction(async (tx) => {
    // Claim the settlement first. If any following DB write fails, the whole
    // transaction rolls back and a later watcher run can safely retry it.
    const claimed = await tx.deposit.updateMany({
      where: { id: deposit.id, status: 'observed', transactionHash: found.hash, transactionLt: found.lt },
      data: { status: 'credited', creditedAt: now },
    });
    if (claimed.count !== 1) return false;

    const locked = await tx.$queryRaw<Array<{ real_balance: bigint }>>`
      SELECT real_balance FROM users WHERE id = ${deposit.userId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error('Deposit owner no longer exists');
    const balanceAfter = locked[0].real_balance + deposit.expectedAmount;
    await tx.user.update({ where: { id: deposit.userId }, data: { realBalance: balanceAfter } });
    await tx.ledgerEntry.create({
      data: {
        uuid: uuidv7(), userId: deposit.userId, kind: 'deposit_credit', amount: deposit.expectedAmount,
        balanceAfter, idempotencyKey: `deposit:${deposit.uuid}`, referenceUuid: deposit.uuid,
      },
    });
    if (deposit.clientOperationId !== null) {
      const operation = await tx.clientOperation.findUnique({ where: { id: deposit.clientOperationId } });
      if (operation && operation.result && typeof operation.result === 'object' && !Array.isArray(operation.result)) {
        const prior = operation.result as Record<string, unknown>;
        const priorDeposit = prior.deposit as Record<string, unknown> | undefined;
        await tx.clientOperation.update({
          where: { id: operation.id },
          data: {
            status: 'completed', completedAt: now, errorCode: null,
            result: {
              ...prior,
              deposit: { ...priorDeposit, status: 'credited' },
              balance: { mode: 'real', value: balanceAfter.toString() },
            } as Prisma.InputJsonValue,
          },
        });
      }
    }
    return true;
  });
  return credited ? 'credited' : 'ignored';
}

type RecentTransactions = {
  transactions: Transaction[];
  latest: { hash: string; lt: string } | null;
  recoveredStaleCheckpoint: boolean;
};

/**
 * Toncenter testnet can prune historical blocks while a saved account cursor
 * still references one of them. This is deliberately narrow: a generic 500
 * remains an error, because treating it as a recovered cursor could hide an
 * outage or malformed request.
 */
function isPrunedCursorError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return false;
  const status = (response as { status?: unknown }).status;
  const data = (response as { data?: unknown }).data;
  if (status !== 500 || !data || typeof data !== 'object') return false;
  const message = (data as { error?: unknown }).error;
  return typeof message === 'string' && message.includes('lt not in db');
}

function isRetryableRpcError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return false;
  const status = (response as { status?: unknown }).status;
  return status === 429 || isPrunedCursorError(error);
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function getTransactionsWithRetry(
  client: TonClient,
  recipient: Address,
  options: { limit: number; lt?: string; hash?: string; inclusive?: boolean },
): Promise<Transaction[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRYABLE_RPC_ATTEMPTS; attempt += 1) {
    try {
      return await client.getTransactions(recipient, { ...options });
    } catch (error) {
      lastError = error;
      if (!isRetryableRpcError(error) || attempt === RETRYABLE_RPC_ATTEMPTS) throw error;
      await waitForRetry(RETRYABLE_RPC_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

async function fetchRecentTransactions(client: TonClient, recipient: Address): Promise<RecentTransactions> {
  const checkpoint = await prisma.tonChainCheckpoint.findUnique({
    where: { network_recipientAddress: { network: env.TON_NETWORK, recipientAddress: recipient.toRawString() } },
  });
  const collected: Transaction[] = [];
  let cursor: { lt: string; hash: string } | undefined;
  let foundCheckpoint = false;
  let recoveredStaleCheckpoint = false;

  for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
    let transactions: Transaction[];
    try {
      transactions = await getTransactionsWithRetry(client, recipient, {
        limit: PAGE_SIZE,
        ...(cursor ?? {}),
        inclusive: false,
      });
    } catch (error) {
      // The first page is a current, independently verified RPC response. If
      // only a later pagination cursor was pruned, process that fresh page and
      // advance the checkpoint after its idempotent DB handling. Do not accept
      // this fallback on page one or for any other RPC error.
      if (!cursor || collected.length === 0 || !isPrunedCursorError(error)) throw error;
      recoveredStaleCheckpoint = true;
      console.warn(JSON.stringify({
        event: 'ton_deposit_watcher_stale_checkpoint_recovered',
        network: env.TON_NETWORK,
        page: page + 1,
        scannedTransactions: collected.length,
      }));
      break;
    }
    if (transactions.length === 0) break;
    for (const transaction of transactions) {
      const id = transactionIdentity(transaction);
      if (checkpoint?.transactionHash === id.hash && checkpoint.transactionLt === id.lt) {
        foundCheckpoint = true;
        break;
      }
      collected.push(transaction);
    }
    if (foundCheckpoint || transactions.length < PAGE_SIZE) break;
    const last = transactionIdentity(transactions[transactions.length - 1]);
    cursor = { lt: last.lt, hash: last.hash };
  }

  // Always rescan a bounded overlap. Chain transfers are deduplicated by the
  // immutable `(network, hash, lt)` constraint, while the overlap protects a
  // process restart around a cursor write. Toncenter testnet can fail the
  // exact `limit=20` JSON-RPC request for a pruned account history; request
  // the normal page shape and bound the overlap locally instead.
  if (collected.length === 0 && checkpoint) {
    const overlapPage = await getTransactionsWithRetry(client, recipient, { limit: PAGE_SIZE, inclusive: false });
    collected.push(...overlapPage.slice(0, OVERLAP_TRANSACTIONS));
  }
  const latest = collected[0] ? transactionIdentity(collected[0]) : null;
  return { transactions: collected, latest, recoveredStaleCheckpoint };
}

async function saveCheckpoint(recipient: Address, latest: { hash: string; lt: string } | null): Promise<void> {
  if (!latest) return;
  await prisma.tonChainCheckpoint.upsert({
    where: { network_recipientAddress: { network: env.TON_NETWORK, recipientAddress: recipient.toRawString() } },
    create: { network: env.TON_NETWORK, recipientAddress: recipient.toRawString(), transactionHash: latest.hash, transactionLt: latest.lt },
    update: { transactionHash: latest.hash, transactionLt: latest.lt },
  });
}

/** One bounded, idempotent polling pass. Safe to call repeatedly. */
export async function runTonDepositWatcher(now = new Date()): Promise<WatcherResult> {
  // Database-only expiry is cheap and must still happen while TON RPC is
  // unavailable. Only an active invoice justifies a chain-history request.
  const expiredDeposits = await expireDeposits(now);
  if (!await hasActiveDeposit()) {
    return {
      scannedTransactions: 0,
      observedDeposits: 0,
      creditedDeposits: 0,
      expiredDeposits,
      recoveredStaleCheckpoint: false,
    };
  }

  const recipient = getTonDepositRecipient();
  const rpc = configuredRpc();
  const client = new TonClient({ endpoint: rpc.endpoint, timeout: 8_000, ...(rpc.apiKey ? { apiKey: rpc.apiKey } : {}) });
  const recent = await fetchRecentTransactions(client, recipient.address);
  const transactions = recent.transactions;
  let observedDeposits = 0;
  let creditedDeposits = 0;
  for (const transaction of transactions) {
    const found = readInvoice(transaction, recipient.address);
    if (!found) continue;
    const result = await observeOrCredit(found, now);
    if (result === 'observed') observedDeposits += 1;
    if (result === 'credited') creditedDeposits += 1;
  }
  // Advance the cursor only after every fetched transaction has been processed.
  // A crash before this point causes a safe, deduplicated rescan instead of a
  // payment being skipped forever.
  await saveCheckpoint(recipient.address, recent.latest);
  return {
    scannedTransactions: transactions.length,
    observedDeposits,
    creditedDeposits,
    expiredDeposits,
    recoveredStaleCheckpoint: recent.recoveredStaleCheckpoint,
  };
}

async function main(): Promise<void> {
  const result = await runTonDepositWatcher();
  console.info(JSON.stringify({ event: 'ton_deposit_watcher_completed', ...result }));
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main()
    .catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'ton_deposit_watcher_failed', message: error instanceof Error ? error.message : 'Unknown watcher failure' }));
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}
