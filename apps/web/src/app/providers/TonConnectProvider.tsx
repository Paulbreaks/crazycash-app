import { useEffect, useRef, type PropsWithChildren } from 'react';
import { TonConnectUIProvider, useIsConnectionRestored, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import {
  createTonDeposit,
  createTonProofChallenge,
  disconnectTonWallet,
  getTonWallet,
  getTonDeposit,
  getTonWalletBalance,
  verifyTonProof,
} from '../../features/ton/api';
import { ApiRequestError } from '../../shared/api-client';

const manifestUrl = import.meta.env.VITE_TON_MANIFEST_URL ?? '';
// The project environment contract uses `1`, while `true` is also a common
// Vite convention. Accept both so a production build cannot silently omit the
// TonConnect provider because of a harmless boolean spelling difference.
const tonConnectFeatureFlag = (import.meta.env.VITE_ENABLE_TONCONNECT ?? '').trim().toLowerCase();
const enableTonConnect = tonConnectFeatureFlag === '1' || tonConnectFeatureFlag === 'true';
// Shell is only reading an owner-scoped durable operation. Two seconds keeps
// the result prompt without turning normal testnet deposits into aggressive
// API polling; the watcher remains the sole financial authority.
const DEPOSIT_POLL_INTERVAL_MS = 2_000;
// The watcher runs every few seconds and is the only authority allowed to
// expire/credit an invoice. This small grace period lets its terminal state
// reach the open Mini App instead of leaving a visual `---` indefinitely.
const DEPOSIT_EXPIRY_SETTLEMENT_GRACE_MS = 20_000;
// UI-only recovery marker. It identifies the one invoice initiated by this
// Mini App session; it is never trusted by the API or watcher for money.
const PENDING_DEPOSIT_STORAGE_KEY = 'crazy_cash_pending_deposit';
type TonChain = '-3' | '-239';

function chainForTonNetwork(network: 'testnet' | 'mainnet'): TonChain {
  return network === 'testnet' ? '-3' : '-239';
}

function walletNetworkMessage(chain: TonChain): 'USE A TESTNET WALLET' | 'USE A MAINNET WALLET' {
  return chain === '-3' ? 'USE A TESTNET WALLET' : 'USE A MAINNET WALLET';
}

/**
 * TonConnect deliberately hides provider-specific errors behind a small
 * public error surface. We only need to distinguish an explicit user cancel
 * from a stale/unavailable signing transport; neither raw error is exposed to
 * Godot.
 */
function isExplicitWalletCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const detail = `${error.name} ${error.message}`.toLowerCase();
  return detail.includes('user_reject')
    || detail.includes('user reject')
    || detail.includes('user_cancel')
    || detail.includes('user cancel');
}

function readPendingDepositOperationId(): string | null {
  try {
    const operationId = window.sessionStorage.getItem(PENDING_DEPOSIT_STORAGE_KEY);
    return operationId && operationId.length > 0 ? operationId : null;
  } catch {
    // Privacy modes can disable Web Storage. In that case deposits remain safe,
    // but the UI cannot recover a pending spinner after an iframe rebuild.
    return null;
  }
}

function savePendingDepositOperationId(operationId: string): void {
  try {
    window.sessionStorage.setItem(PENDING_DEPOSIT_STORAGE_KEY, operationId);
  } catch {
    // See readPendingDepositOperationId(): this is only a UX enhancement.
  }
}

function clearPendingDepositOperationId(operationId: string): void {
  try {
    if (window.sessionStorage.getItem(PENDING_DEPOSIT_STORAGE_KEY) === operationId) {
      window.sessionStorage.removeItem(PENDING_DEPOSIT_STORAGE_KEY);
    }
  } catch {
    // Storage is non-authoritative; nothing else needs to be rolled back.
  }
}

export function TonConnectProvider({ children }: PropsWithChildren) {
  if (!enableTonConnect || !manifestUrl) {
    return <>{children}</>;
  }

  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <TonConnectActionHandler />
      {children}
    </TonConnectUIProvider>
  );
}

/**
 * Shell получает намерение из Godot через DOM event. Только этот React-слой
 * имеет право вызвать TonConnect UI; игра не получает адрес, proof или ключи.
 */
