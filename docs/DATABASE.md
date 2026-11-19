# Database

Prisma schema: `apps/api/prisma/schema.prisma`. The single baseline migration
`20261117000000_initial_schema` is the schema source for a fresh database.

## Rules

- IDs are UUIDs unless a table explicitly uses a numeric Telegram identifier.
- Timestamps are UTC. Convert only at the UI/report boundary.
- FUN is an integer credit balance.
- REAL amounts are `BIGINT` canonical units: `1 TON = 1000` units and
  `0.01 TON = 10` units. Never use floating point for persistence or settlement.
- API services validate every REAL amount is positive and divisible by `10`.
  The current MySQL baseline does not duplicate this invariant as a `CHECK`;
  manual SQL changes must preserve it.

## Core data

| Area | Tables / purpose |
| --- | --- |
| Identity | `users`, `sessions`, Telegram account data, wallet links and proof challenges. |
| Gameplay | `fun_spins`, `real_spins`; each has a per-user request idempotency key. |
| Financial operations | `client_operations`, `deposits`, `withdrawals`. |
| Ledger | `ledger_entries` is the append-only audit trail for REAL balance movement. |
| Analytics | aggregated player statistics survive guest deletion. |

## Ledger

Allowed operating semantics:

- `deposit_credit` — confirmed inbound TON credited;
- `spin_bet` — REAL stake debited;
- `spin_payout` — REAL win credited;
- `withdrawal_hold` — amount reserved for a withdrawal;
- `withdrawal_release` — a failed or cancelled withdrawal returned the reserve.

Do not create a second `withdrawal_debit` after a hold: the hold already removes
the amount from the available balance. A successful payout changes the request
status to `finalized` after chain confirmation.

## Transactions and idempotency

Financial endpoints require a client operation UUID. `client_operations` makes
retries return the original result rather than create a second balance change.
Spin settlement locks the user row, checks the balance, writes the spin and its
ledger entries, and commits the final balance atomically.

## Guest lifecycle

The cleanup worker runs hourly. It removes a guest, sessions and FUN spins after
24 hours since the last FUN spin; a guest that never spun expires 24 hours after
creation. Aggregated analytics remain. Telegram users and REAL records are not
removed by this job.

## Lifecycle states

| Record | States | Terminal states |
| --- | --- | --- |
| `client_operations` | `processing`, `completed`, `rejected`, `failed` | `completed`, `rejected`, `failed` |
| `deposits` | `pending` → `observed` → `credited`; `pending` → `expired` | `credited`, `expired`, `rejected` |
| `withdrawals` | `held` → `requested` → `sent` → `finalized`; `requested` → `failed`; `held`/`requested` may be `cancelled` | `finalized`, `failed`, `cancelled` |
| `sessions` | active, revoked, expired | revoked, expired |

`observed` has a valid matching inbound chain transaction but is still inside
the configured finality period. `sent` means an outbound payout was attempted
or confirmed by destination history; it must not be blindly retried. A failed
pre-broadcast withdrawal creates `withdrawal_release`; a finalized one does not
create another debit.

## Known limits

No database-backed concurrency suite currently exercises financial settlement.
`fun_balance` non-negativity and REAL denomination are enforced in application
transactions, so direct phpMyAdmin edits can violate product invariants.
