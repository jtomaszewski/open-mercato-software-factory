# Software Factory: team takeover backlog

Implementation paused at the owner's request on 2026-09-19. This document divides remaining work; it does not authorize deployment, paid inference, provider/account changes or another framework architecture change. Documents are in English by team agreement.

## Current baseline

- Application branch: `feat/task-delegation`, base commit `af0bdb3a7fbbd48d6bbb31c58d18375c60e43e80`. The implementation checkpoint is on `feat/task-delegation`. Check out that branch to obtain the candidate; see [team handoff](../development/task-delegation-handoff.md).
- Staff prerequisite: local Core commit `d04c6520253e382986ac4a1d5aa0938e4aa601e5`, based on `ab23d45ff`, branch `fix/staff-task-transactions`. Reviewed and verified locally, not published. The application consumes it through reproducible Core/shared Yarn patches.
- Candidate code includes entities/migration, delegation/process commands, guards, ACL/setup, API, badge/sidebar widgets, read-only AI tools, workflow command registration, start/cancel/end subscribers and tests.
- Latest local application typecheck passed. Tasks Jest: **19 suites, 65 tests passed**. The current migration/schema verifier and installed package patch verifier passed. Most command tests use mocks; this does not prove real command/database composition.
- The ephemeral environment initialized successfully, but its app build failed on test mock typings before Playwright ran. Those typings were subsequently corrected and typecheck passed. **The build and smoke test have not been rerun.** No authenticated browser or end-to-end factory acceptance exists.
- Initial application reviews found material defects. Fixes have been made, including the last assignment-grace security finding and PUT transition correction, but **the final whole candidate has not been re-reviewed**.
- User runtime databases are unchanged. Test environments have been stopped. The owner subsequently authorized publication of this unfinished checkpoint for team takeover. No merge, deployment or paid agent run occurred.

Specifications remain authoritative: [tasks](../specs/SPEC-002-2026-09-18-tasks-module.md), [factory](../specs/SPEC-001-2026-09-18-agentic-software-factory.md), [execution/preview](../../.ai/specs/2026-09-19-agent-execution-and-preview.md), [delivery/recovery](../../.ai/specs/2026-09-19-instance-delivery-and-recovery.md), [infrastructure](../../.ai/specs/2026-09-19-instance-development-infrastructure.md), [website](../specs/SPEC-005-2026-09-19-stal-zbiorniki-www.md).

## Assignment map

Owners below are proposed specialties, not people already assigned. Every row is a separate reviewable unit. Preserve one writer per shared file, migration chain, package manifest and test environment. Do not run builds/generators concurrently in one checkout.

| ID | Deliverable | Suggested owner | Depends on |
|---|---|---|---|
| SF-01 | Recover and checkpoint the current candidate | Integration lead | Handoff artifacts |
| SF-02 | Durable, duplicate-safe orchestrator startup | Framework/backend | Architecture decision; SF-01 |
| SF-03 | Durable cancellation before and during startup | Framework/backend | SF-02 contract |
| SF-04 | Trusted process execution ID in workflow context | Framework/backend | SF-02 identity contract |
| SF-05 | Real Tasks/Staff transaction tests and fixes | Backend testing | SF-01; can start now |
| SF-06 | Idempotent DEMO project setup | Application backend | SF-01; can start now |
| SF-07 | Factory workflow and principal seed | Workflow engineer | SF-02/03/04 |
| SF-08 | Task/process lifecycle integration | Application backend | SF-02/03/04/05/07 |
| SF-09 | Authenticated API and board/drawer QA | Frontend/QA | SF-05/06; success flow also SF-08 |
| SF-10 | Final review and local delegation acceptance | Integration lead + reviewers | SF-05 through SF-09 |
| SF-11 | Installation/target profiles and admission | Infrastructure/backend | SF-01; execution waits for SF-10 |
| SF-12 | Isolated local runner and authenticated gateway | Infrastructure/security | SF-11 |
| SF-13 | Run journal, interaction and restart recovery | Runtime/backend | SF-10/12 |
| SF-14 | Candidate evidence, GitHub PR and repair cycle | Git/backend | SF-13 |
| SF-15 | In-app diff and authenticated preview | Frontend/runtime | SF-14 manifest; UI fixtures can start earlier |
| SF-16 | Human approval and serialized delivery journal | Backend/frontend | SF-14 candidate contract |
| SF-17 | Self-instance driver, migration and recovery | Infrastructure/backend | SF-16 |
| SF-18 | External landing target and private static preview | Web/runtime | SF-11/14/15; independent of self-instance driver |
| SF-19 | External website promotion and rollback | Provider/backend | SF-16 shared journal; SF-18 |
| SF-20 | Optional coordinated catalog price writes | Catalog/backend | SF-19 + catalog framework qualification |
| SF-21 | Retention, installation qualification and VPS | Infrastructure/QA | Respective execution/delivery paths |

