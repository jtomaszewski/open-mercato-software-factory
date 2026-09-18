#!/usr/bin/env bash
# Conductor setup hook — one-time per-worktree provisioning (runs at workspace creation).
# Install at scripts/conductor-setup.sh. Replace om-software-factory with the compose project name.
#
# The app lives at the repo root (consumes published @open-mercato/*).
#   - bring up the SHARED local infra stack (Postgres/Redis/Meilisearch) once, keyed by the
#     compose project name so every worktree reuses the same containers + volumes.
#   - install deps + generate module artifacts.
#   - maintain a project-level TEMPLATE database (migrated + seeded once). Each worktree gets
#     its OWN database CLONED from that template (`CREATE DATABASE <worktree> TEMPLATE <tmpl>`),
#     so it starts already migrated + seeded — NO per-worktree `yarn initialize` reseed.
#   - derive the per-worktree DB name from the worktree folder (e.g. `feature-x` -> `feature_x`)
#     and rewrite THIS worktree's own .env DATABASE_URL to it. `.worktreeinclude`
#     copies .env per worktree (not a symlink), so the rewrite stays local.
#   - `yarn db:migrate` on the worktree afterwards is a cheap no-op that catches any migrations
#     pulled onto the branch since the template was last refreshed.
#
# The dev server itself is started by scripts/conductor-run.sh.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"
APP_DIR="."
ENV_FILE="$APP_DIR/.env"
COMPOSE_PROJECT="om-software-factory"
# Project-level template DB: migrated + seeded once, then cloned per worktree. Named after the
# compose project (worktree DBs derive from their folder, so they never collide with it).
TEMPLATE_DB="$(printf '%s' "$COMPOSE_PROJECT" | tr '[:upper:]-' '[:lower:]_')"

corepack enable >/dev/null 2>&1 || true

# .env is normally copied per-worktree by .worktreeinclude; fall back to the example.
if [ ! -f "$ENV_FILE" ]; then
  echo "[conductor] $ENV_FILE missing — seeding from .env.example"
  cp "$APP_DIR/.env.example" "$ENV_FILE"
fi

# Shared infra: one stack per machine, reused across worktrees (data persists in named volumes).
if docker info >/dev/null 2>&1; then
  docker compose -p "$COMPOSE_PROJECT" --project-directory "$ROOT/$APP_DIR" up -d --no-recreate
else
  echo "[conductor] Docker not running — start it, then re-run setup." >&2
  exit 1
fi

( cd "$APP_DIR" && yarn install && yarn generate )

# Derive the per-worktree DB name from the WORKTREE ROOT folder. Fail fast if the env file has
# no DATABASE_URL — silently skipping would leave this worktree on the shared default DB.
worktree_db="$(node --input-type=module -e '
import fs from "node:fs"
import { deriveDatabaseNameFromCwd, readEnvDatabaseUrl, validateDatabaseName } from "./scripts/dev-database-url.mjs"
const envFile = ".env"
if (!readEnvDatabaseUrl(fs.readFileSync(envFile, "utf8"))) {
  console.error(`[conductor] DATABASE_URL missing from ${envFile} — cannot isolate this worktree database.`)
  process.exit(1)
}
const name = deriveDatabaseNameFromCwd(process.cwd())
const check = validateDatabaseName(name)
if (!check.ok) {
  console.error(`[conductor] derived database name "${name}" is invalid: ${check.reason}`)
  process.exit(1)
}
process.stdout.write(name)
')"

echo "[conductor] worktree database: $worktree_db  (template: $TEMPLATE_DB)"

# Point .env DATABASE_URL at a given database name (in place).
set_env_db() {
  node --input-type=module -e '
import fs from "node:fs"
import { updateDatabaseUrlInEnvText } from "./scripts/dev-database-url.mjs"
const [name] = process.argv.slice(1)
const f = ".env"
const { text, changed } = updateDatabaseUrlInEnvText(fs.readFileSync(f, "utf8"), name)
if (changed) fs.writeFileSync(f, text)
' "$1"
}

# Maintenance-level DB ops (create/clone/drop/exists/user-count) that migrate/initialize can't.
db_admin() { ( cd "$APP_DIR" && node scripts/conductor-db.mjs "$@" ); }

# Wait for Postgres to accept connections before any DB work.
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "${COMPOSE_PROJECT}-postgres-1" 2>/dev/null)" = "healthy" ] && break
  sleep 2
done

# 1. Ensure the project template DB exists, is migrated, and is seeded. Migrate always (cheap
#    no-op when current) so clones inherit the latest schema; initialize only when unseeded.
if [ "$(db_admin exists "$TEMPLATE_DB")" != "yes" ]; then
  echo "[conductor] creating template database $TEMPLATE_DB"
  db_admin create "$TEMPLATE_DB"
fi
set_env_db "$TEMPLATE_DB"
( cd "$APP_DIR" && yarn db:migrate )
if [ "$(db_admin user-count "$TEMPLATE_DB")" = "0" ]; then
  echo "[conductor] seeding template (superadmin@acme.com / secret) via yarn initialize"
  ( cd "$APP_DIR" && yarn initialize )
else
  echo "[conductor] template already seeded — skipping initialize"
fi

# 2. Clone the worktree DB from the template if it doesn't exist yet (instant, pre-seeded).
if [ "$(db_admin exists "$worktree_db")" != "yes" ]; then
  echo "[conductor] cloning $worktree_db from template $TEMPLATE_DB"
  db_admin clone "$TEMPLATE_DB" "$worktree_db"
fi

# 3. Point this worktree's env at its own DB and catch up any newer branch migrations.
set_env_db "$worktree_db"
( cd "$APP_DIR" && yarn db:migrate )

echo "[conductor] setup complete — press Run to start the dev server"
