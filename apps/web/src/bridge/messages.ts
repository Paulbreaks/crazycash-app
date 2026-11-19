export interface ShellInitMessage {
  type: 'shell:init';
  payload: {
    appVersion: string;
    locale: string;
    theme: 'light' | 'dark';
  };
}

/** Только браузерная раскладка: фон полей внутри HTML-оболочки Godot. */
export interface ShellModePanelBackgroundMessage {
  type: 'shell:modePanelBackground';
  payload: {
    isOpen: boolean;
  };
}

/** Серверное состояние, которое Shell передаёт игре после GET /me/session. */
export interface ShellSessionMessage {
  type: 'shell:session';
  payload: {
    authorized: boolean;
    activeMode: 'fun' | 'real';
    /** Server-derived capability; Godot treats it as UI state only. */
    realModeAvailable: boolean;
    /** UI context only; API remains authoritative for every REAL operation. */
    surface: 'browser' | 'telegram';
    balances: {
      fun: string;
      real: string;
    };
  };
}

/**
 * Bounded avatar bytes fetched from the authenticated same-origin API.
 * The external Telegram CDN URL is never passed to Godot.
 */
export interface ShellProfileAvatarMessage {
  type: 'shell:profileAvatar';
  payload: {
    contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/svg+xml';
    data: string;
  };
}

/** Non-secret TonConnect state for Godot controls. No key, proof or raw address. */
export interface ShellWalletStateMessage {
  type: 'shell:walletState';
  payload: {
    connected: boolean;
    /** Display string only. `---` means the balance has not been read yet. */
    walletBalance: string;
  };
}

/** Shell accepted a wallet action and Godot may show a temporary loader. */
export interface ShellWalletActionStateMessage {
  type: 'shell:walletActionState';
  payload: {
    action: 'connect' | 'disconnect';
    pending: boolean;
  };
}

/** Result of a TON-panel action. The real API phase will use this same shape. */
export interface ShellTonOperationResultMessage {
  type: 'shell:tonOperationResult';
  payload: {
    action: 'top_up' | 'withdraw';
    success: boolean;
    message: string;
    /** Pending means a chain-facing operation has not reached terminal settlement yet. */
    pending?: boolean;
    /** Fresh server balance after a terminal ledger command, if available. */
    balance?: { mode: 'real'; value: string };
  };
}

/** Любой 401 при загрузке игры: Godot показывает модалку нового гостевого старта. */
export interface ShellSessionExpiredMessage {
  type: 'shell:sessionExpired';
  payload: Record<string, never>;
}

/** Актуальные балансы, повторно прочитанные Shell из БД для TON-панели. */
export interface ShellBalancesMessage {
  type: 'shell:balances';
  payload: {
    balances: {
      fun: string;
      real: string;
    };
  };
}

/** Результат, выбранный сервером после POST /crazy-cash/spins. */
export interface ShellSpinResultMessage {
  type: 'shell:spinResult';
  payload: {
    requestId: string;
    /** Локальная корреляция UI-запроса Godot; не является API idempotency key. */
    gameRequestId: string;
    combination: string;
    /** Правило выплаты, выбранное сервером: например, 0XX или 777. */
    rule: string;
    multiplier: number;
    payout: string;
  /** Есть только у REAL-спина; bet и payout уже выражены в кредитах этой шкалы. */
  denomination?: '0.01' | '0.1' | '1' | '10';
    balance: {
      mode: 'fun' | 'real';
      value: string;
    };
  };
}

/** Ошибка команды PLAY, которую игра должна показать без изменения баланса. */
export interface ShellSpinErrorMessage {
  type: 'shell:spinError';
  payload: {
    requestId: string;
    gameRequestId: string;
    code: 'insufficient_fun_balance' | 'insufficient_real_balance' | 'idempotency_mismatch' | 'request_failed';
  };
}

/** Сервер подтвердил выдачу временных FUN-кредитов. */
export interface ShellFunCreditsResultMessage {
  type: 'shell:funCreditsResult';
  payload: {
    credited: string;
    balance: {
      mode: 'fun';
      value: string;
    };
  };
}

/** Сервер отклонил выдачу FUN-кредитов или оказался недоступен. */
export interface ShellFunCreditsErrorMessage {
  type: 'shell:funCreditsError';
  payload: {
    code: 'fun_credit_balance_too_high' | 'request_failed';
    // A semantic rejection still carries server truth. This prevents the FUN
    // panel from retaining a stale pre-request balance after a 409 response.
    balance?: {
      mode: 'fun';
      value: string;
    };
  };
}

/** TonConnect could not open or issue its server-bound proof challenge. */
export interface ShellTonConnectErrorMessage {
  type: 'shell:tonConnectError';
  payload: {
    // User-facing, intentionally non-sensitive explanation.
    message: string;
  };
}

export interface GameReadyMessage {
  type: 'game:ready';
  payload: {
    engine: 'godot';
  };
}

export interface GameScoreMessage {
  type: 'game:score';
  payload: {
    value: number;
  };
}

/** Игрок нажал BET; Shell пока только логирует событие. */
export interface GameBetRequestedMessage {
  type: 'game:betRequested';
  payload: {
    currentBet: number;
    mode: 'fun' | 'real';
  };
}

