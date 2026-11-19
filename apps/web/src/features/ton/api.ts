import { apiGet, apiPost } from '../../shared/api-client';

export type TonProofChallenge = {
  payload: string;
  expiresAt: string;
  network: 'testnet' | 'mainnet';
};

export type TonWallet = {
  verified: boolean;
  network: 'testnet' | 'mainnet';
  address: string;
  verifiedAt: string;
};

export type TonWalletBalance = {
  wallet: TonWallet;
  // Exact blockchain amount in nanotons. The UI uses displayBalance only; this
  // value is reserved for a future detailed balance view and is never float.
  balanceNanotons: string;
  displayBalance: string;
};

export type TonDepositOperation = {
  operationId: string;
  type: 'ton_deposit';
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

/** The API creates the reserve; the restricted worker owns chain settlement. */
export type TonWithdrawalOperation = {
  operationId: string;
  type: 'ton_withdrawal';
  status: 'completed';
  withdrawal: {
    uuid: string;
    status: 'held' | 'requested' | 'sent' | 'finalized' | 'failed' | 'cancelled';
    amount: string;
    createdAt: string;
  };
  balance: { mode: 'real'; value: string };
};

export type TonProofRequest = {
  address: string;
  network: '-3' | '-239';
  public_key?: string;
  proof: {
    timestamp: number;
    domain: { lengthBytes: number; value: string };
    payload: string;
    signature: string;
    state_init: string;
  };
};

export function createTonProofChallenge() {
  return apiPost<TonProofChallenge>('/ton-proof/payload', {});
}

export function verifyTonProof(proof: TonProofRequest) {
  return apiPost<{ wallet: TonWallet }>('/ton-proof/verify', proof);
}

export function getTonWallet() {
  return apiGet<{ wallet: TonWallet | null }>('/me/wallet');
}

export function getTonWalletBalance() {
  return apiGet<{ wallet: TonWalletBalance | null }>('/me/wallet/balance');
}

export function disconnectTonWallet() {
  return apiPost<unknown>('/me/wallet/disconnect', {});
}

export function createTonDeposit(operationId: string, amount: string, signal?: AbortSignal) {
  return apiPost<TonDepositOperation>('/deposits', { operationId, amount }, { signal });
}

export function getTonDeposit(operationId: string, signal?: AbortSignal) {
  return apiGet<TonDepositOperation>(`/deposits/${encodeURIComponent(operationId)}`, { signal });
}

/** Latest server-owned non-terminal invoice, used after Mini App restore. */
export function getPendingTonDeposit() {
  return apiGet<{ operation: TonDepositOperation | null }>('/deposits/pending');
}

export function createTonWithdrawal(operationId: string, amount: string, signal?: AbortSignal) {
  return apiPost<TonWithdrawalOperation>('/withdrawals', { operationId, amount }, { signal });
}

export function getTonWithdrawal(operationId: string, signal?: AbortSignal) {
  return apiGet<TonWithdrawalOperation>(`/withdrawals/${encodeURIComponent(operationId)}`, { signal });
}
