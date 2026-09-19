#!/usr/bin/env bash
# Conductor run hook — start the dev server on this worktree's own port.
# Install at scripts/conductor-run.sh.
#
# The per-worktree database (clone + .env rewrite), shared infra, migrations, and
# the seed are all provisioned once by scripts/conductor-setup.sh. Here we only re-apply
# migrations (cheap no-op when up to date — catches migrations pulled onto the branch since
# setup ran) and then start dev on $CONDUCTOR_PORT.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
APP_DIR="."

( cd "$APP_DIR" && yarn db:migrate )

port="${CONDUCTOR_PORT:-3000}"
cd "$APP_DIR"
# APP_URL builds absolute links (task board links, factory PRs); .env's value assumes port 3000.
exec env OM_DEV_SPLASH_PORT=off PORT="$port" APP_URL="http://localhost:$port" yarn dev
