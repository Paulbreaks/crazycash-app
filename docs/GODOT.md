# Godot

## Ownership

`apps/godot` owns visual state, animations, sounds and input. `apps/web` owns
the iframe, HTTP, cookies, TonConnect and navigation. The Godot project must
not call the API directly or decide a balance, session or financial result.

The Web export is served from `apps/web/public/godot`. The generated loader and
artifacts are build output; the maintained loading shell is
`apps/godot/web/crazy_cash_loader.html`.

The public repository keeps one reviewed Web export for an immediate demo.
After every Godot export, generate its precompressed runtime companions before
committing:

```sh
./scripts/compress-godot-web-build.sh
```

This produces `index.js.gz`, `index.pck.gz` and `index.wasm.gz`. The original
files remain because browsers request their original names; Nginx selects the
`.gz` variants for clients that support gzip.

## Bridge

Every message has `{ "type": "...", "payload": { ... } }`. The Shell accepts
only messages from its own game iframe and validates every Game payload before
acting. Godot ignores messages from other origins. `apps/web/src/bridge/messages.ts`
is the executable source of truth.

### Game → Shell

| Type | Payload |
| --- | --- |
| `game:ready` | `{ "engine": "godot" }` |
| `game:goHome`, `game:funCreditsRequested`, `game:realBalanceRequested`, `game:tonConnectRequested`, `game:tonDisconnectRequested` | `{}` |
| `game:modeRequested` | `{ "currentMode": "fun" \| "real" }` |
| `game:modePanelStateChanged` | `{ "isOpen": true }` |
| `game:betRequested` | `{ "currentBet": 10, "mode": "fun" \| "real" }` |
| `game:spinRequested` | `{ "gameRequestId": "spin-<n>", "mode": "fun", "bet": 10 }` or `{ "gameRequestId": "spin-<n>", "mode": "real", "bet": 10, "denomination": "0.01" \| "0.1" \| "1" \| "10" }` |
| `game:tonTopUpRequested`, `game:tonWithdrawRequested` | `{ "amount": "0.50" }` — decimal text, maximum two fraction digits. |

`gameRequestId` correlates one Godot animation with its Shell response. It is
not the API idempotency key; the Shell generates the durable UUID itself.

### Shell → Game

| Type | Payload |
| --- | --- |
| `shell:init` | `{ "appVersion": "0.1.0", "locale": "en-US", "theme": "light" \| "dark" }` |
| `shell:session` | `{ "authorized": true, "activeMode": "fun" \| "real", "realModeAvailable": true, "surface": "browser" \| "telegram", "balances": { "fun": "1000", "real": "0" } }` |
| `shell:balances` | `{ "balances": { "fun": "1000", "real": "0" } }` |
| `shell:modePanelBackground` | `{ "isOpen": true }` |
| `shell:profileAvatar` | `{ "contentType": "image/jpeg" \| "image/png" \| "image/webp" \| "image/svg+xml", "data": "base64" }` |
| `shell:walletState` | `{ "connected": true, "walletBalance": "1.44" }`; `---` means pending RPC read. |
| `shell:walletActionState` | `{ "action": "connect" \| "disconnect", "pending": true }` |
| `shell:tonConnectError` | `{ "message": "CONNECT ERROR. TRY AGAIN" }` |
| `shell:sessionExpired` | `{}` |
| `shell:spinResult` | `{ "requestId": "api-uuid", "gameRequestId": "spin-<n>", "combination": "777", "rule": "...", "multiplier": 200, "payout": "2000", "denomination": "0.01"?, "balance": { "mode": "fun" \| "real", "value": "1230" } }` |
| `shell:spinError` | `{ "requestId": "api-uuid", "gameRequestId": "spin-<n>", "code": "insufficient_fun_balance" \| "insufficient_real_balance" \| "idempotency_mismatch" \| "request_failed" }` |
| `shell:funCreditsResult` | `{ "credited": "1000", "balance": { "mode": "fun", "value": "1000" } }` |
| `shell:funCreditsError` | `{ "code": "fun_credit_balance_too_high" \| "request_failed", "balance": { "mode": "fun", "value": "..." }? }` |
| `shell:tonOperationResult` | `{ "action": "top_up" \| "withdraw", "success": true, "message": "...", "pending": true?, "balance": { "mode": "real", "value": "..." }? }` |

The Shell resends the authoritative state after `game:ready`, `pageshow`, and
return from background. Godot treats it as a full replacement, not a patch.

## UI rules

- `FUN` and `TON` mode are explicit shell state and must survive iframe reload.
- While a deposit or withdrawal is pending, the corresponding spinner is shown;
  a terminal result always restores its input box.
- While `DepositSpinner` is visible, the Header REAL balance shows the `---`
  loading animation. The actual balance may update internally but is displayed
  only after the spinner ends.
- Wallet-connect loading remains active until the Shell has supplied the
  confirmed wallet balance or a terminal failure.
- Status banners display server outcomes only. Do not infer success from a
  TonConnect return.

## Mobile input

The browser loader overlays a DOM input over Godot `LineEdit` for mobile
keyboards. It uses `type=number` and `inputmode=decimal`, normalizes comma to
dot before forwarding text, and performs no financial validation. iOS WebView
may resize the viewport when its keyboard opens; this is platform behaviour.
`experimental_virtual_keyboard` remains disabled.

## Export checks

Before release, verify in a current Web export: portrait/desktop scaling,
loader background, iframe recovery, FUN/TON mode restoration, input overlay,
deposit and withdrawal terminal banners, and audio after returning from a
wallet. Godot CLI is not installed in the repository environment, so editor or
CI export is the release authority.
