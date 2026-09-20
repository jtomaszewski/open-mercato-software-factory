# Instance development: specification map

**Date**: 2026-09-19
**Status**: Draft documentation package; no implementation authorized

## Outcome and document boundaries

Software Factory is an installable module that lets an authorized human delegate a task to Open Mercato Developer, inspect the resulting PR diff and running preview inside Open Mercato, and approve deployment to that same instance. The initial installation is local, with a later single-VPS installation. Targets include the hosting instance's configured source repository and administrator-registered external websites, initially Metal Zbiorniki. A task selects one target; unregistered repositories are refused.

Decision D-037 accepts two linked specifications:

1. [Execution and verified candidates](2026-09-19-agent-execution-and-preview.md): isolated OpenCode work, budgets, human interaction, review, testing, PRs, and authenticated previews. Independently useful as a task-to-PR module without enabling deployment.
2. [Candidate approval and instance delivery](2026-09-19-instance-delivery-and-recovery.md): consume the verified candidate contract, approve, merge, drain, deploy the exact tested image, verify, roll back, and reconcile Git. Can be installed after the execution capability; does not implement an agent loop.

The [decision ledger](2026-09-19-instance-development-decisions.md) contains all 42 accepted product decisions. Technical defaults in the specifications are proposals derived from these decisions. Documentation does not authorize setup of accounts, paid inference, implementation, publication, or changes to an existing runtime.

## Existing specifications and compatibility deltas

Repository baseline: `0cf9e24`, root-level standalone application. Existing documents are Draft designs, not evidence that their runtime exists.

| Source | Reuse | Delta required by this package |
|---|---|---|
| [SPEC-001](../../docs/specs/SPEC-001-2026-09-18-agentic-software-factory.md) | Agent Orchestrator process, explicit delegation, grants, durable workflow | Replace GitHub-only review and no-auto-merge assumptions for the instance-development mode; permissioned author approval allowed; change isolation, resource retention, budgets, and delivery boundaries as specified. |
| [SPEC-002](../../docs/specs/SPEC-002-2026-09-18-tasks-module.md) | Staff tasks/projects/comments, delegation, fencing, task commands | In delivery-enabled mode, `done` means verified deployment, not manually marking an externally merged PR done. Review fixes remain attempts of the same task, not automatically delegated finding subtasks. |
| [SPEC-003](../../docs/specs/SPEC-003-2026-09-18-task-change-set.md) | Code change row, run timeline, evidence manifest and task drawer injection | Add an actual diff. Enforce task ACL on every preview request, including localhost. Replace 72-hour retained compute with 30-minute sleeping preview and seven-day terminal cleanup. Raw transcripts are not an ordinary task artifact. |
| [SPEC-004](../../docs/specs/SPEC-004-2026-09-18-demo-metal-zbiorniki.md) | Fictional company/catalog scenario | The external website and coordinated catalog price tasks are now in scope; WordPress stays out. |
| [SPEC-005](../../docs/specs/SPEC-005-2026-09-19-metal-zbiorniki-www.md) | Static website structure, npm checks and Vercel target | New mode replaces public preview, low-risk waiver and main auto-publication with task-authenticated preview, human approval for every change and exact staged-deployment promotion. |

Do not silently change those documents or installed APIs. The new behavior is an explicit, administrator-enabled instance-development process version. Existing non-code processes remain unchanged. The configured spec location is `.ai/specs`; existing SPEC numbers are not reused.

## Evidence and interpretation

