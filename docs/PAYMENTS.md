# Payments

This document specifies the server-authoritative TON deposit and withdrawal
flows. TonConnect proof, network selection and wallet display are in
[TON](TON.md). HTTP payloads are in [API](API.md), accounting rules in
[Database](DATABASE.md), and environment keys in [Configuration](CONFIGURATION.md).

## Common rules

- The browser submits a UUID `operationId` for every deposit or withdrawal.
  Repeating it returns the durable original result; changing its amount returns
  `idempotency_mismatch`.
- Decimal input is converted to canonical integer units on the API. `1 TON` is
  `1000` units; accepted values are multiples of `10` units (`0.01 TON`).
  Deposits and withdrawals must each be at least `100` units (`0.1 TON`).
- A TonConnect callback, a sender-side acknowledgement, browser timeout, or
  return to the Mini App is not payment confirmation.
- Only API database transactions and workers may mutate REAL balance.

## Deposit

1. The Shell calls `POST /deposits` with `{ operationId, amount }`.
2. The API requires a verified Telegram wallet, creates a short-lived `pending`
   invoice and returns recipient, exact nanotons and `CC:D:<uuid>` payload.
3. TonConnect asks the wallet to transfer. The API does not credit the player.
4. The deposit watcher reads recent recipient transactions while at least one
   invoice is active. It matches the chain message and records `observed`.
5. After configured finality, one MySQL transaction creates `deposit_credit`,
   increments REAL balance and marks the invoice and operation `credited` /
   `completed`.
6. The Shell polls only the operation UUID stored in its `sessionStorage`.
   Terminal result clears it and restores Godot input UI.

### Deposit states

| State | Owner | Meaning |
| --- | --- | --- |
| `pending` | API | Invoice exists; matching payment not observed. |
| `observed` | deposit watcher | Matching chain transaction found; finality pending. |
| `credited` | deposit watcher | Ledger and REAL balance committed. |
| `expired` | deposit watcher | No acceptable payment before invoice TTL. |
| `rejected` | reserved terminal state | Invoice cannot be settled. |

### Deposit evidence

The watcher requires a non-aborted internal message to the configured recipient;
its source must equal the verified wallet, amount must equal invoice amount,
text-comment must be `CC:D:<deposit-uuid>`, and chain timestamp must be inside
invoice TTL. The stored transaction hash/logical time must then survive
`TON_DEPOSIT_FINALITY_SECONDS` before credit.

## Withdrawal

1. The Shell calls `POST /withdrawals` with `{ operationId, amount }`.
2. The API uses only the server-verified active wallet as destination. In one
   transaction it locks the player, creates `withdrawal_hold`, subtracts the
   available REAL balance and creates a `held` withdrawal.
3. The restricted payout worker claims `held` as `requested`, validates its
   protected sender wallet and fee reserve, then sends a `CC:W:<uuid>` transfer.
4. The worker records `sent` and reads destination history. After recipient-side
   evidence and finality it marks the withdrawal `finalized`.
5. A failure proven before broadcast marks the request `failed`, restores the
   reserve through `withdrawal_release`, and updates the available balance.

### Withdrawal states

| State | Owner | Meaning |
| --- | --- | --- |
| `held` | API | Funds reserved; no worker claim yet. |
| `requested` | payout worker | Worker owns the hold; broadcast may begin. |
| `sent` | payout worker | Send attempted or recipient transaction observed. |
| `finalized` | payout worker | Recipient evidence survived finality. |
| `failed` | payout worker | Proven safe pre-broadcast failure; reserve released. |
| `cancelled` | controlled operation | Terminal cancellation; reserve must be reconciled. |

### Withdrawal evidence and retry safety

Recipient history must contain a non-aborted internal message from the
configured payout sender to the verified destination, with exact amount and
`CC:W:<withdrawal-uuid>` comment. It must survive
`TON_WITHDRAW_FINALITY_SECONDS` before finalization.

`requested` and `sent` are deliberately non-retryable without reconciliation:
a crash after broadcast acceptance is ambiguous, and a blind retry could pay
twice. The worker keeps such requests for later recipient-side reconciliation.

## Operations and recovery

`client_operations` records command completion separately from the domain
record. A lost `POST` response is recovered with `GET /deposits/:operationId`
or `GET /withdrawals/:operationId`, never by submitting a new UUID.

The deposit UI intentionally restores only its own `sessionStorage` operation;
it does not show a spinner for an unrelated pending invoice. The withdrawal
worker continues after Mini App closure, but the UI does not yet persist a
withdrawal operation ID for automatic recovery after recreation.

## Worker limits and operations

- The deposit watcher makes recipient-history requests per cycle, not one RPC
  request per invoice.
- Payout reconciliation currently reads at most 20 recent transactions per
  destination and has no checkpoint. High payout volume can hide an older
  transaction until pagination/checkpoints are introduced.
- The single payout worker serves only the configured `TON_NETWORK`. It selects
  the matching RPC, sender, mnemonic and Wallet V5R1 global ID, and runs only
  when that network's explicit withdrawal flag is enabled.
- See [Operations](OPERATIONS.md) for diagnosis of `pending`, `observed`,
  `held`, `requested`, and `sent` states.
