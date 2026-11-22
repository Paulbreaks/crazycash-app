# API

Base URL: `https://YOUR_PUBLIC_URL/api`. The browser sends the HttpOnly session
cookie automatically; Godot never calls this API directly. All JSON requests
and responses use UTF-8. Numeric balances and TON amounts are strings.

An error has the form:

```json
{ "ok": false, "error": "machine_readable_code" }
```

`401 unauthorized` means the Shell must begin an entry flow. A network timeout
is inconclusive: retrieve the operation/spin with its original idempotency key
instead of issuing a new command.

## Session and player

### `POST /auth/guest`

Body: `{}`. Creates or renews a guest cookie.

```json
{
  "authorized": true,
  "activeMode": "fun",
  "realModeAvailable": false,
  "user": { "uuid": "...", "username": "guest-...", "accountType": "guest" },
  "balances": { "fun": "1000", "real": "0" },
  "expiresAt": "2026-11-17T00:00:00.000Z"
}
```

### `POST /auth/telegram`

```json
{ "initData": "raw Telegram.WebApp.initData" }
```

The API verifies the Telegram signature and creates a Telegram session. The
response is the same session shape as above, with `accountType: "telegram"`
and `realModeAvailable: true`.

### Current player

| Endpoint | Response |
| --- | --- |
| `GET /me/session` | Authoritative session object: `authorized`, `activeMode`, `realModeAvailable`, `user`, `balances`. |
| `GET /me/balances` | `{ "balances": { "fun": "1000", "real": "0" } }` |
| `GET /me/avatar` | Telegram avatar bytes, or `204` when unavailable. |
| `POST /auth/logout` | Revokes the current cookie; `204`. |
| `GET /auth/connect-action?surface=browser\|telegram` | `{ "action": "open_telegram", "url": "..." }`, `{ "action": "open_ton_connect" }`, or `{ "action": "unavailable" }`. |

## Game

### `POST /crazy-cash/spins`

FUN request:

```json
{ "mode": "fun", "bet": "10", "requestId": "client-request-id" }
```

REAL request:

```json
{ "mode": "real", "bet": "10", "denomination": "0.01", "requestId": "client-request-id" }
```

`bet` is an allowed whole-credit value. `denomination` is one of
`/crazy-cash/config` `realDenominations`. Reuse the same `requestId` after a
lost response only.

```json
{
  "uuid": "spin-uuid",
  "digits": [7, 7, 7],
  "rule": "...",
  "multiplier": 200,
  "bet": "10",
  "payout": "2000",
  "denomination": "0.01",
  "balance": { "mode": "real", "value": "1230" },
  "createdAt": "2026-11-17T00:00:00.000Z",
  "replayed": false
}
```

`denomination` is absent for FUN. Common errors: `insufficient_fun_balance`,
`insufficient_real_balance`, `guest_fun_only`, `idempotency_mismatch`.

| Endpoint | Purpose |
| --- | --- |
| `GET /crazy-cash/spins/by-request?mode=fun\|real&requestId=...` | Recover a lost spin response. |
| `GET /crazy-cash/spins?mode=fun\|real&limit=1..100&cursor=uuid` | Player spin history. |
| `GET /crazy-cash/spins/:uuid?mode=fun\|real` | One player spin. |
| `GET /crazy-cash/config` | Modes, allowed bets, REAL denominations and RTP rules. |
| `GET /crazy-cash/theory`, `GET /crazy-cash/simulate?spins=N` | Read-only diagnostics. |

The current game weights target a theoretical RTP of `98.600%`. Exact
three-of-a-kind combinations use descending probabilities: lower multipliers
are more frequent than higher multipliers. The `/config` and `/theory`
responses are the authoritative published values.

### `POST /crazy-cash/fun-credits`

```json
{ "operationId": "uuid" }
```

Successful response:

