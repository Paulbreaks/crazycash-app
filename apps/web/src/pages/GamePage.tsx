import { useEffect, useMemo, useRef, useState } from 'react';
import { retrieveRawInitData } from '@telegram-apps/sdk';
import { isGameToShellMessage, type GameToShellMessage, type ShellToGameMessage } from '../bridge/messages';
import { ApiRequestError } from '../shared/api-client';
import { reportClientDiagnostic } from '../features/diagnostics/report';
import {
  claimSlot777FunCredits,
  createSlot777Spin,
  getSlot777Balances,
  getSlot777FunCreditOperation,
  getSlot777SpinByRequest,
  getSlot777Session,
} from '../features/slot777/api';
import { authenticateTelegram, getTelegramAvatar, getTonConnectAction } from '../features/auth/api';
import { createTonWithdrawal, getTonWithdrawal, type TonWithdrawalOperation } from '../features/ton/api';

const GODOT_ENTRY = '/godot/index.html';
// Godot itself shows CONNECTION ERROR after 5 seconds. Shell stops a stuck
// browser request slightly before that, so it can return a controlled error.
const SHELL_REQUEST_TIMEOUT_MS = 4_500;
const SHELL_HANDSHAKE_DELAYS_MS = [0, 350, 1_200] as const;
const WITHDRAWAL_POLL_INTERVAL_MS = 2_000;
const WITHDRAWAL_SETTLEMENT_TIMEOUT_MS = 90_000;
// TonConnect can hand control to another app. This bounds a presentation-only
// loader; it never changes wallet ownership or server verification.
const WALLET_ACTION_TIMEOUT_MS = 60_000;
const PAGE_HIDDEN_ABORT_REASON = 'page_hidden';
// This is UI state only: balances and every REAL spin remain authorized by API.
// sessionStorage survives returning from Tonkeeper and iframe recreation, but is
// cleared when the Mini App/browser tab is closed.
const ACTIVE_GAME_MODE_STORAGE_KEY = 'crazy_cash_active_game_mode';

type TonWalletState = { connected: boolean; walletBalance: string };
type GameMode = 'fun' | 'real';

function loadStoredGameMode(): GameMode {
  try {
    return window.sessionStorage.getItem(ACTIVE_GAME_MODE_STORAGE_KEY) === 'real' ? 'real' : 'fun';
  } catch {
    return 'fun';
  }
}

function storeGameMode(mode: GameMode) {
  try {
    window.sessionStorage.setItem(ACTIVE_GAME_MODE_STORAGE_KEY, mode);
  } catch {
    // Browser privacy settings may disable storage. The in-memory ref below
    // still keeps the mode while this page instance remains alive.
  }
}

function postToGame(target: Window | null, message: ShellToGameMessage) {
  if (!target) return false;
  target.postMessage(message, window.location.origin);
  return true;
}

function getTelegramInitData(): string | null {
  // Not every Telegram client exposes the same global-object timing. The
  // official SDK also reads the Mini App launch parameters (tgWebAppData), so
  // it is the primary source. The global is retained only as a compatibility
  // fallback for older clients.
  try {
    const initData = retrieveRawInitData();
    if (typeof initData === 'string' && initData.length > 0) return initData;
  } catch {
    // A normal browser has no Telegram launch parameters.
  }

  const initData = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData;
  return typeof initData === 'string' && initData.length > 0 ? initData : null;
}

function isTelegramMiniApp(): boolean {
  return getTelegramInitData() !== null;
}

function isAllowedTelegramDeepLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 't.me'
      && /^\/[A-Za-z0-9_]{5,32}$/.test(url.pathname)
      && url.searchParams.get('startapp') === 'play';
  } catch {
    return false;
  }
}

function supportsGodotWeb(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null && typeof WebAssembly === 'object';
  } catch {
    return false;
  }
}

