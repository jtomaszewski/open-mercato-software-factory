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

Phase 2 is now authorized for real-broker implementation following the readiness audit and the explicit rejection of a fake runtime. Project bindings are Phase 3. No registry, repository page or project binding is implemented by Phase 1.

## Phase 2 readiness observations

- The registry spec makes Open Mercato the registry authority and freezes repository ID, config epoch and profile digest on delegations. The execution companion still describes external installation policy, caller `targetId`, and legacy self-instance enrollment. Reconcile those superseded statements against D-043/D-044 before connecting the resolver or real broker; do not implement two authorities.
- The real broker and OM communicate through the signed transport specified in `2026-09-19-repository-broker-contract.md`; no fake runtime or callback-authentication bypass is allowed.
- Phase 2's internal usability endpoint depends on frozen bindings and project links delivered in Phase 3. Keep it fail-closed until those records exist; positive usability acceptance belongs to Phase 3.
- The registry source and broker candidate now exist. Phase 1 verification is not evidence for registry, GitHub consent, qualification or project-link acceptance.

## Updated scope, 2026-09-19

The user explicitly rejected a fake broker and requested full implementation. Phase 2 must use a real GitHub App broker, with no mock product mode or synthetic qualification success. The user authorized creating/configuring a GitHub App through Codex Browser, then saving all necessary credentials in a new untracked Downloads file with owner-only access. The App was created with the reviewed permission set. Client-secret and private-key generation were approved and completed. The private key, client secret and separate directional broker secrets are saved outside this repository with mode `0600`. A signed read-only GitHub App identity request returned HTTP 200 and matched the intended application and owner. The user approved availability for installation on other accounts and requested a project-specific name; both changes were saved and read back. The owner installation has been verified through the App API for the requested repository. A successful live registry connection has not yet been completed. Unit HTTP fixtures are verification tools, not the product delivery. Later project-link integration remains part of the overall implementation.

Upstream PR #23 merged at `5ffb260`; locally integrated in `5b06fcb` after the Phase 1 checkpoint `72a7391`. Integrated generation/typecheck/lint/DS/build passed; unit tests passed 30 suites / 148 tests. The existing ephemeral runtime rejected reuse after source changed; restart its verified owner before further integration evidence.

## Current integration checkpoint

| Acceptance item | Evidence and remaining work |
| --- | --- |
| App creation and private credential storage | Completed outside Git; private key authentication matched the App and owner through HTTP 200. |
| Owner installation | Confirmed through the App API; requested repository is granted. Owner selected one additional repository; task operations remain limited to the requested repository. |
| Registry activation and schema generation | Activated in `src/modules.ts`; generation and scoped migration generation passed. Explicit SQL index expressions were required because the generator dropped partial UNIQUE metadata. The regenerated SQL passed isolated PostgreSQL concurrent binding/registration and soft-delete re-registration checks. Further recovery schema changes remain pending; no existing database was migrated. |
| Registry unit tests | Current checkpoint: 39 suites, 173 tests passed; typecheck and lint passed; DS check passed 339 files. Review-driven recovery fixes require reruns. |
| Transport interoperability | Root-owned executable test verifies both directions, tamper detection and replay. Mixed-case query vector exposed a canonical sorting difference; corrected adapter and broker pass all three cross-runtime tests. |
| Broker independent reviews | Consent subset, storage bounds, callback scheduling and executable-bit findings closed. Remaining broker fixes: credential ownership in checkout, initial-run cleanup uncertainty, positive absence detection, graceful callback shutdown, placeholder rejection. Registry review also requires bounded callback bodies, revocation fencing, durable dispatch/event recovery, ambiguous-response recovery, guarded undo and requalification on re-grant. |
| Existing installation connection | Additional OAuth flow is being implemented for an installation created by the owner on another computer; no owner callback is copied or reused. |
| Container storage primitives | Root real-Docker tests passed 2/2: bounded tmpfs bytes/inodes, read-only root, denied networking, and a fresh sandbox instance removes a real orphan container. Full synthetic credentialed checkout and unresolved-cleanup recovery remain to verify. |
| Live registry connection and qualification | Not run. Requires corrected reviewed broker and fresh disposable application runtime. |
| Project links and frozen delegation | Not implemented. |

No installation readback, unit test, or generated schema is a full implementation acceptance claim.

