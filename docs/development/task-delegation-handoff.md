# Task delegation team handoff

## 1. Conclusions

Implementation is paused for team takeover. Branch `feat/task-delegation` contains the unfinished Tasks module, Core/shared Yarn patches, tests and backlog. It is not merge-ready. No deployment or paid agent execution is included.

## 2. Evidence

Before pause, typecheck and 19 Tasks Jest suites (65 tests) passed. The schema verifier passed on disposable PostgreSQL. The installed package verifier checked 24 source/runtime files and compiled transaction ordering and was repeated before publication. The candidate matched the saved implementation patch before publication-only documentation updates.

The isolated integration attempt failed during build on test mock typings before Playwright ran. Typings were corrected and typecheck passed, but build/integration were not repeated. Final whole-candidate primary/security review is outstanding. These records do not establish end-to-end acceptance.

## 3. Files

- [Team backlog](../plans/2026-09-19-team-implementation-backlog.md): SF-01 through SF-21, ownership, dependencies and acceptance.
- [Tasks specification](../specs/SPEC-002-2026-09-18-tasks-module.md): authoritative behavior and phase status.
- [Verification](task-delegation-verification.md): commands and coverage limits.
- [Staff prerequisite](staff-transaction-patches.md): paired source/runtime patches and provenance.
- `src/modules/tasks/`: commands, API, widgets, subscribers, entities and tests.
- `src/modules/tasks/migrations/Migration20260919101406_tasks.ts`: current initial migration; do not restore the superseded migration.

## 4. Commands

Portable pickup in a fresh clone:

```sh
git fetch origin
git switch --track origin/feat/task-delegation
corepack yarn install --immutable --mode=skip-build
node scripts/verify-staff-transaction-patches.mjs
corepack yarn generate
corepack yarn typecheck
corepack yarn jest src/modules/tasks --runInBand --watchman=false
```

Use the repository-supported Node version and complete any required native dependency setup. Configure your own local environment; no credentials are bundled. The app consumes the Staff fix through committed Yarn patches, so no unpublished Core commit is required to install it. For integration, follow the isolated runner instructions in the verification document. Do not migrate a shared or existing developer database to validate this checkpoint.

## 5. Risks

Mocked tests do not prove real transaction rollback/replay. Orchestrator persistence/enqueue and workflow creation/linkage have recovery gaps. Cancellation before workflow creation and trusted ProcessInstance.id propagation need framework contracts. Repeated setup must preserve explicit operator disables. Full factory and DEMO seeds are absent.

## 6. Blockers

SF-02 through SF-04 require a framework-owner contract decision beyond the previously approved Staff correction. Final build, authenticated API/UI acceptance, real workflow execution and full review remain open. Publication of this checkpoint does not authorize deployment or paid inference.

## 7. Next step

Assign SF-01 to the integration lead, then SF-05 and SF-06 in parallel while the framework owner resolves SF-02 through SF-04. Serialize setup, migration and lockfile edits.

## 8. Suggested skills

Use `handoff`, repository implementation skills, `tdd`, isolated integration-test tooling and `verification-before-completion`. Follow the closest AGENTS.md and use primary/security review for final acceptance.
