# TON integration

This document covers wallet identity, TonConnect and network selection. Deposit
and withdrawal settlement is specified in [Payments](PAYMENTS.md).

## Network selection

`TON_NETWORK` selects exactly one configured RPC network: `testnet` or
`mainnet`. It does not by itself authorize transfers. Network-specific RPC,
recipient, sender and enable flags must agree; see [Configuration](CONFIGURATION.md).

| Capability | Testnet | Mainnet |
| --- | --- | --- |
| Telegram authentication and wallet proof | Available when selected | Supported when selected |
| External wallet balance | Available through configured RPC | Available through configured RPC |
| Deposit invoice | Available | Explicit opt-in through `TON_DEPOSIT_ENABLE_MAINNET=1` |
| Deposit settlement worker | Available | Runs only after explicit deposit enablement |
| Withdrawal hold | Requires `TON_WITHDRAW_ENABLE_TESTNET=1` | Requires `TON_WITHDRAW_ENABLE_MAINNET=1` |
| On-chain payout worker | Wallet V5R1, selected when enabled | Wallet V5R1, selected when enabled |

The production environment may run testnet during staging. The single payout
worker serves only `TON_NETWORK`; it selects matching RPC credentials, sender,
mnemonic and Wallet V5R1 global ID. Changing networks never carries active
withdrawals across them.

## TonConnect proof

The Shell requests a one-time challenge from `POST /ton-proof/payload` and gives
it to TonConnect. It sends the returned proof unchanged to
`POST /ton-proof/verify`.

The API verifies:

- active authenticated Telegram session;
- challenge ownership, one-time use and expiry;
- expected `TON_PROOF_DOMAIN` and selected chain ID;
- StateInit-derived address and public key;
- proof signature and proof timestamp;
- exact reviewed wallet code hash for Wallet V4 or Wallet V5R1.

On success the API stores the verified raw wallet address against the Telegram
user and network. A link is an authorization for wallet-facing operations; it
does not directly alter a Crazy Cash balance.

## Wallet state

`GET /me/wallet` returns the verified wallet capability for the current
Telegram user. `GET /me/wallet/balance` reads only that stored wallet through
the selected server RPC; it never accepts an address from the browser and never
changes REAL balance. The Shell sends the display amount to Godot through
`shell:walletState`.

`POST /me/wallet/disconnect` marks the network-specific link disconnected. It
does not revoke Telegram authentication and does not remove an existing REAL
balance. A new connect flow is required before wallet-facing operations resume.

## Security boundaries

- Godot receives no proof, key, mnemonic or raw Telegram CDN URL.
- The browser never receives operational wallet keys or server RPC credentials.
- Wallet public address, connection status and display balance are UI data only;
  API checks authorization and balances again for every financial command.
- Do not use a TonConnect return, wallet UI state or client-supplied address as
  evidence of a payment. See [Payments](PAYMENTS.md).

## Known limits

TON proof, invoice matching and worker flows lack RPC/MySQL integration tests.
Add fixture-based tests before enabling a production mainnet payout workload.
