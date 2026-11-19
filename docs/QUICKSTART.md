# Quick start

## Requirements

- Node.js 26 and pnpm 10.33.2 for host commands.
- Docker Desktop with Compose.
- Godot 4.7.1 only when editing or exporting the game.

## Local stack

```sh
cp .env.dev.example .env.dev
pnpm install
pnpm docker:dev:up
```

Create `.env.dev` only from `.env.dev.example`, and `.env.prod` only from
`.env.prod.example`. Replace every required `CHANGE_ME` value before starting;
never commit either runtime file. See the complete variable reference in
[Configuration](CONFIGURATION.md).

Open the URLs configured by `WEB_PORT`, `API_PORT`, and `PMA_PORT` in `.env.dev`:

- `/` — landing page;
- `/game` — React Shell and Godot game;
- `/dev` — game-math diagnostics;
- `API_URL/health` — API health;
- phpMyAdmin — temporary database administration.

Stop the local stack with `pnpm docker:dev:down`.

## Network profiles

Development uses `TON_NETWORK=testnet`. Configure testnet RPC credentials,
testnet recipient and testnet wallet files in `.env.dev`; use only test TON.

Production is started only with `.env.prod` and uses the production Compose
file:

```sh
pnpm docker:prod:up
```

Production may remain on testnet during staging. To use mainnet, explicitly set
`TON_NETWORK=mainnet`, configure mainnet RPC and recipient/sender values, and
set the relevant `TON_DEPOSIT_ENABLE_MAINNET` and
`TON_WITHDRAW_ENABLE_MAINNET` flags. Configure the corresponding mnemonic path
inside `/run/secrets` and its host `TON_SECRETS_DIR` before enabling payouts.
Review [TON](TON.md) and [Operations](OPERATIONS.md) before any production
configuration change.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
```

## Godot export

Open `apps/godot` in Godot 4.7.1 and export the `Web` preset to
`apps/web/public/godot`. Generated Web files are build output; do not edit
them. Then run `./scripts/compress-godot-web-build.sh` to refresh the gzip
variants included with the repository's one reviewed demo build. Maintain the
custom loader in `apps/godot/web/crazy_cash_loader.html`.

## Production configuration

Keep `.env.prod` and TON mnemonic files outside Git. Start the production
profile manually with `pnpm docker:prod:up`; see
[Operations](OPERATIONS.md) for the required secret-file layout and health
checks.
