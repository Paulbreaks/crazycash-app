# Crazy Cash

Crazy Cash is an educational browser-first video slot: Godot 4 renders the
game, a React Shell owns browser/Telegram integration, and a Fastify API with
MySQL authoritatively settles balances and spins. FUN play is available to
browser guests; TON wallet, deposits and withdrawals use the single network
selected by server configuration. Payouts require an explicit enable flag for
that network.

## Repository

| Path | Purpose |
| --- | --- |
| `apps/godot` | Godot 4 game project and Web export source. |
| `apps/web` | React/Vite/Tailwind Shell, landing page and Godot bridge. |
| `apps/api` | Fastify API, Prisma schema, sessions, game settlement and workers. |
| `packages/shared` | Reserved workspace for shared contracts. |
| `docker` | Local and production Compose configuration. |
| `docs` | Technical contracts and operational runbooks. |

## Quick start

```sh
cp .env.dev.example .env.dev
pnpm install
pnpm docker:dev:up
```

Fill required `CHANGE_ME` values in `.env.dev` first. Open the URL configured
by `WEB_PORT`. Full local/production setup and testnet/mainnet rules are in
[Quick start](docs/QUICKSTART.md).

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
```

## License

The source code and documentation are available under the [MIT License](LICENSE).
Original graphics, audio, PSD/WAV source archives and the portions of
the Web export containing those assets are available under
[CC BY-NC 4.0](LICENSE-ASSETS.md). Fonts and other third-party materials retain
their own terms. The [Crazy Cash name and logo](TRADEMARKS.md) are not licensed
for branding derivative projects.

Copyright © 2026 Gramania.com. Author: Pavel AL —
[Telegram](https://t.me/jetnc).

## Documentation

| Document | Scope |
| --- | --- |
| [Quick start](docs/QUICKSTART.md) | Local and production startup, export and verification. |
| [Configuration](docs/CONFIGURATION.md) | `.env` variables, consumers and change procedure. |
| [Architecture](docs/ARCHITECTURE.md) | Components, modes, trust boundaries and versions. |
| [API](docs/API.md) | HTTP requests, responses, errors and idempotency. |
| [Database](docs/DATABASE.md) | Schema rules, money, ledger and lifecycle states. |
| [Godot](docs/GODOT.md) | Godot ownership, Shell bridge, mobile input and export. |
| [TON integration](docs/TON.md) | Networks, TonConnect proof and wallet state. |
| [Payments](docs/PAYMENTS.md) | Deposits, withdrawals, workers and settlement. |
| [Security](docs/SECURITY.md) | Trust boundaries, secrets, invariants and current limits. |
| [Operations](docs/OPERATIONS.md) | Production topology, deployment, diagnosis and runbooks. |