function TonConnectActionHandler() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const isConnectionRestored = useIsConnectionRestored();
  const verifiedWalletAddressRef = useRef<string | null>(null);
  // This derives from the server challenge or durable server-side wallet
  // binding. TonConnect UI state alone never chooses a payment network.
  const requestedChainRef = useRef<TonChain | null>(null);
  // A deposit can be in the short interval between invoice creation and the
  // TonConnect promise settling. Reserving that operation prevents a pageshow
  // recovery request from starting a second, late `pending` presentation after
  // the user has cancelled Tonkeeper.
  const submittingDepositOperationRef = useRef<string | null>(null);
  const activeDepositOperationRef = useRef<string | null>(null);

  function reportDepositResult(detail: { success: boolean; message: string; pending?: boolean; balance?: { mode: 'real'; value: string } }) {
    window.dispatchEvent(new CustomEvent('crazy-cash:ton-deposit-result', { detail }));
  }

  function reportConnectFailure(message = 'CONNECT ERROR. TRY AGAIN') {
    // The actual SDK/API exception can contain provider details. Godot receives
    // only a short safe reason, never raw wallet, address, proof or RPC data.
    window.dispatchEvent(new CustomEvent('crazy-cash:ton-connect-failed', { detail: { message } }));
  }

  useEffect(() => {
    // GamePage may receive CONNECT from the iframe before or after the
    // provider mounts. Advertise that the only layer allowed to call the SDK
    // is ready, so a missing/disabled provider cannot look like a dead button.
    (window as Window & { __crazyCashTonConnectReady?: boolean }).__crazyCashTonConnectReady = true;
    window.dispatchEvent(new Event('crazy-cash:ton-connect-ready'));

    const openWalletModal = () => {
      void (async () => {
        // The challenge comes from the authenticated API and is inserted into
        // the TON Connect request before the wallet modal opens. A connected
        // address without this signed proof never becomes a verified wallet.
        tonConnectUI.setConnectRequestParameters({ state: 'loading' });
        try {
          const challenge = await createTonProofChallenge();
          const requestedChain = chainForTonNetwork(challenge.network);
          requestedChainRef.current = requestedChain;
          tonConnectUI.setConnectionNetwork(requestedChain);
          tonConnectUI.setConnectRequestParameters({ state: 'ready', value: { tonProof: challenge.payload } });
          await tonConnectUI.openModal();
        } catch {
          tonConnectUI.setConnectRequestParameters(null);
          window.dispatchEvent(new CustomEvent('crazy-cash:ton-wallet-state', {
            detail: { connected: false, walletBalance: '---' },
          }));
          reportConnectFailure();
        }
      })();
    };
    window.addEventListener('crazy-cash:ton-connect-requested', openWalletModal);
    return () => window.removeEventListener('crazy-cash:ton-connect-requested', openWalletModal);
  }, [tonConnectUI]);

  useEffect(() => {
    let disposed = false;

    const pollDepositSettlement = async (operationId: string, expiresAt: string) => {
      const deadline = new Date(expiresAt).getTime();
      const terminalDeadline = deadline + DEPOSIT_EXPIRY_SETTLEMENT_GRACE_MS;
      try {
        while (!disposed && Date.now() < terminalDeadline) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, DEPOSIT_POLL_INTERVAL_MS));
          if (disposed) return;
          try {
            const current = await getTonDeposit(operationId);
            if (current.status === 'completed' && current.balance) {
              clearPendingDepositOperationId(operationId);
              reportDepositResult({ success: true, message: 'CREDITS ADDED', balance: current.balance });
              return;
            }
            if (current.status === 'failed') {
              clearPendingDepositOperationId(operationId);
              reportDepositResult({
                success: false,
                message: current.error === 'deposit_expired' ? 'PAYMENT NOT RECEIVED. TRY AGAIN' : 'DEPOSIT ERROR',
              });
              return;
            }
          } catch {
            // Network trouble is not financial evidence. Keep reconciling the
            // durable operation until its terminal deadline.
          }
        }
        if (!disposed) reportDepositResult({ success: false, message: 'PAYMENT NOT RECEIVED. TRY AGAIN' });
      } finally {
        if (activeDepositOperationRef.current === operationId) activeDepositOperationRef.current = null;
      }
    };

    const startDepositPolling = (operationId: string, expiresAt: string) => {
      if (activeDepositOperationRef.current === operationId) return;
      activeDepositOperationRef.current = operationId;
      reportDepositResult({ success: true, pending: true, message: 'PAYMENT PROCESSING' });
      void pollDepositSettlement(operationId, expiresAt);
    };

    const requestDeposit = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (!detail || typeof detail !== 'object'
        || typeof (detail as { operationId?: unknown }).operationId !== 'string'
        || typeof (detail as { amount?: unknown }).amount !== 'string') {
        reportDepositResult({ success: false, message: 'INVALID DEPOSIT AMOUNT' });
        return;
      }
      const { operationId, amount } = detail as { operationId: string; amount: string };
      if (submittingDepositOperationRef.current || activeDepositOperationRef.current) {
        reportDepositResult({ success: false, message: 'DEPOSIT ALREADY IN PROGRESS' });
        return;
      }
      // A durable server-side wallet binding permits displaying the player's
      // balance, but it cannot sign a TonConnect transaction. Wait until the
      // browser SDK has restored its own session and reject before creating an
      // invoice when no signing wallet is available. Otherwise a stale Mini
      // App would create abandoned invoices and immediately show CANCELLED.
      if (!isConnectionRestored) {
        reportDepositResult({ success: false, message: 'WALLET CONNECTING. TRY AGAIN' });
        return;
      }
      // The hook is a React rendering snapshot. The SDK getter is the
      // authority at the moment a transaction is actually requested, which
      // matters after returning from Tonkeeper into a recreated Mini App.
      const signingWallet = tonConnectUI.wallet;
      if (!signingWallet) {
        reportDepositResult({ success: false, message: 'RECONNECT WALLET TO TOP UP' });
        return;
      }
      const expectedChain = requestedChainRef.current;
      if (!expectedChain) {
        reportDepositResult({ success: false, message: 'RECONNECT WALLET TO TOP UP' });
        return;
      }
      if (signingWallet.account.chain !== expectedChain) {
        reportDepositResult({ success: false, message: walletNetworkMessage(expectedChain) });
        return;
      }
      // Set synchronously, before the first await. The Mini App can become
      // visible while Tonkeeper is opening and trigger recovery in that gap.
      submittingDepositOperationRef.current = operationId;
      void (async () => {
        try {
          const invoice = await createTonDeposit(operationId, amount);
          if (!invoice.deposit.destination || !invoice.deposit.payload) {
            if (submittingDepositOperationRef.current === operationId) {
              submittingDepositOperationRef.current = null;
            }
            reportDepositResult({ success: false, message: 'DEPOSIT UNAVAILABLE' });
            return;
          }
          // Save before yielding control to Tonkeeper. If the Mini App is
          // reconstructed during the hand-off, only this exact operation can
          // restore its visual pending state; unrelated old invoices cannot.
          savePendingDepositOperationId(operationId);
          // A successful promise only means the wallet accepted submission.
          // It never changes Crazy Cash balance; the watcher settles the
          // invoice after server-side chain verification.
          await tonConnectUI.sendTransaction({
            validUntil: Math.floor(new Date(invoice.deposit.expiresAt).getTime() / 1_000),
            // Use the server-selected chain explicitly. This prevents a
            // wallet from treating a network-specific invoice as an
            // unspecified/default-chain transaction.
            network: expectedChain,
            messages: [{
              address: invoice.deposit.destination,
              amount: invoice.deposit.amountNanotons,
              payload: invoice.deposit.payload,
            }],
          });
          if (submittingDepositOperationRef.current === operationId) {
            submittingDepositOperationRef.current = null;
          }
          // Keep the open Mini App fresh. The same durable operation is also
          // recovered when an iframe is rebuilt after a Tonkeeper hand-off.
          startDepositPolling(operationId, invoice.deposit.expiresAt);
        } catch (error) {
          // A rejected TonConnect request means this Mini App has no payment
          // in progress. The server keeps its invoice until TTL because a
          // client error is never proof that an on-chain transfer is absent.
          clearPendingDepositOperationId(operationId);
          if (submittingDepositOperationRef.current === operationId) {
            submittingDepositOperationRef.current = null;
          }
          // The API maps business errors to safe codes. TonConnect cancellation
          // and transport errors stay intentionally short for the Godot banner.
          if (error instanceof ApiRequestError && error.code === 'invalid_deposit_amount') {
            reportDepositResult({ success: false, message: 'INVALID DEPOSIT AMOUNT' });
          } else if (error instanceof ApiRequestError && error.code === 'wallet_not_verified') {
            reportDepositResult({ success: false, message: 'WALLET VERIFICATION REQUIRED' });
          } else if (error instanceof ApiRequestError && error.code === 'deposits_unavailable') {
            reportDepositResult({ success: false, message: 'DEPOSIT UNAVAILABLE' });
          } else if (isExplicitWalletCancellation(error)) {
            reportDepositResult({ success: false, message: 'DEPOSIT CANCELLED' });
          } else {
            // The server-side binding can still be valid while the wallet
            // bridge session in this particular Mini App has expired. Calling
            // that a cancellation hides the only useful recovery action.
            reportDepositResult({ success: false, message: 'RECONNECT WALLET TO TOP UP' });
          }
        }
      })();
    };

    const recoverPendingDeposit = () => {
      void (async () => {
        const operationId = readPendingDepositOperationId();
        if (!operationId) return;
        // The request that opened Tonkeeper owns this operation until its
        // promise resolves or rejects. Do not let pageshow start a duplicate
        // polling loop while that decision is still pending.
        if (submittingDepositOperationRef.current === operationId) return;
        try {
          const operation = await getTonDeposit(operationId);
          if (disposed) return;
          if (operation.status === 'completed' && operation.balance) {
            clearPendingDepositOperationId(operationId);
            reportDepositResult({ success: true, message: 'CREDITS ADDED', balance: operation.balance });
            return;
          }
          if (operation.status === 'failed') {
            clearPendingDepositOperationId(operationId);
            reportDepositResult({
              success: false,
              message: operation.error === 'deposit_expired' ? 'PAYMENT NOT RECEIVED. TRY AGAIN' : 'DEPOSIT ERROR',
            });
            return;
          }
          if (operation.status === 'processing') {
            startDepositPolling(operation.operationId, operation.deposit.expiresAt);
          }
        } catch {
          // A removed/expired session or transient network failure is handled
          // by GamePage's regular handshake. Do not show a false payment error.
        }
      })();
    };
    window.addEventListener('crazy-cash:ton-deposit-requested', requestDeposit);
    window.addEventListener('crazy-cash:ton-deposit-recovery-request', recoverPendingDeposit);
    return () => {
      disposed = true;
      window.removeEventListener('crazy-cash:ton-deposit-requested', requestDeposit);
      window.removeEventListener('crazy-cash:ton-deposit-recovery-request', recoverPendingDeposit);
    };
  }, [isConnectionRestored, tonConnectUI, wallet]);

  useEffect(() => {
    const disconnectWallet = () => {
      void (async () => {
        verifiedWalletAddressRef.current = null;
        try {
          // This is the authoritative action: it removes the server wallet
          // binding and succeeds independently of whether Tonkeeper's bridge
          // happens to respond after the Mini App regains focus.
          await disconnectTonWallet();
        } catch {
          reportConnectFailure('DISCONNECT ERROR. TRY AGAIN');
          return;
        }

        // Finish the Godot action immediately. `TonConnectUI.disconnect()`
        // clears only local SDK storage and can remain pending in a mobile
        // bridge; it must never keep the UI on `---`.
        window.dispatchEvent(new CustomEvent('crazy-cash:ton-wallet-state', {
          detail: { connected: false, walletBalance: '---' },
        }));
        void tonConnectUI.disconnect().catch(() => undefined);
      })();
    };
    window.addEventListener('crazy-cash:ton-disconnect-requested', disconnectWallet);
    return () => window.removeEventListener('crazy-cash:ton-disconnect-requested', disconnectWallet);
  }, [tonConnectUI]);

  useEffect(() => {
    let disposed = false;
    function publishBalanceLoading() {
      // `useTonWallet()` is populated as soon as Tonkeeper returns control to
      // the Mini App. Publish this transitional state before proof validation
      // and the RPC balance request, otherwise a recreated Godot iframe keeps
      // its default CONNECT WALLET label for those few seconds.
      window.dispatchEvent(new CustomEvent('crazy-cash:ton-wallet-state', {
        detail: { connected: true, walletBalance: '---' },
      }));
    }

    function publishDisconnected() {
      verifiedWalletAddressRef.current = null;
      requestedChainRef.current = null;
      window.dispatchEvent(new CustomEvent('crazy-cash:ton-wallet-state', {
        detail: { connected: false, walletBalance: '---' },
      }));
    }

    /**
     * A verified wallet is a durable server-side binding to the authenticated
     * Telegram user. It must survive a new Mini App WebView, while a
     * TonConnect proof is intentionally single-use and cannot be replayed.
     *
     * This function never trusts local TonConnect storage for authority: it
     * reads only the user-scoped wallet already verified by the API. The
     * wallet SDK is still required whenever it has to sign a transaction.
     */
    async function publishPersistedWalletBalance(): Promise<boolean> {
      try {
        const result = await getTonWalletBalance();
        if (!result.wallet) return false;
        requestedChainRef.current = chainForTonNetwork(result.wallet.wallet.network);
        if (!disposed) {
          window.dispatchEvent(new CustomEvent('crazy-cash:ton-wallet-state', {
            detail: { connected: true, walletBalance: result.wallet.displayBalance },
          }));
        }
        return true;
      } catch {
        // A flaky RPC must not erase a cryptographically verified account
        // binding. Ask the API for its capability and keep the Godot control
        // in its explicit loading state until a later balance refresh works.
        try {
          const result = await getTonWallet();
          if (!result.wallet) return false;
          requestedChainRef.current = chainForTonNetwork(result.wallet.network);
          if (!disposed) {
            window.dispatchEvent(new CustomEvent('crazy-cash:ton-wallet-state', {
              detail: { connected: true, walletBalance: '---' },
            }));
          }
          return true;
        } catch {
          return false;
        }
      }
    }

    async function publishVerifiedWalletBalance() {
      try {
        const result = await getTonWalletBalance();
        if (!result.wallet) {
          publishDisconnected();
          return;
        }
        requestedChainRef.current = chainForTonNetwork(result.wallet.wallet.network);
        if (!disposed) {
          window.dispatchEvent(new CustomEvent('crazy-cash:ton-wallet-state', {
            detail: { connected: true, walletBalance: result.wallet.displayBalance },
          }));
        }
      } catch {
        // The wallet remains cryptographically verified even if the external
        // RPC is temporarily unavailable. Do not falsely report a disconnect.
        if (!disposed) {
          window.dispatchEvent(new CustomEvent('crazy-cash:ton-wallet-state', {
            detail: { connected: true, walletBalance: '---' },
          }));
        }
      }
    }

    // The physical connection and server verification are separate states.
    // Godot sees only the resulting boolean and formatted balance, never an
    // address, proof or key.
    const publishWalletState = async () => {
      if (!wallet) {
        if (await publishPersistedWalletBalance()) return;
        publishDisconnected();
        return;
      }

	  // This is deliberately before every async path below. It is only a UI
	  // loading state: Godot still receives neither an address nor a usable
	  // balance until server proof validation and the balance read complete.
	  publishBalanceLoading();

      // `game:ready` may request state again. A proof nonce is one-use, so a
      // wallet verified in this exact connector session must only refresh RPC.
      if (verifiedWalletAddressRef.current === wallet.account.address) {
        await publishVerifiedWalletBalance();
        return;
      }

      const proofItem = wallet.connectItems?.tonProof;
      const requestedChain = requestedChainRef.current;

      // A fresh CONNECT flow is the only path that may consume a new proof.
      // On a later Mini App launch TonConnect can restore a wallet object but
      // not a reusable challenge. Reuse the server binding instead of
      // forcibly disconnecting the user and making them prove ownership again.
      const hasFreshProof = proofItem && 'proof' in proofItem
        && wallet.account.walletStateInit
        && requestedChain !== null;
      if (!hasFreshProof) {
        if (await publishPersistedWalletBalance()) {
          verifiedWalletAddressRef.current = wallet.account.address;
          return;
        }
        publishDisconnected();
        void tonConnectUI.disconnect().catch(() => undefined);
        reportConnectFailure('WALLET PROOF REQUIRED');
        return;
      }

      if (wallet.account.chain !== requestedChain) {
        publishDisconnected();
        void tonConnectUI.disconnect().catch(() => undefined);
        reportConnectFailure(walletNetworkMessage(requestedChain));
        return;
      }

      try {
        await verifyTonProof({
          address: wallet.account.address,
          network: wallet.account.chain,
          ...(wallet.account.publicKey ? { public_key: wallet.account.publicKey } : {}),
          proof: { ...proofItem.proof, state_init: wallet.account.walletStateInit },
        });
        verifiedWalletAddressRef.current = wallet.account.address;
        await publishVerifiedWalletBalance();
      } catch (error) {
        // A restored TonConnect session is not proof of current ownership. It
        // must reconnect with a fresh server challenge before Godot unlocks it.
        publishDisconnected();
        void tonConnectUI.disconnect().catch(() => undefined);
        if (error instanceof ApiRequestError) {
          if (error.code === 'wrong_ton_network') {
            reportConnectFailure(walletNetworkMessage(requestedChain));
          }
          else if (error.code === 'unsupported_ton_wallet') reportConnectFailure('WALLET NOT SUPPORTED');
          else reportConnectFailure('WALLET VERIFICATION FAILED');
        } else {
          reportConnectFailure();
        }
      }
    };
    void publishWalletState();
    window.addEventListener('crazy-cash:ton-wallet-state-request', publishWalletState);
    return () => {
      disposed = true;
      window.removeEventListener('crazy-cash:ton-wallet-state-request', publishWalletState);
    };
  }, [wallet, tonConnectUI]);

  return null;
}