/** Игрок нажал PLAY. Позднее Shell вызовет API и вернёт результат в Godot. */
export type GameSpinRequestedMessage = {
  type: 'game:spinRequested';
  payload: ({
    bet: number;
    mode: 'fun';
  } | {
    bet: number;
    mode: 'real';
    denomination: '0.01' | '0.1' | '1' | '10';
  }) & {
    /** Идентификатор только для сопоставления UI-запроса с ответом Shell. */
    gameRequestId: string;
  };
};

/** Игрок нажал MODE; выбор режима будет добавлен следующим этапом. */
export interface GameModeRequestedMessage {
  type: 'game:modeRequested';
  payload: {
    currentMode: 'fun' | 'real';
  };
}

/** MODE-панель открыта или окончательно закрыта в Godot. */
export interface GameModePanelStateChangedMessage {
  type: 'game:modePanelStateChanged';
  payload: {
    isOpen: boolean;
  };
}

/** Игрок нажал кнопку пополнения FUN в панели MODE. */
export interface GameFunCreditsRequestedMessage {
  type: 'game:funCreditsRequested';
  payload: Record<string, never>;
}

/** Панель TON открыта: Shell должен обновить real_balance из БД. */
export interface GameRealBalanceRequestedMessage {
  type: 'game:realBalanceRequested';
  payload: Record<string, never>;
}

/** Godot просит Shell начать доступный в текущем окружении TON connect flow. */
export interface GameTonConnectRequestedMessage {
  type: 'game:tonConnectRequested';
  payload: Record<string, never>;
}

export interface GameTonDisconnectRequestedMessage {
  type: 'game:tonDisconnectRequested';
  payload: Record<string, never>;
}

/** Exact decimal text from Godot; Shell/API parse it again as bigint. */
export interface GameTonTopUpRequestedMessage {
  type: 'game:tonTopUpRequested';
  payload: { amount: string };
}

export interface GameTonWithdrawRequestedMessage {
  type: 'game:tonWithdrawRequested';
  payload: { amount: string };
}

/** Godot просит Shell вернуться на entry page для создания нового гостя. */
export interface GameGoHomeMessage {
  type: 'game:goHome';
  payload: Record<string, never>;
}

export type ShellToGameMessage =
  | ShellInitMessage
  | ShellModePanelBackgroundMessage
  | ShellSessionMessage
  | ShellProfileAvatarMessage
  | ShellSessionExpiredMessage
  | ShellWalletStateMessage
  | ShellWalletActionStateMessage
  | ShellTonOperationResultMessage
  | ShellBalancesMessage
  | ShellSpinResultMessage
  | ShellSpinErrorMessage
  | ShellFunCreditsResultMessage
  | ShellFunCreditsErrorMessage
  | ShellTonConnectErrorMessage;
export type GameToShellMessage =
  | GameReadyMessage
  | GameScoreMessage
  | GameBetRequestedMessage
  | GameSpinRequestedMessage
  | GameModeRequestedMessage
  | GameModePanelStateChangedMessage
  | GameFunCreditsRequestedMessage
  | GameRealBalanceRequestedMessage
  | GameTonConnectRequestedMessage
  | GameTonDisconnectRequestedMessage
  | GameTonTopUpRequestedMessage
  | GameTonWithdrawRequestedMessage
  | GameGoHomeMessage;

export function isGameToShellMessage(value: unknown): value is GameToShellMessage {
  if (!isRecord(value) || !isRecord(value.payload)) return false;

  switch (value.type) {
    case 'game:ready':
      return value.payload.engine === 'godot';
    case 'game:score':
      return typeof value.payload.value === 'number';
    case 'game:betRequested':
      return typeof value.payload.currentBet === 'number' && isGameMode(value.payload.mode);
    case 'game:spinRequested':
      return isGameRequestId(value.payload.gameRequestId)
        && typeof value.payload.bet === 'number'
        && (value.payload.mode === 'fun'
          || (value.payload.mode === 'real' && isRealDenomination(value.payload.denomination)));
    case 'game:modeRequested':
      return isGameMode(value.payload.currentMode);
    case 'game:modePanelStateChanged':
      return typeof value.payload.isOpen === 'boolean';
    case 'game:funCreditsRequested':
    case 'game:realBalanceRequested':
    case 'game:tonConnectRequested':
    case 'game:tonDisconnectRequested':
    case 'game:goHome':
      return Object.keys(value.payload).length === 0;
    case 'game:tonTopUpRequested':
    case 'game:tonWithdrawRequested':
      return typeof value.payload.amount === 'string' && isTonDecimal(value.payload.amount);
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isGameMode(value: unknown): value is 'fun' | 'real' {
  return value === 'fun' || value === 'real';
}

function isRealDenomination(value: unknown): value is '0.01' | '0.1' | '1' | '10' {
  return value === '0.01' || value === '0.1' || value === '1' || value === '10';
}

function isGameRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^spin-\d+$/.test(value);
}

function isTonDecimal(value: string): boolean {
  return /^\d+(?:\.\d{1,2})?$/.test(value) && value.length <= 12;
}
