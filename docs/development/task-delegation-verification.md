# Task delegation verification

The task module extends the Staff board and runs on the published Open Mercato 0.8.0 packages. The application candidate is in progress; a passing helper or API test does not establish complete workflow delivery.

Run from this repository with its pinned Yarn:

```sh
corepack yarn generate
corepack yarn typecheck
corepack yarn lint
corepack yarn ds:check
corepack yarn test src/modules/task_delegation --runInBand --watchman=false
```

`--watchman=false` uses Jest's own file traversal. It also avoids dependence on the host's optional Watchman installation.

The migration verifier uses PostgreSQL and the actual generated migration. Supply `TASK_DELEGATION_TEST_DATABASE_URL` pointing to a disposable loopback database named `staff_transaction_test`, then run:

```sh
corepack yarn tsx scripts/verify-task-delegation-schema.mjs
```

The verifier refuses other database names and remote hosts. It creates a randomly named schema inside one transaction and rolls it back even after assertion failure. It checks active-delegation uniqueness, released history, receipt replay uniqueness, and organization/execution separation. This is schema evidence, not command-composition evidence.

The application authentication smoke test uses the repository's isolated runner:

```sh
corepack yarn test:integration:ephemeral TC-TASK-DELEGATION-001 --no-reuse-env
```

`TC-TASK-DELEGATION-002` covers the same unauthenticated posture for the assignment endpoints
(`POST /api/task_delegation/assignments`, `GET /api/task_delegation/assignable-people`).
`TC-TASK-DELEGATION-003` opens a task drawer in a browser and asserts that the "Assigned to"
picker is the only assignment control — `staff`'s own assignee field is hidden and unfocusable. It
needs one staff task to open and skips with that reason on an empty database; seed the demo board
with `corepack yarn mercato task_delegation seed-demo` first. The runner starts a production
server, so `JWT_SECRET` must be a real value (`openssl rand -hex 32`) rather than the placeholder
shipped in `.env.example`; with the placeholder the server refuses to boot and the run fails
before any test.

The runner owns the disposable database, initialization, application build, port, and cleanup. Do not run plain `test:integration` with only `BASE_URL`; database fixtures require the complete runner-provided environment. This smoke test exercises unauthenticated requests to all four tasks endpoint methods. Authenticated delegation, Staff transitions, workflow activities, real undo and browser interaction still require their own acceptance tests.

## Agent rename (SPEC-008)

`rename-agent` writes `auth.User.name` through `auth.users.update` under a system actor. Unit tests mock the command bus, so they cannot show that the write lands or that the scope predicate excludes another tenant. This procedure does, against a disposable database. It needs a running PostgreSQL with `vector` and `pgcrypto` — the repository's `docker compose` Postgres is enough; do not point it at a developer database.

```sh
docker exec <pg> psql -U postgres -c 'CREATE DATABASE rename_probe'
docker exec <pg> psql -U postgres -d rename_probe \
  -c 'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;'
# Point DATABASE_URL at rename_probe on that loopback server, then:
corepack yarn mercato db migrate
corepack yarn mercato auth setup --orgName 'Probe Org' --email admin@probe.test --password '<strong>'
corepack yarn mercato auth add-org --name 'Probe Org B'   # implicitly a second tenant
```

Build the fixture the way a real pre-SPEC-008 database got there: temporarily set `FACTORY_AGENT_DISPLAY_NAME` in `src/modules/task_delegation/lib/agentIdentity.ts` to `'Factory'`, run `task_delegation seed-demo` for **both** scopes, then restore the constant. Re-seeding cannot be substituted — provisioning writes the name only when it creates the user, which is the whole reason this command exists.

Then, with the constant restored:

| Command | Expected |
|---|---|
| `rename-agent --tenant A --org A` | `renamed Factory → Software Engineer (user …)` |
| `rename-agent --tenant A --org A` again | `nothing to do, already Software Engineer (user …)`, same user id |
| `rename-agent --tenant A --org B` | `nothing to do, no agent principal in this organization` |

The third row is the one that matters. `resolveAgentPrincipal` matches on `organizationId` alone, and `auth.users.update` under `systemActor` resolves no tenant scope of its own (`updateWhere` is `{ id, deletedAt: null }`), so the scope predicate in `renameFactoryAgent` is the only thing keeping a mistyped `--tenant` off another tenant's row. Drop `...scope` from that filter and the same command renames tenant B's agent — verified, and covered by the failing-without-the-fix case in `lib/__tests__/renameAgent.test.ts`.

Finish by confirming `agent_principals` still holds one row per organization with unchanged `user_id`, and one `user_roles` link each. Drop `rename_probe` afterwards.

No developer database migration, paid inference, provider deployment, push or publication is part of these checks. A missing `factory.deliver` process definition is an explicit unavailable state; do not create a production stub to make delegation appear functional.
