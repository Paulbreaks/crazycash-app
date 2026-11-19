# Security

This is the project security baseline. Detailed API, wallet and operational
contracts remain in [API](API.md), [TON](TON.md), [Payments](PAYMENTS.md) and
[Operations](OPERATIONS.md).

## Trust boundaries

| Boundary | Rule |
| --- | --- |
| Browser, Godot and URL parameters | Untrusted presentation/input only. They never settle balances or select a payout. |
| Godot ↔ Shell | Typed `postMessage`; validate iframe source/origin and payload before every action. |
| Shell ↔ API | HttpOnly session cookie; API independently authenticates and authorizes every command. |
| Telegram | Accept only raw signed `initData`; verify its HMAC, age and user server-side. |
| TonConnect and wallet callbacks | Proof and return are not payment evidence. Verify server challenge and chain data. |
| TON RPC | Untrusted external data until matched against the server-owned invoice/withdrawal invariants. |
| MySQL and workers | Trusted settlement boundary; mutations use database transactions and durable records. |

## Secrets and privileged access

- Never commit `.env.dev`, `.env.prod`, mnemonic files, RPC keys, Telegram bot
  token, MySQL credentials or SSH private keys.
- Operational wallet mnemonics live outside the repository in a host directory
  with mode `0700`. The payout worker mounts it read-only at
  `/run/secrets/`; individual mnemonic files use mode `0600`.
- Do not print secrets, TonConnect proofs, cookies or full operational
  configuration in logs, documentation, screenshots or error messages.
- Production SSH access must use a restricted account and a pinned host key.

## Identity and sessions

- Session tokens are opaque, stored as hashes server-side and issued in
  `HttpOnly`, `SameSite=Lax` cookies; production cookies are `Secure`.
- Expired/revoked cookies must produce `401`; the Shell must not invent a
  session or reuse a stale balance.
- Telegram authentication validates raw `initData` before storing profile data
  or rotating a session. `initDataUnsafe` is never trusted.
- A linked wallet is network-specific and only proves control of that address;
  it does not grant another user's access or alter balances.

## Financial invariants

- Persist REAL TON values as `BIGINT` canonical units, never floating point.
- API validates denomination, limits and available balance inside the same
  transaction that writes the outcome.
- Every state-changing browser command has an idempotency key. A lost response
  is recovered by that key, never retried as a new financial action.
- `ledger_entries` is append-only. Withdrawal uses `hold → release`; finalized
  payout does not create a duplicate debit.
- API or worker is the only authority that changes balance. Godot and Shell
  display server-provided results only.

## TON settlement

- TonConnect proof challenge is random, single-use, session-bound and expires.
- Proof validation checks domain, chain, StateInit-derived address/public key,
  signature, timestamp and reviewed Wallet V4/V5R1 code hash.
- Deposit credit requires exact recipient, verified sender, amount, invoice memo,
  valid chain timestamp, non-aborted transaction and finality.
- Payout finalization requires recipient-side evidence: exact sender,
  destination, amount, withdrawal memo and finality. Ambiguous broadcasts are
  reconciled, never blindly retried.
- Mnemonics and operational RPC credentials never enter Godot, the Web bundle
  or client-visible API DTOs.

## Operations

- Terminate public traffic with TLS; constrain firewall and SSH access.
- Keep Fastify trusted-proxy configuration aligned with Nginx topology. Never
  trust arbitrary forwarded client-address headers.
- phpMyAdmin is an optional localhost-only profile. Do not expose database
  administration through the public production gateway.
- Maintain encrypted off-host MySQL backups and regularly test restoration.
- Pin dependencies, apply security updates deliberately, and run typecheck,
  tests and build before every manual production update.

## Current limitations

- No automated off-host backup/restore drill exists.
- Workers lack heartbeat healthchecks and bounded Docker log rotation.
- TON proof, invoice matching and worker flows lack RPC/MySQL integration tests.
- Payout reconciliation reads only recent recipient history and has no
  checkpoint; add pagination/checkpoints before increasing payout volume.
- Mainnet payout requires its own explicit enable flag and lacks RPC/MySQL
  integration coverage; do not enable it in production before that coverage
  and an operational review exist.
