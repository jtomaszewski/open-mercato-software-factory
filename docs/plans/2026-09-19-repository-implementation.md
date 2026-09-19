# Repository implementation: first delivery increment

Status: approved on 2026-09-19; Phase 1 implemented and verified locally.

## Goal and approved decision

Offer Software Engineer on the task board, retaining `FACTORY_AGENT_ID = 'factory'`, the same principal/user/roles, existing delegations and `factory.deliver`. The user explicitly selected this variant from PR #24 after the original Developer/new-ID plan was found to conflict with it. No principal retirement or new `developer` identity is required.

Source doc: .ai/specs/2026-09-19-code-repositories.md

## Scope

Phase 1, REQ-006 / AC-006 / TEST-010: fresh setup provisions the new display name; existing installations use the standard admin user form to change the legacy default Factory name. The user explicitly selected this on 2026-09-19; no new CLI or Core extension is part of this increment. Already renamed or custom names stay unchanged. CLI output and relevant SPEC-001/002 prose follow the display name. Assignment-picker work from SPEC-009 and container execution from PR #23 stay with their existing owners.

Registry/connect/qualification, project links, frozen repository delegation and live-target integration remain later phases. No live seed, provider setup, paid inference, existing-database migration or deployment. Prototype PR #22 stays separate; its browser verification remains not-run.

## Execution and verification

1. Update the covering spec with the approved identity choice and actual task_delegation contracts.
2. Test the seed display-name change before implementation. Verify the existing admin API/form update, stale-version conflict and re-running setup without replacing an existing/custom name.
3. Run focused tests, generate, typecheck, lint, DS check, full unit tests and build. Use `--watchman=false` because the host Watchman binary references a missing libfmt.11.dylib.
4. Exercise TEST-010 against a verified disposable test database only; run primary and security review. Do not mark Phase 1 verified until all required evidence passes.

## Progress

- [x] Implementation branch `codex/repository-implementation` based on freshly fetched `origin/main` at `ad3e000`.
- [x] Locked dependencies installed locally with Corepack Yarn; running-app dependencies unchanged.
- [x] Baseline: four suites, 13 tests passed.
- [x] Seed test RED: expected Software Engineer, observed Factory. GREEN after implementation.
- [x] Validation, isolated integration, primary/security review and local admin-form evidence.
- [ ] Later phases remain pending.

## Recovery

No live data has been renamed. Revert the source changes to undo fresh-seed behavior. An operator update through the existing auth form is owned and audited by auth.users.update. Source rollback alone does not revert a stored display name.

## Existing-install migration finding

The first CLI candidate was removed after security review found that `auth.users.update` ignores the supplied expected-version header when called directly through CommandBus. A concurrent custom rename or scope movement could be overwritten. Installed Core 0.8.0 provides no conditional-write/after-commit seam that safely repairs this by wrapping the command in an outer transaction. The user selected the existing management UI as the explicit migration step on 2026-09-19, without a Core extension. The rename helper and its mocked tests are not retained as shippable code. The earlier nine-test result described that rejected candidate; the retained candidate was subsequently revalidated as recorded below.

## Latest retained-candidate checks

Runner: local (Corepack Yarn); integration uses the CLI-owned disposable database and the boot-once local application.

- `corepack yarn generate`: exit 0.
- `corepack yarn typecheck`: exit 0.
- `corepack yarn lint`: exit 0, 0 errors / 10 existing warnings.
- `corepack yarn ds:check`: exit 0, 289 files in the final retained candidate.
- `corepack yarn test --watchman=false --runInBand`: exit 0, 28 suites / 147 tests.
- `corepack yarn build`: exit 0 for the retained production source; subsequent changes affect only test and documentation files.
- Explicit TypeScript and ESLint checks include the hidden `.ai/qa/tests/task_delegation/TC-TASK-DELEGATION-002.spec.ts` file, which the root TypeScript glob omits.
- Managed integration: `OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS=3600 corepack yarn test:integration:ephemeral task_delegation`; two tests passed. Final rerun passed 2/2 in 25.9 seconds; the runner exited 0.
- TEST-010 proves fresh naming; preservation of the exact legacy Factory name and a custom name on repeated seeding; stable principal, roles and delegation binding; guarded rename and stale-version 409; actual task delegation and completion of a local START -> END workflow. It does not invoke GitHub, a model provider or the external execution broker.
- The standard local Users form was exercised: Factory -> Software Engineer, save, reload and confirm the unchanged `agent:factory` role and organization. The account remains noninteractive. Screenshot: `.ai/qa/test-results/phase1-software-engineer-ui.png` (local evidence, not tracked).
- Primary and security review passed the retained production changes. Primary review identified failure-path fixture-cleanup assertions; they now accumulate failures and report after cleanup. The primary reviewer passed the final cleanup change; security review reported no findings.

## Local runtime and next phase

The user confirmed that no server deployment exists and all work stays local. Reuse the existing CLI-managed environment and its private descriptors. Do not copy credentials into this plan or commit test environment files.

Phase 2 remains Draft pending readiness audit. Its local acceptance path uses a fake repository broker; real GitHub installation/qualification depends on the execution-spec owner. Project bindings are Phase 3. No registry, repository page or project binding is implemented by Phase 1.

## Phase 2 readiness observations

- The registry spec makes Open Mercato the registry authority and freezes repository ID, config epoch and profile digest on delegations. The execution companion still describes external installation policy, caller `targetId`, and legacy self-instance enrollment. Reconcile those superseded statements against D-043/D-044 before connecting the resolver or real broker; do not implement two authorities.
- The local phase is explicitly permitted to use a fake broker, but its callback transport and activation boundary still need an implementation plan. Test mode must stay local and must not become a production authentication bypass.
- Phase 2's internal usability endpoint depends on frozen bindings and project links delivered in Phase 3. Keep it fail-closed until those records exist; positive usability acceptance belongs to Phase 3.
- The registry source does not exist yet. Phase 1 verification is not evidence for registry, GitHub consent, qualification or project-link acceptance.