| Reference | Evidence level and use |
|---|---|
| Repository specs above, `.ai/agentic.config.json`, `docker-compose.yml` | Local source inspected. Config requires generate, typecheck, lint, DS check, tests, build. Compose defaults to OpenCode image tag 1.18.3; a tag is not an immutable digest. |
| [OpenCode server](https://opencode.ai/docs/server/) and [CLI](https://opencode.ai/docs/cli/) | Official moving documentation consulted 2026-09-19. Sessions, async prompts, messages, abort, events, export/import support the design. Version-matched conformance remains a release gate; export is not a filesystem checkpoint. |
| [GitHub merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request) | Official API: `sha` compares PR head; the request exposes no expected-base parameter. Post-merge readback is mandatory. |
| [GitHub App permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) | Official permission matrix places merge under Contents write. Repository scope alone does not prevent merge. |
| [GitHub installation tokens](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app) | Official API supports reducing repositories/permissions; tokens expire after one hour. Keep issuance and tokens outside untrusted execution. |
| [GitHub merge queue](https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) | Official design tests combined queue revisions. Deferred: no native queue dependency in the initial single-instance executor; a repository requiring it needs an adapter and new candidate verification. |
| [OpenHands runtime](https://docs.openhands.dev/openhands/usage/architecture/runtime) | Comparable open-source architecture: external controller and per-run execution containers. Adopt separation and isolated resource allocation; do not adopt its additional harness, editor, or plugin system. Docker is not protection from every kernel exploit. |

## Delivery of this documentation

The two specifications define normative behavior, APIs, ownership, failure handling, phased acceptance, and technical qualification gates. Runtime conformance experiments and integration tests are specified, not executed. No paid inference or deployment was performed to produce these documents. Final readiness also requires explicit implementation authorization, per the repository's spec-delivery guide.

## Installed framework evidence (0.8.0)

Read-only inspection of installed `@open-mercato/core`, `enterprise` and `queue` 0.8.0 informed the bridge requirements. Paths below are package-relative source paths, not proposed application edits. They must be requalified after a framework upgrade.

| Package/source | Observation | Consequence |
|---|---|---|
| enterprise `src/modules/agent_orchestrator/commands/processes.ts:87-172`; API `processes/[id]/executions/route.ts:80-183` | DB idempotency claim precedes enqueue; direct command does not run HTTP feature/mutation guards or compare replay input. | Explicit bridge authority, payload hashes, start reconciliation. |
| enterprise `workers/process-execution-starter.ts:163-217`; core `workflows/lib/workflow-executor.ts:288-308` | Workflow creation precedes back-link to process; correlation key is not unique. | Reconcile correlation under exclusive ownership; ambiguous/multiple matches block. |
| core `src/modules/workflows/lib/owned-definition.ts:107-169`, `definition-grant.ts:163-210` | Owned workflow service provisions execution principal; no equivalent owned process upsert found. | Static reviewed grants and collision-safe app process-definition binding. |
| core `src/modules/workflows/lib/step-handler.ts:1329-1374` | Wait timeout parsed/logged without scheduling enforcement in handler. | Supervisor watchdog owns deadlines. |
| core `src/modules/workflows/lib/signal-handler.ts:97-196,219-323` | Signals require the current paused wait; merge payload and persist SIGNAL_RECEIVED; not a durable inbox. | Receipt-based application relay and event reconciliation, no raw runner-to-core callbacks. |
| queue `src/worker/runner.ts:48-95`, `src/strategies/async.ts:550-579` | Queue shutdown is not business-safe draining. | Explicit admission/fence/checkpoint contract. |

Local Docker metadata identified OpenCode 1.18.3 image digest `sha256:1ccc9d47dd46234dd6a4ad914662a226c96a21413c0d286e61bcc248745917f7`. This identifies the inspected local artifact; API/session conformance against its bytes was not exercised.

## Decision coverage

| Accepted decisions | Specification sections |
|---|---|
| D-001, D-003, D-023 | Execution: TLDR, ownership, installable module and external infrastructure |
| D-002, D-030 | Execution: local topology; delivery: local/VPS qualification |
| D-004, D-005, D-020, D-031 | Delivery: candidate/approval binding, Git consistency and exact-image activation |
| D-006, D-032, D-036 | Execution: deterministic sizing, protected dependencies, decomposition |
| D-007, D-015, D-021 | Delivery: drain, migrations/backup, rollback/revert and recovery block |
| D-008, D-024, D-026 | Execution: consent and isolation/preview; delivery: external protected policy |
| D-009, D-010, D-011, D-029 | Execution: OpenCode, wait/checkpoint/instruction state, orchestration bridge |
| D-012, D-014, D-033, D-034, D-035 | Execution: candidate/review/repair; delivery: stale-base handling |
| D-016, D-025, D-028 | Execution: separate run/preview capacity, sleeping/cleanup; delivery: pins |
| D-017, D-018, D-019, D-027 | Execution: attempt/daily accounting, continuation and manual resume |
| D-013, D-022 | Execution: GitHub broker and frozen profile; delivery: credential boundary |
| D-037 | Two linked documents, execution candidate contract consumed by delivery |
| D-038 | Both target kinds; all website changes require human final approval |
| D-039, D-040 | Staged catalog intentions, site-first publication, compare-and-set and compensation |
| D-041 | Legal feature plus union of permissions for mixed tasks |
| D-042 | Vercel protection plus per-request OM task ACL; no public-demo exception |

Proposed technical defaults, not additional interview decisions: approval validity 24 hours; drain deadline ten minutes; post-activation observation two minutes; audit retention 90 days; keep two verified releases and at least seven days of backup recovery coverage. Administrators configure these through protected policy. They must be checked against measured local capacity before activation.

## External target qualification

Website source inspected at `6ae78f584dffa312b0dd1cf28f98c49d98d35692`. Prices and terms are editable repository code; tests exercise the exported site. The new mode supports varied content/code changes, not just two hard-coded operations. v2 candidates distinguish OCI images from immutable Vercel static deployments while reusing tasks, budgets, independent review and approval.

Vercel's [Standard Protection](https://vercel.com/docs/deployment-protection) is documented on Hobby, but actual project configuration and automation-bypass availability require administrator qualification. [Ordinary preview promotion rebuilds; staged-production promotion does not](https://vercel.com/docs/deployments/promoting-a-deployment). A credential-free static build and trusted prebuilt uploader avoid exposing Vercel-injected bypass secrets to candidate build scripts. No actual account settings were changed or certified.

Catalog 0.8.0 `catalog/workflows.ts` explicitly excludes prices from safe workflow writes. `catalog/commands/prices.ts:488-723` implements `catalog.prices.update` with a forked entity manager; API `catalog/api/prices/route.ts:62-65` requires `catalog.pricing.manage`. A wrapper cannot assume atomic source-version checks and applied receipts. The paired-price phase is blocked until a qualified framework seam exists; the independent website-only flow remains specifiable.

## Draft verification

On 2026-09-19, independent architecture/scope and security reviews passed the original self-instance drafts with no open findings. Independent architecture/scope and security reviews also passed the external-target extension after correcting dependency scope and per-surface traceability. Corrections covered exhausted-attempt continuation, incident-scoped manual forward recovery, pre-publication CI privileges, snapshot recipients/derivatives, and preview cookie isolation. The check was read-only and did not exercise application behavior.

Local document checks passed: the original 37 decisions had coverage, both specifications preserve the required template sections, local links/reference files exist, and whitespace checks pass. Runtime tests, provider calls, image builds, merges, database operations and deployments were not run as part of drafting.


## Technical verification follow-up (2026-09-19)

Scope: read-only installed-source inspection and official documentation research. No app implementation, provider configuration, database writes, container starts, paid inference or deployment tests. The installed resolver confirms `@open-mercato/core`, `enterprise` and `shared` 0.8.0; inspected MikroORM is 7.2.0. The resolver was run without materialization; its JSON search field remained `pending`, so the findings below come from direct reads of the named source files, not a claim of a completed resolver search.

| Area / gate | Verified evidence | Consequence and remaining gate |
|---|---|---|
| Orchestrator start (EX-Q1) | Installed `agent_orchestrator/commands/processes.ts:35-58` skips definition input validation when schema compilation fails. Existing enqueue/link crash windows remain. | The bridge must reject invalid pinned input schemas itself and preserve hash/idempotency checks. EX-T01/05 must exercise admission and crash recovery; not run. |
| OpenCode async delivery (EX-Q1) | Public tag `v1.18.3` resolves to `127bdb30784d508cc556c71a0f32b508a3061517`; [handler lines 311-329](https://github.com/anomalyco/opencode/blob/127bdb30784d508cc556c71a0f32b508a3061517/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L311) forks work before returning No Content. | HTTP 204 is not durable acknowledgment. Reconcile persisted input and supervisor journal. Version-matched source narrows the question but does not certify the OM image or message replay behavior. |
| OpenCode restart/checkpoint (EX-Q1) | Pinned [status service](https://github.com/anomalyco/opencode/blob/127bdb30784d508cc556c71a0f32b508a3061517/packages/opencode/src/session/status.ts#L31) uses a Map with idle as missing-entry default; [import](https://github.com/anomalyco/opencode/blob/127bdb30784d508cc556c71a0f32b508a3061517/packages/opencode/src/cli/cmd/import.ts#L172) restores session/message/part records, not repository files. | Idle after restart and successful import are insufficient checkpoint proof. Preserve durable state plus worktree. EX-T04/05 need actual pinned-image fixtures with a fake provider. |
| Catalog transaction (DL-Q4) | Shared `commands/types.ts` defines `transactionalEm`; catalog `commands/prices.ts:500-719` ignores it, forks, flushes, then emits side effects. MikroORM `EntityManager.js:1813-1835` copies transaction context only on request. | Current command is not a qualified atomic price/context/receipt seam. DL-P6 stays blocked pending catalog-owned capability and concurrency/crash fixtures. Website-only delivery remains independent. |
| Static packaging (EX-Q4) | Official [Build Output API](https://vercel.com/docs/build-output-api/v3) permits producing `.vercel/output` directly; [configuration v3](https://vercel.com/docs/build-output-api/v3/configuration) supports static routing metadata. | A trusted packager can consume the secret-free Next static export instead of running candidate build code with provider secrets. This is a documented mechanism, not a tested uploader; test route/asset/404 behavior and reject dynamic output/untrusted routing before admission. |
| Protection/promotion (EX-Q4, DL-Q5) | [Standard Protection](https://vercel.com/docs/deployment-protection) covers generated URLs on Hobby; [staged production promotion](https://vercel.com/docs/deployments/promoting-a-deployment) avoids rebuilding. | Account entitlements, actual protection, bypass-secret containment, exact artifact identity and gateway ACL still need installation qualification. No live provider configuration was inspected. |
| Rollback/policy (DL-Q5) | [CLI rollback](https://vercel.com/docs/cli/rollback) limits Hobby to the previous production deployment, says timeout does not cancel the operation, and says promotion after rollback re-enables domain auto-assignment. | Require eligible predecessor, retain lease through uncertain operations, and independently disable competing publishers. DL-T13/15 must exercise this sequence on an authorized fixture project. |

### Catalog seam qualification boundary

An app command registration is not a solution to DL-Q4. The future catalog owner must expose or qualify one transaction boundary that checks approved before-state and relevant parent/pricing context, applies the normalized change, and commits the operation receipt together. Ordinary writers must participate in compatible locking/version semantics. Events, indexing and audit obligations must remain correct after rollback or process death; no success based solely on equal numeric values. The exact framework API and its upstream contribution remain a separate design/implementation task. No new catalog API or generic workflow permission is declared ready by this research.

### Qualification sequence and acceptance evidence

1. **Source contract review (completed):** named installed files and version-pinned OpenCode source establish the limitations above; official Vercel documentation establishes supported mechanisms and plan limits. This is static evidence only.
2. **Local conformance (not executed):** use the pinned OpenCode image with no live credentials and a fake provider; exercise EX-T01/04/05, including two workflow-start crash windows, early/duplicate signals, false idle after restart, interrupted tool work and missing checkpoint files. Record image/schema/config digests and observed results. Existing provider-wide inference-budget and safe-drain gates remain open.
3. **Catalog seam (blocked on framework capability):** demonstrate one transaction for prices/context/receipt, ordinary-writer races, multi-row rollback and post-commit side-effect recovery in isolated fixtures (DL-T14/15). No live catalog writes during qualification.
4. **Provider conformance (not executed, separate administrator authorization):** on an explicitly approved fixture project, verify private generated URLs, OM task ACL/revocation, credential-free static packaging, staged exact-ID promotion, eligible rollback, timeout reconciliation and no competing publication after undoing rollback (EX-T13, DL-T13/15). Read-only documentation cannot prove account behavior or authorize these writes.

Source fingerprints for reproducibility, not proof of runtime conformance:

| Package-relative source | SHA-256 |
|---|---|
| `@open-mercato/core/src/modules/catalog/commands/prices.ts` | `9ef09339deb77055f799824cd2d26ee7d1dacfcda5ad4dbbc772e8b039661b8d` |
| `@open-mercato/shared/src/lib/commands/types.ts` | `58b7f78adb734648d42b46807b5d0b60caf857953c2fd08e615eba0df0da30d6` |
| `@mikro-orm/core/EntityManager.js` | `2acd46404c3a5c2cbb775f90529535899e32157cee071afcc50b6a566c16a268` |
| `@open-mercato/enterprise/src/modules/agent_orchestrator/commands/processes.ts` | `cc67ff3f0ba314ccaf8fc37827922013294368ca67b49ee35292a60c31cd4b40` |

Independent architecture/scope and security reviewers verified this follow-up against the named sources and returned no findings. This passes documentation handoff only; the unexecuted qualification gates above remain open.
