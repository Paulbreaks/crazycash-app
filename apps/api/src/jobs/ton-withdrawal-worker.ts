import { constants as fileConstants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Address, beginCell, internal, SendMode, TonClient, toNano, type Transaction, WalletContractV5R1 } from '@ton/ton';
import { mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto';
import { uuidv7 } from '../lib/uuid.js';
import { env } from '../plugins/env.js';
import { prisma } from '../plugins/prisma.js';

const CANONICAL_UNIT_TO_NANOTONS = 1_000_000n;
const MINIMUM_SENDER_RESERVE = toNano('0.05');
const PAYOUT_MEMO_PREFIX = 'CC:W:';
const MAX_HOLDS_PER_RUN = 10;
const MAX_ACTIVE_WITHDRAWALS_PER_RUN = 20;
const RECIPIENT_HISTORY_SIZE = 20;

type PayoutWallet = {
  client: TonClient;
  wallet: WalletContractV5R1;
  secretKey: Buffer;
};

type PayoutNetworkConfig = {
  network: 'testnet' | 'mainnet';
  walletGlobalId: -3 | -239;
  rpcEndpoint: string;
  tonCenterApiKey: string;
  senderAddress: string;
  senderVariable: 'TON_WITHDRAW_SENDER_TESTNET' | 'TON_WITHDRAW_SENDER_MAINNET';
  mnemonicPath: string;
  mnemonicVariable: 'TON_TESTNET_WITHDRAW_MNEMONIC_FILE' | 'TON_MAINNET_WITHDRAW_MNEMONIC_FILE';
  enabled: boolean;
};

type PayoutObservation = {
  withdrawalUuid: string;
  source: string;
  destination: string;
  amountNanotons: bigint;
  hash: string;
  lt: string;
};

export type WithdrawalWorkerResult = {
  enabled: boolean;
  claimed: number;
  sent: number;
  released: number;
  uncertain: number;
  scannedTransactions: number;
  observed: number;
  finalized: number;
};

function payoutNetworkConfig(): PayoutNetworkConfig {
  if (env.TON_NETWORK === 'testnet') {
    return {
      network: 'testnet',
      walletGlobalId: -3,
      rpcEndpoint: env.TON_RPC_TESTNET_URL,
      tonCenterApiKey: env.TONCENTER_TESTNET_API_KEY,
      senderAddress: env.TON_WITHDRAW_SENDER_TESTNET,
      senderVariable: 'TON_WITHDRAW_SENDER_TESTNET',
      mnemonicPath: env.TON_TESTNET_WITHDRAW_MNEMONIC_FILE,
      mnemonicVariable: 'TON_TESTNET_WITHDRAW_MNEMONIC_FILE',
      enabled: env.TON_WITHDRAW_ENABLE_TESTNET === '1',
    };
  }
  return {
    network: 'mainnet',
    walletGlobalId: -239,
    rpcEndpoint: env.TON_RPC_MAINNET_URL,
    tonCenterApiKey: env.TONCENTER_MAINNET_API_KEY,
    senderAddress: env.TON_WITHDRAW_SENDER_MAINNET,
    senderVariable: 'TON_WITHDRAW_SENDER_MAINNET',
    mnemonicPath: env.TON_MAINNET_WITHDRAW_MNEMONIC_FILE,
    mnemonicVariable: 'TON_MAINNET_WITHDRAW_MNEMONIC_FILE',
    enabled: env.TON_WITHDRAW_ENABLE_MAINNET === '1',
  };
}

function configuredRpc(config: PayoutNetworkConfig): { endpoint: string; apiKey?: string } {
  const hostname = new URL(config.rpcEndpoint).hostname.toLowerCase();
  const isTonCenter = hostname === 'toncenter.com' || hostname.endsWith('.toncenter.com');
  return {
    endpoint: config.rpcEndpoint,
    ...(isTonCenter && config.tonCenterApiKey ? { apiKey: config.tonCenterApiKey } : {}),
  };
}

function configuredSender(config: PayoutNetworkConfig): Address {
  if (!config.senderAddress || config.senderAddress === 'CHANGE_ME') {
    throw new Error(`${config.senderVariable} is not configured.`);
  }
  try {
    return Address.parse(config.senderAddress);
  } catch {
    throw new Error(`${config.senderVariable} is invalid.`);
  }
}

async function loadPayoutWallet(config: PayoutNetworkConfig): Promise<PayoutWallet> {
  const filePath = config.mnemonicPath;
  if (!filePath.startsWith('/run/secrets/') || filePath.includes('..')) {
    throw new Error(`${config.mnemonicVariable} must be a protected /run/secrets/ path.`);
  }
  const metadata = await stat(filePath);
  if ((metadata.mode & 0o077) !== 0) throw new Error('Withdrawal mnemonic file permissions must be 0600.');
  await access(filePath, fileConstants.R_OK);
  const words = (await readFile(filePath, 'utf8')).trim().split(/\s+/);
  if (words.length !== 24 || !(await mnemonicValidate(words))) throw new Error('Withdrawal mnemonic file is invalid.');

  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV5R1.create({
    publicKey: keyPair.publicKey,
    walletId: { networkGlobalId: config.walletGlobalId, context: { walletVersion: 'v5r1', workchain: 0, subwalletNumber: 0 } },
  });
  const sender = configuredSender(config);
  if (!wallet.address.equals(sender)) throw new Error(`Withdrawal mnemonic does not match ${config.senderVariable}.`);
  const rpc = configuredRpc(config);
  return {
    client: new TonClient({ endpoint: rpc.endpoint, timeout: 8_000, ...(rpc.apiKey ? { apiKey: rpc.apiKey } : {}) }),
    wallet,
    secretKey: keyPair.secretKey,
  };
}

function transactionIdentity(transaction: Transaction): { hash: string; lt: string } {
  return { hash: transaction.hash().toString('base64'), lt: transaction.lt.toString() };
}

function recipientTransactionAccepted(transaction: Transaction): boolean {
  // A plain internal transfer to a wallet can have no action phase at all:
  // receiving value does not require the recipient to create another message.
  // For this direction, a non-aborted generic recipient transaction is the
  // relevant proof that the internal transfer was accepted.
  return transaction.description.type === 'generic' && !transaction.description.aborted;
}

/**
 * A payout is proven only by the destination account's received internal
 * message. A successful sender action alone is not enough: the recipient
 * might still reject or bounce that message.
 */
function readPayoutObservation(transaction: Transaction, expectedDestination: Address): PayoutObservation | null {
  const message = transaction.inMessage;
  if (!message || message.info.type !== 'internal' || !message.info.dest.equals(expectedDestination)) return null;
  if (!recipientTransactionAccepted(transaction)) return null;
  try {
    const body = message.body.beginParse();
    if (body.remainingBits < 32 || body.loadUint(32) !== 0) return null;
    const memo = body.loadStringTail();
    const match = /^CC:W:([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(memo);
    if (!match) return null;
    const { hash, lt } = transactionIdentity(transaction);
    return {
      withdrawalUuid: match[1].toLowerCase(),
      source: message.info.src.toRawString(),
      destination: message.info.dest.toRawString(),
      amountNanotons: message.info.value.coins,
      hash,
      lt,
    };
  } catch {
    return null;
  }
}

function payoutMemo(withdrawalUuid: string): string {
  return `${PAYOUT_MEMO_PREFIX}${withdrawalUuid}`;
}

async function assertWalletCanPay(payout: PayoutWallet, amountNanotons: bigint): Promise<void> {
  const state = await payout.client.getContractState(payout.wallet.address);
  if (state.state !== 'active') throw new Error('Withdrawal sender is not active.');
  if (state.balance < amountNanotons + MINIMUM_SENDER_RESERVE) {
    throw new Error('Withdrawal sender balance is insufficient for amount plus fee reserve.');
  }
}

async function releaseBeforeBroadcast(withdrawal: { id: bigint; uuid: string; userId: number; amount: bigint }): Promise<boolean> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    // `requested` and no chain identity means this worker claimed the hold but
    // has not started sendTransfer. This is the only automatic release path.
    const claimed = await tx.withdrawal.updateMany({
      where: { id: withdrawal.id, status: 'requested', transactionHash: null, transactionLt: null },
      data: { status: 'failed', finalizedAt: now },
    });
    if (claimed.count !== 1) return false;

    const locked = await tx.$queryRaw<Array<{ real_balance: bigint }>>`
      SELECT real_balance FROM users WHERE id = ${withdrawal.userId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error('Withdrawal owner no longer exists');
    const balanceAfter = locked[0].real_balance + withdrawal.amount;
    await tx.user.update({ where: { id: withdrawal.userId }, data: { realBalance: balanceAfter } });
    await tx.ledgerEntry.create({
      data: {
        uuid: uuidv7(),
        userId: withdrawal.userId,
        kind: 'withdrawal_release',
        amount: withdrawal.amount,
        balanceAfter,
        idempotencyKey: `withdrawal:${withdrawal.uuid}:release`,
        referenceUuid: withdrawal.uuid,
      },
    });
    return true;
  });
}

async function reconcileOneObservation(
  observation: PayoutObservation,
  sender: Address,
  network: 'testnet' | 'mainnet',
  now: Date,
): Promise<{ observed: boolean; finalized: boolean }> {
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { uuid: observation.withdrawalUuid },
    include: { wallet: { select: { rawAddress: true } } },
  });
  if (!withdrawal || withdrawal.network !== network || !['requested', 'sent'].includes(withdrawal.status)) {
    return { observed: false, finalized: false };
  }
  if (withdrawal.wallet.rawAddress !== observation.destination
    || observation.source !== sender.toRawString()
    || observation.amountNanotons !== withdrawal.amount * CANONICAL_UNIT_TO_NANOTONS) {
    return { observed: false, finalized: false };
  }

  let observed = false;
  if (withdrawal.transactionHash === null && withdrawal.transactionLt === null) {
    const changed = await prisma.withdrawal.updateMany({
      where: { id: withdrawal.id, status: { in: ['requested', 'sent'] }, transactionHash: null, transactionLt: null },
      data: {
        status: 'sent',
        transactionHash: observation.hash,
        transactionLt: observation.lt,
        observedAt: now,
      },
    });
    observed = changed.count === 1;
  }

  const current = observed
    ? await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } })
    : withdrawal;
  if (!current || current.status !== 'sent'
    || current.transactionHash !== observation.hash
    || current.transactionLt !== observation.lt
    || current.observedAt === null) {
    return { observed, finalized: false };
  }
  const matureAt = now.getTime() - env.TON_WITHDRAW_FINALITY_SECONDS * 1_000;
  if (current.observedAt.getTime() > matureAt) return { observed, finalized: false };
  const finalized = await prisma.withdrawal.updateMany({
    where: {
      id: current.id,
      status: 'sent',
      transactionHash: observation.hash,
      transactionLt: observation.lt,
    },
    data: { status: 'finalized', finalizedAt: now },
  });
  return { observed, finalized: finalized.count === 1 };
}

async function reconcilePayouts(client: TonClient, sender: Address, network: 'testnet' | 'mainnet', now: Date): Promise<{
  scannedTransactions: number;
  observed: number;
  finalized: number;
}> {
  const active = await prisma.withdrawal.findMany({
    where: { network, status: { in: ['requested', 'sent'] } },
    orderBy: { createdAt: 'asc' },
    take: MAX_ACTIVE_WITHDRAWALS_PER_RUN,
    select: { wallet: { select: { rawAddress: true } } },
  });
  const destinations = [...new Set(active.map(({ wallet }) => wallet.rawAddress))];
  let scannedTransactions = 0;
  let observed = 0;
  let finalized = 0;

  for (const rawAddress of destinations) {
    try {
      const destination = Address.parseRaw(rawAddress);
      const transactions = await client.getTransactions(destination, { limit: RECIPIENT_HISTORY_SIZE, inclusive: false });
      scannedTransactions += transactions.length;
      for (const transaction of transactions) {
        const observation = readPayoutObservation(transaction, destination);
        if (!observation) continue;
        const result = await reconcileOneObservation(observation, sender, network, now);
        if (result.observed) observed += 1;
        if (result.finalized) finalized += 1;
      }
    } catch (error) {
      // An unavailable recipient history proves neither success nor failure.
      // Preserve the hold and retry reconciliation on the next pass.
      console.error(JSON.stringify({
        event: 'ton_withdrawal_worker_reconciliation_unavailable',
        destination: rawAddress,
        message: error instanceof Error ? error.message : 'Unknown RPC error',
      }));
    }
  }
  return { scannedTransactions, observed, finalized };
}

/**
 * Sends each durable hold at most once and settles it only from recipient
 * chain history. `requested` is deliberately non-retryable after sendTransfer
 * starts: a crash after RPC acceptance must never create a duplicate payout.
 */
export async function runTonWithdrawalWorker(): Promise<WithdrawalWorkerResult> {
  const network = payoutNetworkConfig();
  if (!network.enabled) {
    return {
      enabled: false, claimed: 0, sent: 0, released: 0, uncertain: 0,
      scannedTransactions: 0, observed: 0, finalized: 0,
    };
  }
  const payout = await loadPayoutWallet(network);
  const reconciliation = await reconcilePayouts(payout.client, payout.wallet.address, network.network, new Date());
  const holds = await prisma.withdrawal.findMany({
    where: { network: network.network, status: 'held' },
    orderBy: { createdAt: 'asc' },
    take: MAX_HOLDS_PER_RUN,
    select: { id: true, uuid: true, userId: true, amount: true, wallet: { select: { rawAddress: true } } },
  });

  let claimed = 0;
  let sent = 0;
  let released = 0;
  let uncertain = 0;
  for (const hold of holds) {
    // Compare-and-swap is the worker ownership boundary. A second process may
    // see this row, but only one can move it out of held and obtain a send.
    const claimedRow = await prisma.withdrawal.updateMany({
      where: { id: hold.id, status: 'held' },
      data: { status: 'requested' },
    });
    if (claimedRow.count !== 1) continue;
    claimed += 1;

    let broadcastAttempted = false;
    try {
      const destination = Address.parseRaw(hold.wallet.rawAddress);
      const amountNanotons = hold.amount * CANONICAL_UNIT_TO_NANOTONS;
      // This preflight performs no on-chain write. Its failures have a proven
      // safe release path, unlike anything after sendTransfer has begun.
      await assertWalletCanPay(payout, amountNanotons);
      const opened = payout.client.open(payout.wallet);
      const seqno = await opened.getSeqno();
      broadcastAttempted = true;
      await opened.sendTransfer({
        seqno,
        secretKey: payout.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [internal({
          to: destination,
          value: amountNanotons,
          bounce: true,
          body: beginCell().storeUint(0, 32).storeStringTail(payoutMemo(hold.uuid)).endCell(),
        })],
      });
      const markedSent = await prisma.withdrawal.updateMany({
        where: { id: hold.id, status: 'requested' },
        data: { status: 'sent' },
      });
      if (markedSent.count === 1) sent += 1;
    } catch (error) {
      if (!broadcastAttempted) {
        const didRelease = await releaseBeforeBroadcast(hold);
        if (didRelease) released += 1;
        console.error(JSON.stringify({
          event: 'ton_withdrawal_worker_released_before_broadcast',
          withdrawalUuid: hold.uuid,
          message: error instanceof Error ? error.message : 'Unknown preflight error',
        }));
        continue;
      }
      // An RPC error after a send attempt is ambiguous until the recipient
      // history shows the deterministic memo. Never release or retry here.
      uncertain += 1;
      console.error(JSON.stringify({
        event: 'ton_withdrawal_worker_send_uncertain',
        withdrawalUuid: hold.uuid,
        message: error instanceof Error ? error.message : 'Unknown payout error',
      }));
    }
  }
  return { enabled: true, claimed, sent, released, uncertain, ...reconciliation };
}

async function main(): Promise<void> {
  const result = await runTonWithdrawalWorker();
  console.info(JSON.stringify({ event: 'ton_withdrawal_worker_completed', ...result }));
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main()
    .catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'ton_withdrawal_worker_failed', message: error instanceof Error ? error.message : 'Unknown worker failure' }));
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}
