#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
docker compose --env-file .env.dev -f docker/compose.dev.yml down
