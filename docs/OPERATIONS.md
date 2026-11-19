# Operations

## Production topology template

Choose the host directory yourself. Keep `.env.prod` and TON mnemonic files
outside Git. An outer reverse proxy terminates TLS and forwards the one public
origin to the Web service. The Web gateway then routes:

| Public path | Target |
| --- | --- |
| `YOUR_PUBLIC_URL` | Web Shell and game |
| `YOUR_PUBLIC_URL/api` | Fastify API |
| `YOUR_PUBLIC_URL/game` | React Shell and Godot game |

Docker Compose runs MySQL, Web, API, guest cleanup, deposit watcher and payout
worker. phpMyAdmin is optional and excluded from the default production stack.
It binds only to `127.0.0.1`; the template does not include CI/CD, a host
configuration or any automatic deployment mechanism.

The payout worker starts with the stack but sleeps for an hour when the selected
network's withdrawal flag is disabled. Before enabling it, configure
`TON_SECRETS_DIR`, the mnemonic path for the selected network, its sender and
RPC credentials. With `TON_NETWORK=testnet`, set
`TON_WITHDRAW_ENABLE_TESTNET=1`; with `TON_NETWORK=mainnet`, set
`TON_WITHDRAW_ENABLE_MAINNET=1`.

## Manual production update

Build and export the Godot Web project before the first production start or
after changing game resources. Copy the resulting files to
`apps/web/public/godot` in the working copy. Then validate and start the stack:

```sh
pnpm typecheck
pnpm test
pnpm build
docker compose --env-file .env.prod -f docker/compose.prod.yml config --quiet
docker compose --env-file .env.prod -f docker/compose.prod.yml up -d --build
```

Database migrations are not automatically reversible. Make a verified backup
before applying an update that changes the schema.

### Optional phpMyAdmin

It is never routed through the public web gateway. Start it only for a short
administrative session, then reach its localhost port through an authenticated
SSH tunnel:

```sh
docker compose --env-file .env.prod -f docker/compose.prod.yml --profile pma up -d phpmyadmin
docker compose --env-file .env.prod -f docker/compose.prod.yml stop phpmyadmin
```

## Health and diagnosis

```sh
docker compose --env-file .env.prod -f docker/compose.prod.yml ps
docker compose --env-file .env.prod -f docker/compose.prod.yml logs --tail=200 api
curl -fsS https://YOUR_PUBLIC_URL/api/health
```

Workers log recoverable RPC failures and continue their cycle. Docker currently
does not detect a worker that loops with persistent errors: add heartbeat
healthchecks and log rotation before sustained load.

## Runbooks

### API returns 502 or health fails

1. Inspect `docker compose ... ps` and the last 200 API logs.
2. Verify MySQL is healthy and the API `DATABASE_URL` matches the application
   account in `.env.prod`.
3. Recreate only `api`; do not remove volumes or reset MySQL during diagnosis.
4. Confirm `https://YOUR_PUBLIC_URL/api/health` and the Nginx upstream after the
   restart.

### Deposit remains `pending` or `observed`

1. Read `ton-deposit-watcher` logs and confirm its container is running.
2. Verify selected `TON_NETWORK`, recipient address, RPC URL/key, invoice TTL
   and watcher interval in `.env.prod`.
3. Inspect the deposit record and matching recipient-chain transaction: exact
   sender, amount, `CC:D:<uuid>` memo and chain timestamp must match.
4. `observed` normally resolves after `TON_DEPOSIT_FINALITY_SECONDS`. Do not
   manually credit a balance or repeat a payment with the same invoice.

### Withdrawal remains `held`, `requested` or `sent`

1. Inspect `ton-withdrawal-worker` logs and the sender configured for the
   selected `TON_NETWORK`.
2. Confirm the protected mnemonic file exists, is mode `0600`, matches the
   configured address, and the sender retains fees plus the configured reserve.
3. `held` has not been claimed; `requested`/`sent` may already have broadcast.
   Never manually release or resend the latter before recipient-chain
   reconciliation proves the outcome.
4. Review recipient history for the `CC:W:<uuid>` memo. Only a confirmed
   `finalized`, `failed`, or `cancelled` terminal result may end the request.

### Manual update failed

1. Inspect Compose output and the API logs before starting another update.
2. Verify `.env.prod`, the configured mnemonic-file paths, Compose resolution,
   migration output and API health in that order.
3. Restore a known source revision only after assessing the schema state:
   database migrations are not rolled back automatically.

### Backup and restore

No backup system currently exists. Before relying on stored balances, implement
an encrypted off-host `mysqldump` schedule, retention, and a documented restore
test into an isolated MySQL instance. A restore procedure is incomplete until
that test has succeeded.

## Security and data operations

- Keep `.env.prod`, SSH keys, mnemonics, RPC keys and database passwords outside
  Git.
- Set Fastify trusted proxy configuration whenever the Nginx proxy topology
  changes; do not trust arbitrary `X-Forwarded-For` headers.
- UFW and fail2ban protect SSH. Keep the Nginx TLS certificate renewed.
- phpMyAdmin is development-only. Do not add a public database administration
  route without an authenticated private access design.
- No automated MySQL backup or restore drill is configured. Add encrypted
  off-host backups and test restore before treating the environment as durable.
- Remove obsolete Nginx enabled-site backup files; they can create duplicate
  `server_name` warnings.

## Configuration changes

After changing `.env.prod`, recreate only services that consume the changed
variables, for example:

```sh
docker compose --env-file .env.prod -f docker/compose.prod.yml up -d --force-recreate api ton-deposit-watcher
```

Do not recreate MySQL volumes unless intentionally discarding all data.
