# Task delegation verification

The task module extends the Staff board. Its local verification requires the Core/shared transaction patches described in [staff-transaction-patches.md](./staff-transaction-patches.md). The application candidate is in progress; a passing helper or API test does not establish complete workflow delivery.

Run from this repository with its pinned Yarn:

```sh
node scripts/verify-staff-transaction-patches.mjs
corepack yarn generate
corepack yarn typecheck
corepack yarn lint
corepack yarn ds:check
corepack yarn test src/modules/tasks --runInBand --watchman=false
```

`--watchman=false` uses Jest's own file traversal. It also avoids dependence on the host's optional Watchman installation.

The migration verifier uses PostgreSQL and the actual generated migration. Supply `TASKS_TEST_DATABASE_URL` pointing to a disposable loopback database named `staff_transaction_test`, then run:

```sh
corepack yarn tsx scripts/verify-task-delegation-schema.mjs
```

The verifier refuses other database names and remote hosts. It creates a randomly named schema inside one transaction and rolls it back even after assertion failure. It checks active-delegation uniqueness, released history, receipt replay uniqueness, and organization/execution separation. This is schema evidence, not command-composition evidence.

The application authentication smoke test uses the repository's isolated runner:

```sh
corepack yarn test:integration:ephemeral TC-TASKS-001 --no-reuse-env
```

The runner owns the disposable database, initialization, application build, port, and cleanup. Do not run plain `test:integration` with only `BASE_URL`; database fixtures require the complete runner-provided environment. This smoke test exercises unauthenticated requests to all four tasks endpoint methods. Authenticated delegation, Staff transitions, workflow activities, real undo and browser interaction still require their own acceptance tests.

No developer database migration, paid inference, provider deployment, push or publication is part of these checks. A missing `factory.deliver` process definition is an explicit unavailable state; do not create a production stub to make delegation appear functional.