SF-01 through SF-10 finish the current delegation slice. SF-11 through SF-21 implement later specifications and remain planning-only until the team selects their scope. Website-only delivery does not need the self-instance deployment driver or coordinated catalog writes.

## Current delegation slice

### SF-01: recover and checkpoint

- Check out the published `feat/task-delegation` branch in an isolated checkout and read the repository team handoff. The application already includes the Core/shared Yarn patches. Verify the source/runtime patch manifest with `node scripts/verify-staff-transaction-patches.mjs` after immutable install.
- Ownership: integration branch, package/lockfile, `.yarn/patches/`, `docs/development/`; no feature changes.
- Acceptance: all intended new files, including the migration snapshot, are present; base and patch hashes are recorded; unreviewed status remains explicit. Make a local WIP checkpoint for parallel branches if useful. Do not promote to ready/merge or republish the unrelated documentation PR.

### SF-02: durable orchestrator startup

- Installed `agent_orchestrator/commands/processes.ts` persists a process before enqueue. Retry returns an existing process without recovering the enqueue. The starter can also crash between workflow creation and linkage; `correlationKey` is not a unique start claim.
- Ownership: framework orchestrator start command, starter worker, durable intent/claim storage and recovery tests. Agree the storage/public contract before implementation; the prior approved framework extension covered Staff, not this lifecycle redesign.
- Acceptance: injected failures after persistence, before enqueue and after workflow creation recover to one logical workflow; concurrent duplicate deliveries cannot create two executions. Preserve lifecycle/audit ownership and tenant isolation. Publish or reproducibly package the reviewed framework change before app consumption.

### SF-03: durable cancellation

- Add an orchestrator-owned scoped cancellation contract that works before `workflowInstanceId` exists. Coordinate it with SF-02's claim/start boundaries. Do not mutate private orchestrator state from the Tasks module.
- Acceptance: revocation before start, during start and after linkage prevents admission of subsequent work; repeated cancellation and restart converge. Document that already-running external work may require explicit cancellation support or reconciliation; a CANCELLED row alone does not prove process termination.
- Serialize overlapping command/worker/schema edits with SF-02. This task may share one framework branch while retaining separate commits and tests.

### SF-04: trusted execution context

- The workflow activity interpolation currently exposes `WorkflowInstance.id`; the three Tasks process commands require the different `ProcessInstance.id`. Expose a trusted orchestrator-owned binding, rather than a model-supplied identifier or app-side guess.
- Acceptance: a real `UPDATE_ENTITY` activity can invoke each Tasks command with the correct execution/delegation identity; unrelated, forged, stale and cross-organization identities are rejected or produce the specified authorized stale no-op.

### SF-05: real transaction acceptance

