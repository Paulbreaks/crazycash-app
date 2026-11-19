# Configuration

Tracked templates: `.env.dev.example` and `.env.prod.example`. Runtime files
`.env.dev` and `.env.prod` are secrets and must never enter Git. `TON_*_MNEMONIC_FILE`
points to a root-owned `0600` file outside the repository.

## Shared and web

| Variables | Consumer | Notes |
| --- | --- | --- |
| `TZ` | Compose services | Container display timezone; persisted timestamps remain UTC. |
| `WEB_PORT` | development Compose | Host port for the Web Shell. Development only. |
| `API_PORT` | development Compose | Host port for API. Development only. |
| `API_ORIGIN` | API CORS | Exact public origin, e.g. `https://YOUR_PUBLIC_URL`. |
| `VITE_API_BASE_URL` | Web build | Public API base URL: `https://YOUR_PUBLIC_URL/api`. |
| `VITE_TG_BOT_NAME` | Web build | Telegram bot username for the entry UI. |
| `VITE_TON_MANIFEST_URL` | Web build | Public HTTPS TonConnect manifest URL. |
| `VITE_ENABLE_TONCONNECT` | Web build | `1` enables TonConnect UI. |
| `DEV_API_RESPONSE_DELAY_MS` | API | Local test delay only; keep `0` outside deliberate UX testing. |

## MySQL and phpMyAdmin

| Variables | Consumer | Notes |
| --- | --- | --- |
| `MYSQL_ROOT_PASSWORD` | MySQL, phpMyAdmin login | Root database password. |
| `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | MySQL and API | Application database and account. |
| `MYSQL_PORT` | development Compose | Host port only; container DNS always uses `mysql:3306`. |
| `DATABASE_URL` | API / Prisma | Uses Compose DNS (`mysql`) in containers; local host address only for host tools. |
| `PMA_PORT`, `PMA_UPLOAD_LIMIT` | optional phpMyAdmin profile | Localhost-only port and upload limit. The profile is absent from the default production stack. |

## Telegram and sessions

| Variables | Consumer | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_USERNAME` | API, Web | Bot username without `@`. |
| `TELEGRAM_BOT_TOKEN` | API | Server-only Telegram initData verification secret. |
| `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` | API | Maximum accepted initData age. |
| `GUEST_FUN_START_BALANCE` | API | Initial FUN credits for a guest. |
| `GUEST_ACCOUNT_TTL_HOURS` | cleanup worker | Inactive guest retention. |
| `SESSION_TTL_HOURS` | API | Cookie session lifetime. |

## TON RPC and proof

| Variables | Consumer | Notes |
| --- | --- | --- |
| `TON_NETWORK` | API and workers | `testnet` or `mainnet`; selected network only. |
| `TON_RPC_TESTNET_URL`, `TON_RPC_MAINNET_URL` | API and workers | HTTPS JSON-RPC endpoints. |
| `TONCENTER_TESTNET_API_KEY`, `TONCENTER_MAINNET_API_KEY` | API and workers | Sent only to Toncenter hostnames. |
| `TON_PROOF_DOMAIN` | API proof verification | Exact domain shown in TonConnect proof. |
| `TON_PROOF_CHALLENGE_TTL_SECONDS` | API | One-time challenge lifetime. |
| `TON_PROOF_MAX_AGE_SECONDS` | API | Maximum accepted wallet proof age. |

## TON mnemonic paths

| Variable | Consumer | Notes |
| --- | --- | --- |
| `TON_SECRETS_DIR` | production payout-worker volume | Absolute host directory outside Git, mode `0700`; mounted read-only at `/run/secrets`. |
| `TON_TESTNET_DEPOSIT_MNEMONIC_FILE`, `TON_TESTNET_WITHDRAW_MNEMONIC_FILE`, `TON_MAINNET_WITHDRAW_MNEMONIC_FILE` | container tools/workers | Absolute container paths below `/run/secrets`, with mnemonic files mode `0600`. |

## Deposits

| Variables | Consumer | Notes |
| --- | --- | --- |
| `TON_DEPOSIT_RECIPIENT_TESTNET`, `TON_DEPOSIT_RECIPIENT_MAINNET` | API, deposit watcher | Recipient address for the selected network. |
| `TON_DEPOSIT_TTL_SECONDS` | API, deposit watcher | Invoice validity period. |
| `TON_DEPOSIT_MAX_UNITS` | API | Maximum canonical units (`1000 = 1 TON`); minimum supported value is `100` (`0.1 TON`). |
| `TON_DEPOSIT_FINALITY_SECONDS` | deposit watcher | Delay after observation before credit. |
| `TON_DEPOSIT_WATCHER_INTERVAL_SECONDS` | deposit watcher | Poll interval. |
| `TON_DEPOSIT_ENABLE_MAINNET` | API | Mainnet deposit opt-in; `0` disables it. |
| `TON_TESTNET_DEPOSIT_MNEMONIC_FILE` | operational scripts only | Testnet recipient key file; never required by deposit watcher. |

## Withdrawals

| Variables | Consumer | Notes |
| --- | --- | --- |
| `TON_WITHDRAW_SENDER_TESTNET`, `TON_WITHDRAW_SENDER_MAINNET` | payout worker | Expected sender address. |
| `TON_WITHDRAW_MIN_UNITS`, `TON_WITHDRAW_MAX_UNITS` | API | Per-request canonical-unit limits. |
| `TON_WITHDRAW_FINALITY_SECONDS` | payout worker | Recipient-observation finality delay. |
| `TON_WITHDRAW_WATCHER_INTERVAL_SECONDS` | payout worker | Poll interval. |
| `TON_WITHDRAW_ENABLE_TESTNET`, `TON_WITHDRAW_ENABLE_MAINNET` | payout worker/API | Explicit network enable flags. |
| `TON_TESTNET_WITHDRAW_MNEMONIC_FILE`, `TON_MAINNET_WITHDRAW_MNEMONIC_FILE` | payout worker | Protected container path to the sender mnemonic for the selected network. |

## Change procedure

1. Change the appropriate untracked env file.
2. Validate the resolved Compose configuration locally with the same env file.
3. Copy production configuration through the approved secure channel.
4. Recreate only consumers of the changed keys; never recreate MySQL volumes
   merely to apply configuration.
