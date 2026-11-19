import { apiGet, apiPost, type ApiRequestOptions } from '../../shared/api-client';

export interface Slot777Spin {
  combination: string;
  multiplier: number;
  rule: string;
}

export interface Slot777Simulation {
  spins: number;
  totalStake: number;
  totalPayout: number;
  rtpBasisPoints: number;
  resultCounts: Record<string, number>;
  targetRtpBasisPoints?: number;
}

export interface Slot777Theory {
  targetRtpBasisPoints: number;
  rules: Slot777RuleSummary[];
}

export interface Slot777RuleSummary {
  rule: string;
  multiplier: number;
  weight: number;
  probabilityBasisPoints: number;
  availableCombinations: number;
}

export interface Slot777Session {
  authorized: boolean;
  activeMode: 'fun' | 'real';
  realModeAvailable: boolean;
  user: {
    uuid: string;
    username: string | null;
    // Server-confirmed account kind decides whether CONNECT opens the
    // in-Mini-App selector or the browser-to-Telegram deep link.
    accountType: 'guest' | 'telegram';
  };
  balances: {
    fun: string;
    real: string;
  };
}

/** Балансы из БД для обновления панели TON без повторной авторизации. */
export interface Slot777Balances {
  balances: {
    fun: string;
    real: string;
  };
}

export type Slot777SpinRequest = {
  bet: string;
  mode: 'fun';
  requestId: string;
} | {
  bet: string;
  mode: 'real';
  denomination: '0.01' | '0.1' | '1' | '10';
  requestId: string;
};

export interface Slot777SpinResult {
  uuid: string;
  combination: string;
  rule: string;
  multiplier: number;
  payout: string;
  denomination?: '0.01' | '0.1' | '1' | '10';
  balance: {
    mode: 'fun' | 'real';
    value: string;
  };
}

export interface Slot777FunCreditResult {
  operationId: string;
  type: 'fun_credit_claim';
  status: 'completed';
  credited: string;
  balance: {
    mode: 'fun';
    value: string;
  };
}

export interface Slot777FunCreditOperation {
  operationId: string;
  type: 'fun_credit_claim';
  status: 'completed' | 'rejected' | 'processing' | 'failed';
  credited?: string;
  balance?: {
    mode: 'fun';
    value: string;
  };
  error?: 'fun_credit_balance_too_high';
}

export function getSlot777Theory() {
  return apiGet<Slot777Theory>('/crazy-cash/theory');
}

export function getSlot777Spin() {
  return apiGet<Slot777Spin>('/crazy-cash/spin');
}

export function getSlot777Simulation(spins: number) {
  return apiGet<Slot777Simulation>(`/crazy-cash/simulate?spins=${spins}`);
}

export function getSlot777Session(options?: ApiRequestOptions) {
  return apiGet<Slot777Session>('/me/session', options);
}

export function getSlot777Balances(options?: ApiRequestOptions) {
  return apiGet<Slot777Balances>('/me/balances', options);
}

export function createSlot777Spin(request: Slot777SpinRequest, options?: ApiRequestOptions) {
  return apiPost<Slot777SpinResult>('/crazy-cash/spins', request, options);
}

export function getSlot777SpinByRequest(
  mode: 'fun' | 'real',
  requestId: string,
  options?: ApiRequestOptions,
) {
  const query = new URLSearchParams({ mode, requestId });
  return apiGet<Slot777SpinResult>(`/crazy-cash/spins/by-request?${query}`, options);
}

export function claimSlot777FunCredits(operationId: string, options?: ApiRequestOptions) {
  return apiPost<Slot777FunCreditResult>('/crazy-cash/fun-credits', { operationId }, options);
}

export function getSlot777FunCreditOperation(operationId: string, options?: ApiRequestOptions) {
  return apiGet<Slot777FunCreditOperation>(
    `/crazy-cash/operations/${encodeURIComponent(operationId)}?type=fun_credit_claim`,
    options,
  );
}
