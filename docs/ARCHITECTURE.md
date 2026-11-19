# Architecture

## Components

| Component | Responsibility |
| --- | --- |
| `apps/godot` | Presentation, input, animations and game UI. Never calls the API. |
| `apps/web` | React Shell, routing, browser/Telegram entry, TonConnect and the validated Godot bridge. |
| `apps/api` | Fastify API: authentication, balances, idempotency, game settlement and TON operation creation. |
| MySQL | Source of truth for users, sessions, spins, wallet links, financial operations and ledger. |
| Workers | Guest cleanup, inbound deposit observation and outbound payout settlement for the selected TON network. |

## Runtime boundaries

The game is a Web export loaded in a React-controlled iframe. The Shell owns
HTTP, cookies, session recovery and TonConnect. Communication uses a narrow
`window.postMessage` bridge. Game messages are requests or UI events; all
financial decisions remain server-authoritative.

The API runs database mutations in transactions. Workers never trust the UI:
the deposit worker verifies recipient-chain evidence; the payout worker verifies
recipient-side completion before final settlement.

## Modes and identities

- A browser guest receives an HttpOnly session and FUN credits only.
- A Telegram Mini App user is authenticated from server-verified Telegram
  `initData` and receives a separate session.
- A wallet is linked only after an authenticated TonConnect proof. A wallet link
  is not required to spend an already credited REAL balance.
- `FUN` and `REAL` are separate balances, modes and spin records.

## Trust model

Treat the browser, Godot, URL parameters, wallet callbacks and all client-side
amount validation as untrusted. Verify authentication, wallet ownership,
idempotency, balance availability, denomination and chain settlement on the
server. Only server transactions may change balances.

## Version baseline

Node 26 Alpine, pnpm 10.33.2, Turborepo 2.11.10, React 19.3.1, Vite 8.3.5,
Tailwind 4.3.3, Fastify 5.12.7, Prisma 7.10.1 with the MySQL driver adapter,
MySQL 9.7, phpMyAdmin 5.2.3 and Godot 4.7.1.