- Ownership: Tasks command/interceptor tests, isolated PostgreSQL fixtures and minimal implementation corrections. Use the real `CommandBus`, patched managed context and Staff commands, not only mocked handlers.
- Cover rollback of staff/delegation/receipt/audit together, effects only after commit, two concurrent delegations, replay receipts, stale headers/delegation IDs, terminal release, parent/child protection and create/update/status/delete undo. Exercise the transition matrix through both status-change and update commands, including combined-field rejection.
- Acceptance: deterministic separate-connection tests prove commit visibility, blocked/waiting writer rechecks and rollback; no test touches a developer database. Recheck all three project-access callers against configured assignment expiry, including denial on unavailable permission/config services.

### SF-06: DEMO fixture setup

- Ownership: `src/modules/tasks/setup.ts` and a small seed helper/tests. Coordinate edits with SF-07, which also consumes setup hooks.
- Add the specified Internal customer, staff member for the seeded administrator, DEMO project and seven factory columns using supported public commands/services. No private Staff ORM write shortcuts.
- Acceptance: repeated setup does not duplicate data; fixtures are scoped; the board is usable; existing tenant configuration and explicit operator choices are preserved. Keep demo data in example setup and distinguish it from workflow command enablement.

### SF-07: real factory definition

- Ownership: factory graph/agent definitions, process definition and setup integration under the existing app module architecture. Use the supported owned-definition API and execution-principal provisioning. The current setup only enables Tasks workflow commands; it is not a seeded factory process.
- Acceptance: schema-valid graph, non-human execution identity with explicit features, factory principal and manual trigger, idempotent seed, tenant enablement and a real workflow activity invoking Tasks commands. Missing/disabled configuration still returns 503 before delegation writes.
- Unit/integration fixtures may use deterministic activities. Do not install a production dummy graph or use paid inference to disguise missing implementation.

### SF-08: finish task/process lifecycle

- Ownership: start/cancel/end subscribers and process linkage, using SF-02/03/04 public APIs. Remove any temporary assumptions their final contracts supersede.
- Acceptance: a delayed start event after undelegation does not launch work; removal racing startup reconciles the exact execution; milestone restrictions hold; terminal process failure releases/closes the correct active delegation; redelegation fences old work. Exercise the real workflow path, not just the subscriber mock.

### SF-09: API and UI acceptance

- First rerun `corepack yarn test:integration:ephemeral TC-TASKS-001 --no-reuse-env`; the existing test only covers unauthenticated endpoint rejection and has never executed.
- Add authenticated API fixtures for scope/ACL, allowed/denied project access, unavailable orchestrator, stale versions, delegate/undelegate and milestone refusal. Explore the live UI before writing selectors.
- Exercise drawer delegation, board movement and rejected drag, terminal assignee close, event-driven badge refresh, organization switch races, loading/error states, safe links and keyboard/a11y behavior. Include the two AI read tools with database-backed scope tests.
- Acceptance: isolated runner evidence, cleanup and screenshots for the affected UI, with no dependency on shared seeded user records.

### SF-10: acceptance and integration

- Re-run generation, typecheck, lint, DS checks, tests, app build and targeted integration tests after the final code change. Use Corepack Yarn; host Watchman is broken, so Jest uses `--watchman=false`.
- Submit the complete candidate to one primary reviewer and the security reviewer. Prior partial reviews do not cover subsequent fixes or certify the backend. Close or explicitly block every finding; update SPEC-002 phase status from evidence.
- Acceptance: local delegation slice demonstrably passes its contracts. Keep publication, paid runs and deployment outside this gate unless separately authorized. The Core prerequisite and app changes are separate repositories/artifacts.

## Later implementation packages

### SF-11: installation and target admission

Use infrastructure requirements and execution EX-P1/EX-P5. Deliver registered installation/repository profiles, target selection, permissions and immutable binding of each task attempt to a target. Test altered repository/provider IDs, forbidden scope and unknown capability. No arbitrary repository URLs or implicit access to host credentials.

### SF-12: local runner and gateway

Use execution EX-P1 and SPEC-001 runner contracts. Deliver a qualified runner image, isolated checkout/filesystem/network/resource limits, supervisor and authenticated gateway, plus the minimal run page. Prove two independent bounded fixture runs, denied privileged access and exact artifact ownership. Keep Docker/control sockets and Git/provider secrets outside agent containers.

