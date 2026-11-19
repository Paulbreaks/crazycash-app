/**
 * Explicit, manual TESTNET-only transfer from the operational deposit wallet.
 *
 * This is an administrator tool, not part of the API or a player-facing flow.
 * It deliberately has no mainnet path and requires a confirmation flag because
 * a successful send is irreversible. The wallet mnemonic is read only from the
 * protected host file configured for the operational account.
 */
import { constants as fileConstants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { Address, internal, SendMode, TonClient, toNano, type Transaction, WalletContractV5R1 } from '@ton/ton';
import { mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto';
import { uuidv7 } from '../lib/uuid.js';

const TESTNET_GLOBAL_ID = -3;
const DEPOSIT_MNEMONIC_PATH = '/run/secrets/testnet-deposit-recipient.mnemonic';
const CONFIRMATION_FLAG = '--confirm-testnet-transfer';
const MINIMUM_SENDER_RESERVE = toNano('0.05');
const MAX_CONFIRMATION_ATTEMPTS = 15;
const CONFIRMATION_INTERVAL_MS = 2_000;

type TransferArguments = {
  destination: Address;
  amount: bigint;
};

function usage(): never {
  throw new Error(
    'Usage: testnet-deposit-transfer <destination> <amount-ton> --confirm-testnet-transfer',
  );
}

function assertTestnetOnly(): void {
  if (process.env.TON_NETWORK !== 'testnet') {
    throw new Error('This operational tool is testnet-only. Set TON_NETWORK=testnet.');
  }
}

function parseArguments(): TransferArguments {
  const [, , destinationValue, amountValue, confirmation] = process.argv;
  if (!destinationValue || !amountValue || confirmation !== CONFIRMATION_FLAG || process.argv.length !== 5) usage();
  // TON accepts up to 9 decimal places. Keeping the amount as its source string
  // means `toNano` uses integer nanotons and never JavaScript floating point.
  if (!/^\d+(?:\.\d{1,9})?$/.test(amountValue) || amountValue === '0') {
    throw new Error('Amount must be a positive TON decimal with at most 9 fraction digits.');
  }
  let destination: Address;
  try {
    destination = Address.parse(destinationValue);
  } catch {
    throw new Error('Destination is not a valid TON address.');
  }
  const amount = toNano(amountValue);
  if (amount <= 0n) throw new Error('Amount must be greater than zero.');
  return { destination, amount };
}

function client(): TonClient {
  const endpoint = process.env.TON_RPC_TESTNET_URL?.trim() ?? '';
  if (!endpoint) throw new Error('TON_RPC_TESTNET_URL is required.');
  const hostname = new URL(endpoint).hostname.toLowerCase();
  const apiKey = process.env.TONCENTER_TESTNET_API_KEY?.trim() ?? '';
  const isTonCenter = hostname === 'toncenter.com' || hostname.endsWith('.toncenter.com');
  return new TonClient({ endpoint, timeout: 8_000, ...(isTonCenter && apiKey ? { apiKey } : {}) });
}

async function loadDepositWallet(): Promise<{ wallet: WalletContractV5R1; secretKey: Buffer }> {
  const metadata = await stat(DEPOSIT_MNEMONIC_PATH);
  if ((metadata.mode & 0o077) !== 0) throw new Error('Deposit mnemonic file permissions must be 0600.');
  await access(DEPOSIT_MNEMONIC_PATH, fileConstants.R_OK);
  const words = (await readFile(DEPOSIT_MNEMONIC_PATH, 'utf8')).trim().split(/\s+/);
  if (words.length !== 24 || !(await mnemonicValidate(words))) {
    throw new Error('Deposit mnemonic file is invalid.');
  }
  const keyPair = await mnemonicToPrivateKey(words);
  return {
    wallet: WalletContractV5R1.create({
      publicKey: keyPair.publicKey,
      walletId: { networkGlobalId: TESTNET_GLOBAL_ID, context: { walletVersion: 'v5r1', workchain: 0, subwalletNumber: 0 } },
    }),
    secretKey: keyPair.secretKey,
  };
}

function publicAddress(address: Address): string {
  return address.toString({ urlSafe: true, bounceable: false, testOnly: true });
}

function incomingTransferMatches(transaction: Transaction, source: Address, amount: bigint, memo: string): boolean {
  const message = transaction.inMessage;
  if (!message || message.info.type !== 'internal' || !message.info.src?.equals(source)) return false;
  if (message.info.value.coins !== amount || transaction.description.type !== 'generic' || transaction.description.aborted) return false;
  try {
    const body = message.body.beginParse();
    return body.remainingBits >= 32 && body.loadUint(32) === 0 && body.loadStringTail() === memo;
  } catch {
    return false;
  }
}

async function waitForRecipientConfirmation(
  rpc: TonClient,
  destination: Address,
  source: Address,
  amount: bigint,
  memo: string,
): Promise<{ hash: string; lt: string } | null> {
  for (let attempt = 0; attempt < MAX_CONFIRMATION_ATTEMPTS; attempt += 1) {
    const transactions = await rpc.getTransactions(destination, { limit: 10 });
    const transaction = transactions.find((candidate) => incomingTransferMatches(candidate, source, amount, memo));
    if (transaction) {
      return { hash: transaction.hash().toString('base64'), lt: transaction.lt.toString() };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, CONFIRMATION_INTERVAL_MS));
  }
  return null;
}

async function main(): Promise<void> {
  assertTestnetOnly();
  const { destination, amount } = parseArguments();
  const { wallet, secretKey } = await loadDepositWallet();
  if (wallet.address.equals(destination)) throw new Error('Destination must differ from the deposit wallet.');

  const rpc = client();
  const state = await rpc.getContractState(wallet.address);
  if (state.state !== 'active') throw new Error(`Deposit wallet must be active, got ${state.state}.`);
  if (state.balance < amount + MINIMUM_SENDER_RESERVE) {
    throw new Error('Insufficient deposit-wallet balance after reserving 0.05 TON for fees and storage.');
  }

  const reference = `CC:ADMIN:${uuidv7()}`;
  const opened = rpc.open(wallet);
  const seqno = await opened.getSeqno();
  await opened.sendTransfer({
    seqno,
    secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [internal({ to: destination, value: amount, bounce: true, body: reference })],
  });
  console.info(JSON.stringify({
    event: 'testnet_deposit_transfer_submitted',
    reference,
    from: publicAddress(wallet.address),
    to: publicAddress(destination),
    amountNanotons: amount.toString(),
    seqno,
  }));

  const confirmation = await waitForRecipientConfirmation(rpc, destination, wallet.address, amount, reference);
  if (confirmation) {
    console.info(JSON.stringify({ event: 'testnet_deposit_transfer_confirmed', reference, ...confirmation }));
    return;
  }
  // Submission has occurred. A slow RPC/indexer must not be mistaken for a
  // failed transfer or prompt the administrator to resend the same amount.
  console.warn(JSON.stringify({
    event: 'testnet_deposit_transfer_confirmation_pending',
    reference,
    message: 'Broadcast was submitted but recipient confirmation was not visible within 30 seconds. Do not resend; inspect recipient history first.',
  }));
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    event: 'testnet_deposit_transfer_failed',
    message: error instanceof Error ? error.message : 'Unknown error',
  }));
  process.exitCode = 1;
});
