import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().default(3000),
  API_ORIGIN: z.string().default('http://localhost:5173'),
  // Только для локальной проверки состояний загрузки в интерфейсе. Значение
  // применяется исключительно при NODE_ENV=development.
  DEV_API_RESPONSE_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(0),
  DATABASE_URL: z.string().min(1),
  // Публичное имя бота, но серверное значение: игра не определяет маршрут
  // Telegram самостоятельно. Пустое значение означает unavailable.
  TELEGRAM_BOT_USERNAME: z.string().trim().regex(/^[A-Za-z0-9_]{5,32}$/).or(z.literal('')).default(''),
  // Секрет API Telegram. Он нужен только серверу для T2: проверки подписи
  // Telegram initData; в DTO, логи и фронтенд он никогда не передаётся.
  TELEGRAM_BOT_TOKEN: z.string().trim().min(1).or(z.literal('')).default(''),
  // Telegram initData — одноразовый входной пакет, а не долгоживущий ключ.
  // После успешного входа действует обычная серверная cookie-сессия.
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
  // TON proof is deliberately testnet-first. The expected dApp domain and
  // chain are server settings; neither may be supplied by Godot or React.
  TON_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  // RPC endpoints and credentials are server-only. The selected endpoint is
  // determined exclusively by TON_NETWORK; a browser can never switch chains
  // or provide an address/provider URL to the API.
  TON_RPC_TESTNET_URL: z.string().url(),
  TON_RPC_MAINNET_URL: z.string().url(),
  TONCENTER_TESTNET_API_KEY: z.string().trim().default(''),
  TONCENTER_MAINNET_API_KEY: z.string().trim().default(''),
  // Empty means API_ORIGIN hostname (localhost locally, YOUR_PUBLIC_URL in prod).
  // An explicit value is available only for a deliberate separate dApp domain.
  TON_PROOF_DOMAIN: z.string().trim().regex(/^[A-Za-z0-9.-]{1,128}$/).or(z.literal('')).default(''),
  TON_PROOF_CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  TON_PROOF_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  // A transfer receiver is an operational configuration value. Empty or
  // CHANGE_ME deliberately leaves deposits unavailable instead of routing
  // funds to an accidental address.
  TON_DEPOSIT_RECIPIENT_TESTNET: z.string().trim().max(128).default(''),
  TON_DEPOSIT_RECIPIENT_MAINNET: z.string().trim().max(128).default(''),
  TON_DEPOSIT_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(1_800),
  // Values are Crazy Cash canonical units: 10 = 0.01 TON, 1,000 = 1 TON.
  TON_DEPOSIT_MAX_UNITS: z.coerce.number().int().min(100).max(10_000_000).default(10_000),
  // Testnet deposits are observed in two independent watcher passes. Three
  // seconds is the lowest supported delay between those passes.
  TON_DEPOSIT_FINALITY_SECONDS: z.coerce.number().int().min(3).max(3_600).default(15),
  TON_DEPOSIT_WATCHER_INTERVAL_SECONDS: z.coerce.number().int().min(3).max(300).default(5),
  // Mainnet is intentionally opt-in even if TON_NETWORK gets changed. It is
  // not a substitute for the mainnet readiness review.
  TON_DEPOSIT_ENABLE_MAINNET: z.enum(['0', '1']).default('0'),
  // Withdrawal sending is deliberately a later worker responsibility. These
  // limits are still parsed here because the API uses them before it can place
  // an irreversible hold on a player's available REAL balance.
  TON_WITHDRAW_MIN_UNITS: z.coerce.number().int().min(100).max(10_000_000).default(100),
  TON_WITHDRAW_MAX_UNITS: z.coerce.number().int().min(100).max(10_000_000).default(10_000),
  // Payout sending requires an explicit switch for the selected network. A
  // hold can never become an accidental broadcast after deployment.
  TON_WITHDRAW_ENABLE_TESTNET: z.enum(['0', '1']).default('0'),
  TON_WITHDRAW_ENABLE_MAINNET: z.enum(['0', '1']).default('0'),
  TON_WITHDRAW_SENDER_TESTNET: z.string().trim().max(128).default(''),
  TON_WITHDRAW_SENDER_MAINNET: z.string().trim().max(128).default(''),
  TON_WITHDRAW_FINALITY_SECONDS: z.coerce.number().int().min(3).max(3_600).default(15),
  TON_WITHDRAW_WATCHER_INTERVAL_SECONDS: z.coerce.number().int().min(3).max(300).default(5),
  // Only the payout-worker container mounts this file. API and web never do.
  TON_TESTNET_WITHDRAW_MNEMONIC_FILE: z.string().trim().max(512).default(''),
  TON_MAINNET_WITHDRAW_MNEMONIC_FILE: z.string().trim().max(512).default(''),
  GUEST_FUN_START_BALANCE: z.coerce.number().int().positive().default(1_000),
  GUEST_ACCOUNT_TTL_HOURS: z.coerce.number().int().positive().max(24 * 31).default(24),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(24 * 31).default(24),
});

const parsedEnv = EnvSchema.parse(process.env);

if (parsedEnv.TON_WITHDRAW_MIN_UNITS > parsedEnv.TON_WITHDRAW_MAX_UNITS) {
  throw new Error('TON_WITHDRAW_MIN_UNITS must not exceed TON_WITHDRAW_MAX_UNITS');
}

export const env = {
  ...parsedEnv,
  TON_PROOF_DOMAIN: parsedEnv.TON_PROOF_DOMAIN || new URL(parsedEnv.API_ORIGIN).hostname,
};
