import { Address, TonClient } from '@ton/ton';
import { prisma } from '../../plugins/prisma.js';
import { env } from '../../plugins/env.js';
import type { CurrentUser } from '../auth/session.js';
import type { TonWalletView } from './proof.js';

const NANO_TON_PER_TON = 1_000_000_000n;
const NANO_TON_PER_DISPLAY_FRACTION = 10_000_000n;
const RPC_TIMEOUT_MS = 5_000;

export class TonRpcUnavailableError extends Error {}

export type TonWalletBalanceView = {
  wallet: TonWalletView;
  // Exact, canonical on-chain amount. It is a string so JSON never loses
  // bigint precision; it is display-only and is not Crazy Cash real_balance.
  balanceNanotons: string;
  // The game deliberately displays only hundredths of a GRAM.
  displayBalance: string;
};

function configuredRpc(): { endpoint: string; apiKey?: string } {
  const endpoint = env.TON_NETWORK === 'testnet' ? env.TON_RPC_TESTNET_URL : env.TON_RPC_MAINNET_URL;
  const tonCenterKey = env.TON_NETWORK === 'testnet'
    ? env.TONCENTER_TESTNET_API_KEY
    : env.TONCENTER_MAINNET_API_KEY;

  // A TON Center key must never be forwarded to another RPC provider. The
  // configured QuickNode URL may embed its own credential and needs no header.
  const hostname = new URL(endpoint).hostname.toLowerCase();
  const isTonCenter = hostname === 'toncenter.com' || hostname.endsWith('.toncenter.com');
  return { endpoint, ...(isTonCenter && tonCenterKey ? { apiKey: tonCenterKey } : {}) };
}

function formatDisplayGram(nanotons: bigint): string {
  if (nanotons < 0n) throw new TonRpcUnavailableError();
  const whole = nanotons / NANO_TON_PER_TON;
  const hundredths = (nanotons % NANO_TON_PER_TON) / NANO_TON_PER_DISPLAY_FRACTION;
  return `${whole}.${hundredths.toString().padStart(2, '0')}`;
}

function toWalletView(wallet: {
  rawAddress: string;
  network: 'testnet' | 'mainnet';
  verifiedAt: Date;
}): TonWalletView {
  const address = Address.parseRaw(wallet.rawAddress);
  return {
    verified: true,
    network: wallet.network,
    address: address.toString({ urlSafe: true, bounceable: false, testOnly: wallet.network === 'testnet' }),
    verifiedAt: wallet.verifiedAt.toISOString(),
  };
}

/**
 * Reads only the wallet already bound to this authenticated Telegram user by
 * ton_proof. The caller never supplies an address, making this endpoint safe
 * for both Godot's display and later payment flows.
 */
export async function getVerifiedWalletBalance(user: CurrentUser): Promise<TonWalletBalanceView | null> {
  if (user.accountType !== 'telegram') return null;

  const wallet = await prisma.wallet.findUnique({
    where: { userId_network: { userId: user.id, network: env.TON_NETWORK } },
  });
  if (!wallet || wallet.disconnectedAt !== null) return null;

  let address: Address;
  try {
    address = Address.parseRaw(wallet.rawAddress);
  } catch {
    // A database value must never make an RPC call with an unvalidated address.
    throw new TonRpcUnavailableError();
  }

  try {
    const rpc = configuredRpc();
    const client = new TonClient({ endpoint: rpc.endpoint, timeout: RPC_TIMEOUT_MS, ...(rpc.apiKey ? { apiKey: rpc.apiKey } : {}) });
    const balanceNanotons = await client.getBalance(address);
    return {
      wallet: toWalletView(wallet),
      balanceNanotons: balanceNanotons.toString(),
      displayBalance: formatDisplayGram(balanceNanotons),
    };
  } catch (error) {
    if (error instanceof TonRpcUnavailableError) throw error;
    throw new TonRpcUnavailableError();
  }
}