export function GamePage() {
  // Telegram определяется по подписанному launch context. Все остальные
  // браузеры получают desktop/mobile-вёрстку исключительно через CSS media
  // query — User-Agent и query-параметры не нужны и не влияют на права.
  const isTelegramContext = isTelegramMiniApp();
  const isGodotWebSupported = useMemo(supportsGodotWeb, []);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const spinRequestInFlight = useRef(false);
  const funCreditRequestInFlight = useRef(false);
  const realBalanceRequestInFlight = useRef(false);
  const sessionRequestInFlight = useRef(false);
  const profileAvatarRequestInFlight = useRef(false);
  const accountTypeRef = useRef<'guest' | 'telegram' | null>(null);
  const tonConnectHandlerReadyRef = useRef(false);
  const telegramAuthenticationRef = useRef<Promise<void> | null>(null);
  const gameReadyRef = useRef(false);
  const activeGameModeRef = useRef<GameMode>(loadStoredGameMode());
  const modePanelOpenRef = useRef(false);
  const requestControllersRef = useRef(new Set<AbortController>());
  const handshakeTimersRef = useRef<number[]>([]);
  const walletActionTimeoutRef = useRef<number | null>(null);
  const tonTopUpRequestInFlight = useRef(false);
  const tonWithdrawRequestInFlight = useRef(false);
  const withdrawalSettlementOperationRef = useRef<string | null>(null);
  const walletStateRef = useRef<TonWalletState>({ connected: false, walletBalance: '---' });
  // Это состояние относится только к пространству вокруг iframe. Панель,
  // её анимация и блокировка ввода по-прежнему остаются в Godot.
  const [isModePanelOpen, setIsModePanelOpen] = useState(false);

  const shellInitMessage = useMemo<ShellToGameMessage>(
    () => ({
      type: 'shell:init',
      payload: {
        appVersion: '0.1.0',
        locale: navigator.language,
        theme: 'light',
      },
    }),
    [],
  );

  function sendToGame(message: ShellToGameMessage) {
    postToGame(frameRef.current?.contentWindow ?? null, message);
  }

  /** A guest cookie is absent, expired or no longer accepted by the API. */
  function sendSessionExpiredToGame() {
    sendToGame({ type: 'shell:sessionExpired', payload: {} });
  }

  /** Keeps a suspended Safari fetch from permanently blocking a UI action. */
  function createRequestController() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort('request_timeout'), SHELL_REQUEST_TIMEOUT_MS);
    requestControllersRef.current.add(controller);

    return {
      signal: controller.signal,
      release: () => {
        window.clearTimeout(timeoutId);
        requestControllersRef.current.delete(controller);
      },
    };
  }

  function cancelAllRequestsForPageHide() {
    for (const controller of requestControllersRef.current) {
      controller.abort(PAGE_HIDDEN_ABORT_REASON);
    }
    requestControllersRef.current.clear();
  }

  function sendModePanelBackground() {
    sendToGame({
      type: 'shell:modePanelBackground',
      payload: { isOpen: modePanelOpenRef.current },
    });
  }

  function sendWalletStateToGame() {
    sendToGame({ type: 'shell:walletState', payload: walletStateRef.current });
  }

  function sendTonConnectError(message = 'CONNECT ERROR. TRY AGAIN') {
    clearWalletActionTimeout();
    sendToGame({ type: 'shell:tonConnectError', payload: { message } });
  }

  function clearWalletActionTimeout() {
    if (walletActionTimeoutRef.current !== null) {
      window.clearTimeout(walletActionTimeoutRef.current);
      walletActionTimeoutRef.current = null;
    }
  }

  /** Shell owns the beginning/end of the visual wallet action state. */
  function setWalletActionPending(action: 'connect' | 'disconnect') {
    clearWalletActionTimeout();
    sendToGame({ type: 'shell:walletActionState', payload: { action, pending: true } });
    walletActionTimeoutRef.current = window.setTimeout(() => {
      walletActionTimeoutRef.current = null;
      sendTonConnectError(action === 'connect' ? 'CONNECT CANCELLED' : 'DISCONNECT ERROR. TRY AGAIN');
    }, WALLET_ACTION_TIMEOUT_MS);
  }

  function clearHandshakeTimers() {
    for (const timerId of handshakeTimersRef.current) window.clearTimeout(timerId);
    handshakeTimersRef.current = [];
  }

  /**
   * Telegram auth always precedes the regular cookie-session request. A valid
   * signed packet receives a new cookie; a failed refresh deliberately leaves
   * a still-valid existing cookie untouched on the server.
   */
  async function ensureTelegramAuthentication() {
    const initData = getTelegramInitData();
    if (!initData) return;

    if (!telegramAuthenticationRef.current) {
      telegramAuthenticationRef.current = authenticateTelegram(initData).then(() => undefined);
    }
    try {
      await telegramAuthenticationRef.current;
    } catch {
      // A later pageshow may bring a fresh initData. Session loading below can
      // still use a previously valid server cookie if it exists.
      telegramAuthenticationRef.current = null;
    }
  }

  /**
   * iOS can restore React and the iframe independently after a long background
   * period. shell:init is deliberately repeatable: Godot answers it with a new
   * game:ready once its postMessage listener exists.
   */
  function requestGameHandshake() {
    clearHandshakeTimers();
    handshakeTimersRef.current = SHELL_HANDSHAKE_DELAYS_MS.map((delay) => window.setTimeout(() => {
      sendToGame(shellInitMessage);
    }, delay));
  }

  async function loadAndSendSession() {
    if (sessionRequestInFlight.current) return;
    sessionRequestInFlight.current = true;
    const request = createRequestController();

    try {
      await ensureTelegramAuthentication();
      const session = await getSlot777Session({ signal: request.signal });
      accountTypeRef.current = session.user.accountType;
      // API deliberately starts every session in FUN mode. The selected game
      // mode is presentation state owned by this Shell, so an iframe restored
      // after Tonkeeper must receive the last valid choice rather than be
      // forced back to FUN. REAL is still accepted only for a Telegram user
      // that API marks as eligible; this does not grant any financial right.
      const activeMode: GameMode = activeGameModeRef.current === 'real' && session.realModeAvailable
        ? 'real'
        : 'fun';
      if (activeMode !== activeGameModeRef.current) {
        activeGameModeRef.current = activeMode;
        storeGameMode(activeMode);
      }
      sendToGame({
        type: 'shell:session',
        payload: {
          authorized: session.authorized,
          activeMode,
          realModeAvailable: session.realModeAvailable,
          surface: isTelegramContext ? 'telegram' : 'browser',
          balances: session.balances,
        },
      });
      // Authentication may finish after Godot's first game:ready. Repeat the
      // idempotent recovery request now that the cookie session is confirmed.
      window.dispatchEvent(new Event('crazy-cash:ton-deposit-recovery-request'));
      void loadAndSendTelegramAvatar();
    } catch (error) {
      // After pagehide the next pageshow handshake will fetch a fresh session.
      // Do not briefly replace a valid game with AUTHORIZATION REQUIRED.
      if (request.signal.reason === PAGE_HIDDEN_ABORT_REASON) return;
		// Для игры нет практической разницы между истёкшей и удалённой
		// гостевой cookie: обе требуют начать новую гостевую сессию на главной.
		if (error instanceof ApiRequestError && error.status === 401) {
			sendSessionExpiredToGame();
			return;
		}
      // Transport failure says nothing about cookie validity or balances. In
      // particular, never replace a known balance with a fabricated zero:
      // Godot either keeps its last confirmed value or continues its initial
      // loading indicator until a later pageshow handshake succeeds.
    } finally {
      request.release();
      sessionRequestInFlight.current = false;
    }
  }

  /** An avatar is optional presentation data and must never block the game. */
  async function loadAndSendTelegramAvatar() {
    if (!isTelegramContext || profileAvatarRequestInFlight.current) return;
    profileAvatarRequestInFlight.current = true;
    const request = createRequestController();
    try {
      const avatar = await getTelegramAvatar(request.signal);
      if (avatar) sendToGame({ type: 'shell:profileAvatar', payload: avatar });
    } catch {
      // The default Godot icon remains visible if Telegram's image is absent
      // or temporarily unavailable.
    } finally {
      request.release();
      profileAvatarRequestInFlight.current = false;
    }
  }

  async function requestSpin(payload: Extract<GameToShellMessage, { type: 'game:spinRequested' }>['payload']) {
    if (spinRequestInFlight.current) return;
    spinRequestInFlight.current = true;
    const requestId = crypto.randomUUID();
    const requestController = createRequestController();

    try {
      const request = payload.mode === 'real'
        ? {
            requestId,
            mode: 'real' as const,
            bet: String(payload.bet),
            denomination: payload.denomination,
          }
        : {
            requestId,
            mode: 'fun' as const,
            bet: String(payload.bet),
          };
      const result = await createSlot777Spin(request, { signal: requestController.signal });
      sendToGame({
        type: 'shell:spinResult',
        payload: {
          requestId,
          gameRequestId: payload.gameRequestId,
          combination: result.combination,
          rule: result.rule,
          multiplier: result.multiplier,
          payout: result.payout,
          ...(result.denomination ? { denomination: result.denomination } : {}),
          balance: result.balance,
        },
      });
    } catch (error) {
		if (error instanceof ApiRequestError && error.status === 401) {
			sendSessionExpiredToGame();
			return;
		}
      // `requestId` is durable per click. If the POST response was dropped
      // after commit, retrieve the saved spin rather than start another round.
      const reconciliation = createRequestController();
      try {
        const saved = await getSlot777SpinByRequest(payload.mode, requestId, { signal: reconciliation.signal });
        sendToGame({
          type: 'shell:spinResult',
          payload: {
            requestId,
            gameRequestId: payload.gameRequestId,
            combination: saved.combination,
            rule: saved.rule,
            multiplier: saved.multiplier,
            payout: saved.payout,
            ...(saved.denomination ? { denomination: saved.denomination } : {}),
            balance: saved.balance,
          },
        });
        return;
      } catch (reconciliationError) {
        if (reconciliationError instanceof ApiRequestError && reconciliationError.status === 401) {
          sendSessionExpiredToGame();
          return;
        }
      } finally {
        reconciliation.release();
      }
      const code = error instanceof ApiRequestError && error.code === 'insufficient_fun_balance'
        ? 'insufficient_fun_balance'
        : error instanceof ApiRequestError && error.code === 'insufficient_real_balance'
          ? 'insufficient_real_balance'
          : error instanceof ApiRequestError && error.code === 'idempotency_mismatch'
            ? 'idempotency_mismatch'
          : 'request_failed';
      sendToGame({
        type: 'shell:spinError',
        payload: {
          requestId,
          gameRequestId: payload.gameRequestId,
          code,
        },
      });
    } finally {
      requestController.release();
      spinRequestInFlight.current = false;
    }
  }

  async function requestFunCredits() {
    if (funCreditRequestInFlight.current) return;
    funCreditRequestInFlight.current = true;
    const operationId = crypto.randomUUID();
    const request = createRequestController();

    try {
      const result = await claimSlot777FunCredits(operationId, { signal: request.signal });
      sendToGame({
        type: 'shell:funCreditsResult',
        payload: {
          credited: result.credited,
          balance: result.balance,
        },
      });
    } catch (error) {
		if (error instanceof ApiRequestError && error.status === 401) {
			sendSessionExpiredToGame();
			return;
		}
      // An aborted or dropped POST can still have committed in MySQL. Ask for
      // the durable command result by the *same* operation ID before showing
      // a failure; this is the client half of exactly-once-visible behaviour.
      const reconciliation = createRequestController();
      try {
        const operation = await getSlot777FunCreditOperation(operationId, { signal: reconciliation.signal });
        if (operation.status === 'completed' && operation.credited && operation.balance) {
          sendToGame({
            type: 'shell:funCreditsResult',
            payload: { credited: operation.credited, balance: operation.balance },
          });
          return;
        }
        if (operation.status === 'rejected') {
          sendToGame({
            type: 'shell:funCreditsError',
            payload: {
              code: operation.error === 'fun_credit_balance_too_high'
                ? 'fun_credit_balance_too_high'
                : 'request_failed',
              ...(operation.balance ? { balance: operation.balance } : {}),
            },
          });
          return;
        }
      } catch (reconciliationError) {
        if (reconciliationError instanceof ApiRequestError && reconciliationError.status === 401) {
          sendSessionExpiredToGame();
          return;
        }
      } finally {
        reconciliation.release();
      }

      // No committed operation was found (or the network is still offline).
      // A failed request never invents a balance; the next handshake refreshes
      // state from API. Explicit 4xx still keeps the familiar explanation.
      const code = error instanceof ApiRequestError && error.code === 'fun_credit_balance_too_high'
        ? 'fun_credit_balance_too_high'
        : 'request_failed';
      sendToGame({ type: 'shell:funCreditsError', payload: { code } });
    } finally {
      request.release();
      funCreditRequestInFlight.current = false;
    }
  }

  async function refreshRealBalance() {
    if (realBalanceRequestInFlight.current) return;
    realBalanceRequestInFlight.current = true;
    const request = createRequestController();

    try {
      const result = await getSlot777Balances({ signal: request.signal });
      sendToGame({ type: 'shell:balances', payload: { balances: result.balances } });
    } finally {
      request.release();
      realBalanceRequestInFlight.current = false;
    }
  }

  /**
   * A withdrawal is a server-side ledger hold, not a browser-side transfer.
   * We use one UUID for POST and recovery so a timed-out browser response can
   * never make a player submit a second withdrawal.
   */
  async function requestTonWithdrawal(amount: string) {
    if (tonWithdrawRequestInFlight.current) return;
    tonWithdrawRequestInFlight.current = true;
    const operationId = crypto.randomUUID();
    const request = createRequestController();

    const sendSettlementPending = (result: TonWithdrawalOperation) => {
      sendToGame({
        type: 'shell:tonOperationResult',
        payload: {
          action: 'withdraw',
          success: true,
          message: 'WITHDRAWAL PROCESSING',
          pending: true,
          balance: result.balance,
        },
      });
    };
    const sendSettlementResult = (result: TonWithdrawalOperation) => {
      const settled = result.withdrawal.status === 'finalized';
      sendToGame({
        type: 'shell:tonOperationResult',
        payload: {
          action: 'withdraw',
          success: settled,
          message: settled ? 'WITHDRAWAL SENT' : 'WITHDRAWAL NOT COMPLETED',
          balance: result.balance,
        },
      });
      void refreshRealBalance();
      // This event is handled by the TonConnect provider. It performs a fresh
      // server-side RPC read and sends only the display balance to Godot.
      // It is intentionally emitted only after recipient-side finalization;
      // the wallet balance cannot be expected to change when a hold is placed.
      if (settled) window.dispatchEvent(new Event('crazy-cash:ton-wallet-state-request'));
    };
    const pollSettlement = (operationIdToPoll: string) => {
      if (withdrawalSettlementOperationRef.current === operationIdToPoll) return;
      withdrawalSettlementOperationRef.current = operationIdToPoll;
      void (async () => {
        const deadline = Date.now() + WITHDRAWAL_SETTLEMENT_TIMEOUT_MS;
        try {
          while (withdrawalSettlementOperationRef.current === operationIdToPoll && Date.now() < deadline) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, WITHDRAWAL_POLL_INTERVAL_MS));
            if (withdrawalSettlementOperationRef.current !== operationIdToPoll) return;
            const pollRequest = createRequestController();
            try {
              const current = await getTonWithdrawal(operationIdToPoll, pollRequest.signal);
              if (current.withdrawal.status === 'finalized'
                || current.withdrawal.status === 'failed'
                || current.withdrawal.status === 'cancelled') {
                sendSettlementResult(current);
                return;
              }
            } catch {
              // A transport failure is not evidence that the payout failed.
              // Keep polling the owner-scoped durable operation until timeout.
            } finally {
              pollRequest.release();
            }
          }
          if (withdrawalSettlementOperationRef.current === operationIdToPoll) {
            sendFailure('WITHDRAWAL PENDING. CHECK LATER');
            void refreshRealBalance();
          }
        } finally {
          if (withdrawalSettlementOperationRef.current === operationIdToPoll) {
            withdrawalSettlementOperationRef.current = null;
          }
        }
      })();
    };
    const sendFailure = (message: string) => {
      sendToGame({ type: 'shell:tonOperationResult', payload: { action: 'withdraw', success: false, message } });
    };
    const messageForError = (error: unknown) => {
      if (!(error instanceof ApiRequestError)) return 'CONNECTION ERROR. TRY AGAIN';
      switch (error.code) {
        case 'invalid_withdrawal_amount': return 'MINIMUM WITHDRAW 0.1 GRAM';
        case 'insufficient_real_balance': return 'INSUFFICIENT AVAILABLE BALANCE';
        case 'wallet_not_verified': return 'WALLET VERIFICATION REQUIRED';
        case 'guest_fun_only': return 'TELEGRAM REQUIRED';
        case 'withdrawals_unavailable': return 'WITHDRAW UNAVAILABLE';
        default: return 'CONNECTION ERROR. TRY AGAIN';
      }
    };

    try {
      const result = await createTonWithdrawal(operationId, amount, request.signal);
      sendSettlementPending(result);
      pollSettlement(operationId);
      return;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        sendSessionExpiredToGame();
        return;
      }

      // The command may have committed just before a connection loss. Recover
      // by the same idempotency key before claiming failure to the player.
      const reconciliation = createRequestController();
      try {
        const result = await getTonWithdrawal(operationId, reconciliation.signal);
        sendSettlementPending(result);
        pollSettlement(operationId);
        return;
      } catch (reconciliationError) {
        if (reconciliationError instanceof ApiRequestError && reconciliationError.status === 401) {
          sendSessionExpiredToGame();
          return;
        }
      } finally {
        reconciliation.release();
      }
      sendFailure(messageForError(error));
    } finally {
      request.release();
      tonWithdrawRequestInFlight.current = false;
    }
  }

  async function requestTonConnectAction() {
    // Telegram's signed launch context is already required for the API proof
    // request made by TonConnectActionHandler. Do not add a second, silent
    // capability request before opening the selector: it delays the UI and
    // makes a temporary API failure look like an inert Godot button.
    // This comes from the authenticated API session, rather than from a
    // browser launch parameter that some Telegram clients may restore late.
    if (accountTypeRef.current === 'telegram') {
      if (!tonConnectHandlerReadyRef.current) {
        // TonConnect is optional at build time. Never leave a Godot button
        // inert when its React provider was not included or did not mount.
        sendTonConnectError('CONNECT UNAVAILABLE');
        return;
      }
      setWalletActionPending('connect');
      window.dispatchEvent(new Event('crazy-cash:ton-connect-requested'));
      return;
    }

    if (accountTypeRef.current === null) {
      // Do not guess a browser flow while the authenticated session is still
      // loading: some Telegram clients expose launch data after the iframe.
      sendTonConnectError('SESSION LOADING. TRY AGAIN');
      return;
    }

    try {
      const action = await getTonConnectAction('browser');
      if (action.action === 'open_telegram' && isAllowedTelegramDeepLink(action.url)) {
        setWalletActionPending('connect');
        window.location.assign(action.url);
        return;
      }
      sendTonConnectError('CONNECT UNAVAILABLE');
    } catch {
      sendTonConnectError();
    }
  }

  useEffect(() => {
    const onTonConnectFailure = (event: Event) => {
      const message = event instanceof CustomEvent && typeof event.detail?.message === 'string'
        ? event.detail.message
        : undefined;
      sendTonConnectError(message);
    };
    window.addEventListener('crazy-cash:ton-connect-failed', onTonConnectFailure);
    return () => window.removeEventListener('crazy-cash:ton-connect-failed', onTonConnectFailure);
  }, []);

  useEffect(() => () => clearWalletActionTimeout(), []);

  useEffect(() => {
    if (!isGodotWebSupported) reportClientDiagnostic('game_webgl2_unavailable', 'WebGL 2 or WebAssembly is unavailable');
  }, [isGodotWebSupported]);

  useEffect(() => {
    const tonConnectWindow = window as Window & { __crazyCashTonConnectReady?: boolean };
    tonConnectHandlerReadyRef.current = tonConnectWindow.__crazyCashTonConnectReady === true;
    const markTonConnectReady = () => {
      tonConnectHandlerReadyRef.current = true;
    };
    window.addEventListener('crazy-cash:ton-connect-ready', markTonConnectReady);
    return () => window.removeEventListener('crazy-cash:ton-connect-ready', markTonConnectReady);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isGameToShellMessage(event.data)) return;

      const message = event.data as GameToShellMessage;
      if (message.type === 'game:ready') {
        gameReadyRef.current = true;
        clearHandshakeTimers();
        // Re-apply both parts of the state after every game readiness signal.
        // This covers iframe reload, BFCache restoration and a late listener.
        sendModePanelBackground();
        sendWalletStateToGame();
        window.dispatchEvent(new Event('crazy-cash:ton-wallet-state-request'));
        // The browser may have been reconstructed while Tonkeeper was in the
        // foreground. Ask the provider to recover one durable pending deposit
        // only after both the Shell bridge and Godot listener are ready.
        window.dispatchEvent(new Event('crazy-cash:ton-deposit-recovery-request'));
        void loadAndSendSession();
      }

      if (message.type === 'game:spinRequested') {
        void requestSpin(message.payload);
      }

      if (message.type === 'game:modeRequested') {
        // Godot has already applied the visual change. Keep its selected mode
        // across a Tonkeeper round-trip or a restored iframe, but never use it
        // as authorization: every REAL spin is validated again by the API.
        activeGameModeRef.current = message.payload.currentMode;
        storeGameMode(message.payload.currentMode);
      }

      if (message.type === 'game:modePanelStateChanged') {
        modePanelOpenRef.current = message.payload.isOpen;
        setIsModePanelOpen(message.payload.isOpen);
        // iframe перекрывает весь viewport, поэтому его HTML-оболочка рисует
        // видимые поля вокруг canvas. Передаём ей тот же флаг отдельно.
        sendModePanelBackground();
      }

      if (message.type === 'game:funCreditsRequested') {
        void requestFunCredits();
      }

      if (message.type === 'game:realBalanceRequested') {
        void refreshRealBalance();
      }

      if (message.type === 'game:tonConnectRequested') {
        void requestTonConnectAction();
      }

      if (message.type === 'game:tonDisconnectRequested') {
        setWalletActionPending('disconnect');
        window.dispatchEvent(new Event('crazy-cash:ton-disconnect-requested'));
      }

      if (message.type === 'game:tonTopUpRequested') {
        if (tonTopUpRequestInFlight.current) return;
        if (accountTypeRef.current !== 'telegram' || !tonConnectHandlerReadyRef.current) {
          sendToGame({ type: 'shell:tonOperationResult', payload: { action: 'top_up', success: false, message: 'WALLET VERIFICATION REQUIRED' } });
          return;
        }
        tonTopUpRequestInFlight.current = true;
        window.dispatchEvent(new CustomEvent('crazy-cash:ton-deposit-requested', {
          detail: { operationId: crypto.randomUUID(), amount: message.payload.amount },
        }));
      }

      if (message.type === 'game:tonWithdrawRequested') {
        void requestTonWithdrawal(message.payload.amount);
      }

		if (message.type === 'game:goHome') {
			window.location.assign('/');
		}
    };

    window.addEventListener('message', onMessage);

    const onTonDepositResult = (event: Event) => {
      tonTopUpRequestInFlight.current = false;
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (!detail || typeof detail !== 'object' || typeof detail.success !== 'boolean' || typeof detail.message !== 'string') return;
      const pending = (detail as { pending?: unknown }).pending === true;
      sendToGame({ type: 'shell:tonOperationResult', payload: { action: 'top_up', success: detail.success, message: detail.message, ...(pending ? { pending: true } : {}) } });
      // A terminal response must always restore the header from the authority,
      // including cancellation and expiry, where no balance is included.
      if (!pending) {
        void refreshRealBalance();
      }
    };
    window.addEventListener('crazy-cash:ton-deposit-result', onTonDepositResult);

    const onWalletState = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      const state = detail as Partial<TonWalletState>;
      if (typeof state.connected !== 'boolean' || typeof state.walletBalance !== 'string') return;
      clearWalletActionTimeout();
      walletStateRef.current = { connected: state.connected, walletBalance: state.walletBalance };
      if (gameReadyRef.current) sendWalletStateToGame();
    };
    window.addEventListener('crazy-cash:ton-wallet-state', onWalletState);

    const onPageShow = () => {
      requestGameHandshake();
      if (gameReadyRef.current) {
        sendModePanelBackground();
        sendWalletStateToGame();
        void loadAndSendSession();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onPageShow();
    };
    const onPageHide = () => cancelAllRequestsForPageHide();

    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('message', onMessage);

      window.removeEventListener('crazy-cash:ton-deposit-result', onTonDepositResult);

      window.removeEventListener('crazy-cash:ton-wallet-state', onWalletState);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearHandshakeTimers();
      cancelAllRequestsForPageHide();
    };
  }, []);

  if (!isGodotWebSupported) {
    return (
      <main className="game-compatibility" role="alert">
        <div className="game-compatibility__content">
          <img src="/Logo_eng.webp" alt="Crazy Cash" />
          <h1>GAME NOT SUPPORTED</h1>
          <p>Update Telegram or open Crazy Cash in a modern browser with WebGL 2 enabled.</p>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`game-page${isModePanelOpen ? ' game-page--mode-panel-open' : ''}${isTelegramContext ? ' game-page--telegram' : ''}`}
    >
      <section className="game-phone" aria-label="Crazy Cash game">
        <div className="game-phone__speaker" aria-hidden="true" />
        <div className="game-phone__screen">
          <iframe
            ref={frameRef}
            title="Godot Game"
            src={GODOT_ENTRY}
            className="game-frame"
            onLoad={() => {
              // A newly loaded iframe starts with its MODE panel closed. Resetting
              // this shell-only colour avoids keeping a stale grey gutter after an
              // iOS partial tab restoration.
              gameReadyRef.current = false;
              modePanelOpenRef.current = false;
              setIsModePanelOpen(false);
              requestGameHandshake();
            }}
          />
        </div>
      </section>
    </main>
  );
}