## Hackathon priority, 2026-09-19

The user explicitly prioritized delivery time over additional hardening. Complete the local connected repository and delegation journey, retain secret isolation and tenant/permission checks, and fix defects that actually block the demonstrated flow. Defer further infrastructure hardening and exhaustive failure-matrix expansion; report limitations honestly. Do not manufacture qualification success. Recovery changes already implemented remain in the candidate, but are not a reason to expand into a general reliability platform.

## Hackathon implementation update

Latest upstream `67a838f` is integrated into the working tree, including the assignment picker, four default board columns, Software Engineer display identity and OpenCode sidecar execution. The existing rename integration coverage moved to TC-TASK-DELEGATION-004 to preserve upstream TC-002/003. Merge commit awaits verification.

Under the user's explicit request to reduce excess safeguards, local repository qualification will verify the grant, permissions, immutable base commit and actual profile command results. Mandatory proof of external GitHub Actions isolation and mandatory base-branch protection are removed from this local gate. This does not certify GitHub Actions safety or alter remote branch settings. Dependency installation can access the network inside the credential-free container; subsequent build/test commands run after network disconnection. Tenant scope, explicit repository consent, secret isolation and actual command failures remain enforced. Static-site publishing still requires a real Vercel integration.

### Live connection verification and callback correction

The managed fresh instance built successfully (167 seconds), seeded the recovery schedule, and rendered the repository registry using the existing Open Mercato settings shell. GitHub OAuth authorized the expected account and persisted one real connection. Browser read-back exposed a UI defect: stripping callback query parameters changed `useSearchParams`, cancelling the pending effect and replacing the successful connection with `invalidReturn`. Capturing the initial query string once fixes this lifecycle. An executable component regression failed on the observed invalid message before the fix and passed afterward. A refreshed disposable runtime is being built to verify the corrected browser path. No registered or qualified repository is claimed yet.

Post-upstream checks before the callback fix: typecheck passed, 49 suites/233 unit tests passed, lint reported zero errors and ten existing warnings, and DS check passed 356 files. The callback component test adds one passing regression; full final counts will be refreshed after the next source checkpoint.

## Delivery checkpoint: repository delegation and real execution

The live GitHub App connection, registration of the requested repository, and all five qualified
commands (install, build, test, typecheck, lint) passed on the local Phase 2 runtime. Phase 3 now
adds project links, default selection, frozen delegation bindings, execution source export and
idempotent GitHub App PR creation. Default replacement flushes the previous default inside the
transaction before promoting its replacement. Missing registry services refuse new delegation
before changing the task.

The Software Engineer runs through the installed agent runtime in a separate local container.
A host gateway keeps provider and broad MCP credentials outside that container, restricts the
model and outcome tool, and reserves a conservative per-request cost against an explicit run
budget. A real OpenRouter smoke request passed with the expected response and complete stream.
Docker-to-host-loopback connectivity also passed. This is provider transport evidence, not a
claim that a complete delegated task has opened a PR.

The collector rejects changed binary files, links and mode changes; the broker preserves
existing executable modes. Repository-bound tasks use their PR link for GitHub review and cannot
invoke the legacy website merge action. Disabled repositories add an explanatory task comment.
The comment uses the existing process-write replay marker; a crash between the staff command's
commit and marker persistence can duplicate the comment. No extra persistence layer was added.

The branch incorporates canonical main through e99178d. Final verification passed 57 suites /
283 tests, typecheck, broker/interop tests (47 passed, one optional Docker skip), and managed
PostgreSQL integration tests (5 passed, one existing task-drawer test skipped). Lint passes with
zero errors and ten existing warnings when generated Playwright reports are excluded. The full
DS scan reports two pre-existing arbitrary-selector findings in BackendHeaderChrome.tsx from
canonical main; no candidate file is flagged.

A real Docker supervisor probe passed OpenCode health, executable text copy-out, and complete
container/volume cleanup. Primary and security re-review found no remaining blocking findings.
Full live agent inference through outcome submission and GitHub PR delivery remains unverified.
Production build passed before the final startup/cleanup correction; the final rebuild is recorded
in the pull request.
`pr_only` is the supported delivery path in this implementation. `static_site` qualification
continues to refuse certification until the separate real Vercel preview/publishing integration
exists. No external deployment or merge has been performed.