```json
{
  "operationId": "uuid",
  "type": "fun_credit_claim",
  "status": "completed",
  "credited": "1000",
  "balance": { "mode": "fun", "value": "1000" }
}
```

Recover a lost response with
`GET /crazy-cash/operations/:operationId?type=fun_credit_claim`.

## TonConnect wallet

### Proof

`POST /ton-proof/payload` has no body and returns:

```json
{ "payload": "64-hex-character challenge", "expiresAt": "ISO-8601", "network": "testnet" }
```

Pass `payload` to TonConnect. Send the returned proof unchanged to
`POST /ton-proof/verify`:

```json
{
  "address": "wallet address",
  "network": "-3",
  "public_key": "optional 64-char hex",
  "proof": {
    "timestamp": "unix seconds",
    "domain": { "lengthBytes": 15, "value": "YOUR_PUBLIC_URL" },
    "payload": "server challenge",
    "signature": "base64 signature",
    "state_init": "base64 BoC"
  }
}
```

Verified wallet shape:

```json
{ "wallet": { "verified": true, "network": "testnet", "address": "...", "verifiedAt": "ISO-8601" } }
```

`GET /me/wallet` returns the same `wallet` object or `null`.
`GET /me/wallet/balance` returns `wallet: null` or:

```json
{
  "wallet": {
    "wallet": { "verified": true, "network": "testnet", "address": "...", "verifiedAt": "ISO-8601" },
    "balanceNanotons": "1440000000",
    "displayBalance": "1.44"
  }
}
```

`POST /me/wallet/disconnect` returns `204`. It does not alter Crazy Cash REAL
balance.

## Deposits

### `POST /deposits`

```json
{ "operationId": "uuid", "amount": "0.50" }
```

The amount is a positive decimal TON string with at most two fraction digits.
The API returns a durable invoice, not a payment confirmation:

```json
{
  "operationId": "uuid",
  "type": "ton_deposit",
  "status": "processing",
  "deposit": {
    "uuid": "deposit-uuid",
    "status": "pending",
    "amount": "0.50",
    "amountNanotons": "500000000",
    "destination": "recipient address",
    "payload": "base64 TON text-comment cell",
    "expiresAt": "ISO-8601"
  }
}
```

Pass `destination`, `amountNanotons` and `payload` to TonConnect. Poll only
`GET /deposits/:operationId` for the operation saved in `sessionStorage`.
`GET /deposits/pending` returns the caller's latest non-terminal operation for
recovery. Terminal response adds `balance: { "mode": "real", "value": "..." }`;
possible deposit statuses are `pending`, `observed`, `credited`, `expired` and
`rejected`.

## Withdrawals

### `POST /withdrawals`

```json
{ "operationId": "uuid", "amount": "0.50" }
```

The destination is the server-verified linked wallet; the request never accepts
an address. A successful command places a durable hold:

```json
{
  "operationId": "uuid",
  "type": "ton_withdrawal",
  "status": "completed",
  "withdrawal": { "uuid": "...", "status": "held", "amount": "0.50", "createdAt": "ISO-8601" },
  "balance": { "mode": "real", "value": "730" }
}
```

Poll `GET /withdrawals/:operationId` after a lost response or while showing
progress. Withdrawal status progresses through `held`, `requested`, `sent`,
`finalized`, `failed` or `cancelled`. Common errors are
`wallet_not_verified`, `insufficient_real_balance`, `invalid_withdrawal_amount`
and `withdrawals_unavailable`.

## Health

`GET /health` returns `{ "ok": true, "service": "api" }`.

## Contract maintenance

Public request validation is implemented in Fastify route schemas and the
Shell-facing DTOs. The bridge's executable schema is
`apps/web/src/bridge/messages.ts`; API request validation lives beside each
route in `apps/api/src/modules/*/routes.ts`. Update this document and the
corresponding unit tests whenever either changes. The repository does not yet
publish OpenAPI; do not claim an OpenAPI contract exists until it is generated
from the route schemas in CI.