### SF-13: durable run control

Use execution EX-P2. Deliver journal, inbox/outbox, checkpoints, leases/fences, instructions, cancellation, timeout and manual resume. Test crash/restart at every external-effect boundary and duplicate callbacks. Use the specified 30-minute behavior where applicable; do not replace it with the old 15-minute proposal. No duplicated external effects or silent success after timeout.

### SF-14: candidate and PR cycle

Use execution EX-P3. Deliver immutable candidate manifest, deterministic builder/verifier, broker-owned Git operations, PR creation, independent review evidence and bounded repair on the same task/branch/PR. Test stale SHA, failing CI, altered evidence and review/repair limits. Real publication needs an authorized repository identity and operation.

### SF-15: in-app review and preview

Use execution EX-P3, EX-T07/08/11. Deliver file/diff/check views and private preview access without requiring the user to leave Open Mercato. Bind displayed evidence to the candidate SHA. Cover binary/large files, revoked access, separate cookie origin, sleep/wake, approved snapshot inputs and stale review. Never expose raw transcripts or unapproved data derivatives.

### SF-16: approval and delivery journal

Use delivery DL-P1 and the shared journal/fence parts of DL-P2/P3. Deliver exact-candidate human approval, eligibility checks, serialized provider-operation journal, idempotency and dry-run UI. Test stale approval and source-head races before implementing real merge/promotion. Other delivery profiles consume this shared contract.

### SF-17: self-instance delivery and recovery

Use DL-P2/P3. Split into reviewed increments: exact-head merge plus schema-unchanged fixture deployment; drain/activate/verify with rollback; then migration classification, backup/restore proof and recovery UI. Do not enable the success path before its rollback is tested. Protect the running control plane while changing its own repository; never apply a migration to the user's instance merely to test.

### SF-18: external landing candidate

Use EX-P5 and SPEC-005 for `jtomaszewski/hackaton-stal-zbiorniki-landing`. Deliver registered static-target build policy, candidate v2, private preview and target-specific evidence. This is not limited to prices or legal copy. Test arbitrary allowed code/content changes, wrong-target callbacks, denied direct URLs and refusal of unsupported dynamic/provider builds. No real provider setup is implied.

### SF-19: website publication/rollback

Use DL-P5. Consume SF-16 approval/journal and SF-18 artifacts; deliver provider adapter for exact prebuilt artifact promotion, readback and rollback. Qualify the actual account's privacy and predecessor behavior separately. Website-only delivery does not require the OCI/Open Mercato migration driver. Test exclusive publisher races and ambiguous provider responses.

### SF-20: catalog coordination, optional

Use DL-P6 and SPEC-004. This is a distinct use case from editing a website's price text. First qualify the catalog-owned atomic mutation/receipt/recovery seam; the Staff fix does not supply it. Then stage price intentions, bind approval, publish the site first and apply catalog changes with source-version checks and safe compensation. Keep blocked if the required catalog seam is missing; do not hold website-only delivery hostage to it.

### SF-21: retention and deployment portability

Use EX-P4/DL-P4. Implement pin-aware cleanup and redaction, then prove local installation/upgrade/emergency recovery. Record measured resources. Qualify VPS topology, networking/TLS/backups and recovery only on separately approved infrastructure. Local success is not VPS evidence; no purchase or public exposure is authorized by this backlog.

## Parallel work and first pickup

Start with SF-01. Then SF-05, SF-06 and the SF-02/03/04 architecture package can proceed independently. UI tests that cover denied/unavailable states can start before the factory chain exists. Assign setup ownership between SF-06 and SF-07; serialize manifests/migrations and framework starter edits. After SF-10, runner work and candidate UI fixtures can proceed in parallel against a frozen contract.

Each owner hands back a focused diff, the exact test commands/results, open findings, and any contract change needed by another task. No task is accepted solely because its branch compiles.
