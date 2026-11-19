/**
 * One-time administration tool for the Crazy Cash TESTNET operational wallets.
 *
 * It is deliberately not part of the API and never handles player funds in
 * mainnet. The mnemonic lives only in a 0600 protected file mounted into the
 * manually on a controlled host.
 */
import { constants as fileConstants } from 'node:fs';
import { access, chown, open, readFile, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { Address, internal, SendMode, TonClient, toNano, WalletContractV5R1 } from '@ton/ton';
import { mnemonicNew, mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto';

const TESTNET_GLOBAL_ID = -3;
const MINIMUM_DEPLOY_BALANCE = toNano('0.10');
const SELF_TRANSFER_VALUE = toNano('0.01');
const DEPLOY_CONFIRMATION = '--confirm-testnet-deployment';

type WalletPurpose = 'deposit' | 'withdraw';
type Command = 'create' | 'status' | 'deploy';

function assertTestnetOnly(): void {
  if (process.env.TON_NETWORK !== 'testnet') {
    throw new Error('This tool is testnet-only. Set TON_NETWORK=testnet.');
  }
}

function mnemonicFilePath(purpose: WalletPurpose): string {
  const variable = purpose === 'deposit'
    ? 'TON_TESTNET_DEPOSIT_MNEMONIC_FILE'
    : 'TON_TESTNET_WITHDRAW_MNEMONIC_FILE';
  const value = process.env[variable]?.trim() ?? '';
  // Operational environments mount the protected host directory at this path.
  // Refusing arbitrary paths prevents accidental key writes into the checkout
  // or other host locations.
  if (!value.startsWith('/run/secrets/') || value.includes('..')) {
    throw new Error(`${variable} must be inside /run/secrets/.`);
  }
  return value;
}

function client(): TonClient {
  const endpoint = process.env.TON_RPC_TESTNET_URL?.trim() ?? '';
  if (!endpoint) throw new Error('TON_RPC_TESTNET_URL is required.');
  const parsed = new URL(endpoint);
  const apiKey = process.env.TONCENTER_TESTNET_API_KEY?.trim() ?? '';
  const isTonCenter = parsed.hostname === 'toncenter.com' || parsed.hostname.endsWith('.toncenter.com');
  return new TonClient({ endpoint, timeout: 8_000, ...(isTonCenter && apiKey ? { apiKey } : {}) });
}

async function createMnemonicFile(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const mnemonic = await mnemonicNew(24);
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(`${mnemonic.join(' ')}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    // The payout worker is the only long-lived container that mounts the
    // withdrawal seed, and it runs as the unprivileged `node` user.
    await chown(path, 1_000, 1_000);
    await access(path, fileConstants.R_OK | fileConstants.W_OK);
    return;
  }
  throw new Error('Mnemonic file already exists. Refusing to replace it.');
}

async function walletFromMnemonicFile(path: string): Promise<{ wallet: WalletContractV5R1; secretKey: Buffer }> {
  const file = await stat(path);
  if ((file.mode & 0o077) !== 0) throw new Error('Mnemonic file permissions must be 0600.');
  const words = (await readFile(path, 'utf8')).trim().split(/\s+/);
  if (words.length !== 24 || !(await mnemonicValidate(words))) throw new Error('Mnemonic file is invalid.');
  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV5R1.create({
    publicKey: keyPair.publicKey,
    walletId: {
      networkGlobalId: TESTNET_GLOBAL_ID,
      context: { walletVersion: 'v5r1', workchain: 0, subwalletNumber: 0 },
    },
  });
  return { wallet, secretKey: keyPair.secretKey };
}

function publicAddress(address: Address): string {
  return address.toString({ urlSafe: true, bounceable: false, testOnly: true });
}

async function printStatus(purpose: WalletPurpose, wallet: WalletContractV5R1): Promise<void> {
  const state = await client().getContractState(wallet.address);
  console.info(JSON.stringify({
    event: 'testnet_recipient_status',
    purpose,
    host: hostname(),
    address: publicAddress(wallet.address),
    rawAddress: wallet.address.toRawString(),
    state: state.state,
    balanceNanotons: state.balance.toString(),
  }));
}

async function deploy(purpose: WalletPurpose, wallet: WalletContractV5R1, secretKey: Buffer): Promise<void> {
  if (!process.argv.includes(DEPLOY_CONFIRMATION)) {
    throw new Error(`Refusing broadcast without ${DEPLOY_CONFIRMATION}.`);
  }
  const rpc = client();
  const state = await rpc.getContractState(wallet.address);
  if (state.state === 'active') {
    console.info(JSON.stringify({ event: 'testnet_recipient_already_active', purpose, address: publicAddress(wallet.address) }));
    return;
  }
  if (state.state !== 'uninitialized') throw new Error(`Recipient state must be uninitialized, got ${state.state}.`);
  if (state.balance < MINIMUM_DEPLOY_BALANCE) {
    throw new Error(`Fund recipient with at least ${MINIMUM_DEPLOY_BALANCE.toString()} nanotons before deployment.`);
  }

  // The first signed external transfer includes StateInit through the standard
  // wallet wrapper. A tiny non-bounceable self-transfer activates the account
  // without relying on a third-party wallet application's fee emulator.
  const opened = rpc.open(wallet);
  await opened.sendTransfer({
    seqno: 0,
    secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [internal({ to: wallet.address, value: SELF_TRANSFER_VALUE, bounce: false })],
  });
  console.info(JSON.stringify({ event: 'testnet_recipient_deployment_submitted', purpose, address: publicAddress(wallet.address) }));

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
    const updated = await rpc.getContractState(wallet.address);
    if (updated.state === 'active') {
      console.info(JSON.stringify({ event: 'testnet_recipient_active', purpose, address: publicAddress(wallet.address) }));
      return;
    }
  }
  throw new Error('Deployment was submitted but the account did not become active within 40 seconds. Check the address on a testnet explorer.');
}

async function main(): Promise<void> {
  assertTestnetOnly();
  const purpose = process.argv[2] as WalletPurpose | undefined;
  const command = process.argv[3] as Command | undefined;
  if (!purpose || !['deposit', 'withdraw'].includes(purpose) || !command || !['create', 'status', 'deploy'].includes(command)) {
    throw new Error('Usage: testnet-recipient <deposit|withdraw> <create|status|deploy> [--confirm-testnet-deployment]');
  }
  const path = mnemonicFilePath(purpose);
  if (command === 'create') {
    await createMnemonicFile(path);
  }
  const { wallet, secretKey } = await walletFromMnemonicFile(path);
  if (command === 'deploy') await deploy(purpose, wallet, secretKey);
  else await printStatus(purpose, wallet);
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: 'testnet_recipient_failed', message: error instanceof Error ? error.message : 'Unknown error' }));
  process.exitCode = 1;
});
