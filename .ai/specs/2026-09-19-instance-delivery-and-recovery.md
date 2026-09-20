# Candidate approval, instance delivery and recovery

**Date**: 2026-09-19
**Status**: Draft — self-instance scope superseded by D-043; see [code repositories](2026-09-19-code-repositories.md)
**Scope**: Specification only. Consume a verified candidate; do not implement an agent runtime.
**Companion**: [Agent execution and verified previews](2026-09-19-agent-execution-and-preview.md)
**Decisions and sources**: [Package map](2026-09-19-instance-development-infrastructure.md), [accepted decisions](2026-09-19-instance-development-decisions.md)


> **Superseded in part (2026-09-20):** the approval surface described below as `/backend/tasks/{taskId}/runs` shipped instead as the change-request detail at `/backend/code/changes/[id]`, backed by a persisted `code_changes.ChangeRequest` with a stored approve/reject decision. See [`2026-09-20-change-requests.md`](./2026-09-20-change-requests.md). The run/preview design below is otherwise unbuilt and unchanged.
## TLDR

An authorized human reviews a verified candidate inside Open Mercato and gives one final approval for merge and deployment. An executor outside the application serializes changes to that instance, verifies the Git result, safely drains the application, and deploys the exact image already tested in preview. For a registered static website, it promotes the exact tested staged deployment instead; a coordinated price task then applies its approved catalog change. Failure restores the previous compatible application image, prepares an unmerged revert PR, and blocks further deployments until reconciliation.

## Problem Statement

The factory changes its own hosting application. Restarting that application cannot terminate the component responsible for recording deployment or restoring service. Approval of a moving branch, rebuilding after review, merging against a changed base, or treating a green health endpoint as full verification can deploy something the user never reviewed. Git state, database compatibility, task state and running image must remain explainable after partial failure.

## Overview and Success Measures

Primary outcome: from the candidate view, one authorized approval deploys the exact verified image to the configured hosting instance, or reports a specific block without silently expanding authority. Baseline: not implemented or demonstrated by this documentation task.

Acceptance targets: at most one delivery operation per instance; stale candidate/base/policy/approval never deploys; every tested crash boundary converges or requires attention; failed application activation restores the pinned previous image if its compatible rollback path remains healthy. Deployment success requires identity, functional API/browser smoke, and worker recovery proof. Recovery is deterministic and does not require remaining inference budget.

GitHub's merge API compares PR head using `sha`, not an expected base. Native GitHub merge queues validate combined revisions but introduce another candidate lifecycle; the initial executor uses a serialized direct merge and readback contract. The source map documents this evidence and the unsupported merge-queue case.

## Goals

| ID | Required behavior |
|---|---|
| DL-01 | Bind one explicit human approval to an immutable verified candidate and current authorization. |
| DL-02 | Serialize delivery and reject stale bases, protected changes, policy drift and unsupported repository rules. |
| DL-03 | Reconcile merge results and deploy the same tested image without rebuilding. |
| DL-04 | Drain safely, validate compatible migrations/backups, activate and verify the application. |
| DL-05 | Recover partial operations, roll back safely and prepare a revert PR after failed deployment. |
| DL-06 | Keep task state, UI, audit and retained rollback resources consistent with observed runtime. |

## Non-goals

Coding execution, model-driven merge approval, automatic destructive migrations, self-updating factory controls, automatic merge of recovery PRs, multi-host HA, Kubernetes, provider purchase, framework upgrades, remote access during the local phase, or bypassing GitHub protections. Source merge is not deployment success. Legal changes additionally require `tasks.legal.approve`; one human may hold the union of required permissions. No second mandatory human reviewer beyond configured permissions; a repo demanding one remains blocked until a human resolves its policy.

## Proposed Solution

Add delivery records and commands to `task_delegation`, reusing the existing code change/task identity. The external supervisor package owns one delivery executor with a durable operation journal, instance lock/fence, artifact store, protected policy, GitHub delivery adapter and deployment driver. It runs independently of the app and uses separate credentials from coding execution. Split these privileges into service processes or capability-limited adapters, not new business modules.

Application approval commands submit a structured, scoped request. They cannot submit arbitrary artifacts, repository URLs, SQL, shell commands or traffic routes. The executor resolves a previously registered candidate and rechecks its provenance, installation policy, enrollment and fresh approval before any privileged side effect. Protected policies and service binaries are updated only through an administrator path outside this self-delivery workflow.

### Design Decisions and Alternatives

| Choice | Reason | Alternative | Why not initial scope |
|---|---|---|---|
| External executor with durable journal | Survives app shutdown and can roll back | Workflow step performs deployment inline | Process disappears while deploying itself. |
| Exact image digest from preview | Reviewed/tested binary remains the release | Rebuild after merge | Introduces unreviewed dependency/build drift. |
| Merge commit with explicit head SHA and result/tree checks | Clear base/head ancestry and recovery record | Squash/rebase/merge queue | Different ancestry rules need qualified adapters. |
| Backward-compatible expansion only | Previous image remains valid after migration | Down migrations on failure | Can destroy data or be irreversible. |
| Automatic app rollback, unmerged revert PR | Restore service while preserving Git audit | Force-reset main or automatic revert merge | Destructive history or another unapproved release. |

## Domain Vocabulary and Business Rules

| Term | Invariant |
|---|---|
| Approval | Human actor + candidate manifest digest + expected current release + repository/base/head/tree + image digest + policy/checks/migration digests + scope/time. Append-only and single-use. |
| Deployment | Durable state machine for one installation/candidate/approval, with unique delivery request ID. |
| Desired release | Approved artifact and config identity. Not a floating tag or current branch tip. |
| Observed release | Executor readback of running image/container identity, database migration level and health/functional verification. |
| Recovery block | Instance-wide stop on new deliveries until Git/runtime/schema divergence is resolved and audited. Coding may continue if safe and separately within budget. |
| Safe checkpoint | Explicit durable wait with no active external side-effect lease, not merely workflow `PAUSED`. |

Delivery approval is different from plan approval. The final UI explicitly says Approve merge and deploy and shows what instance/all tenants are affected. Author or owner may approve only with a separately granted feature and external instance enrollment. Agent identity is categorically refused. Approval is invalidated by any head/base/candidate/profile/policy/migration/required-check change, request-changes, consent expiry, protected-path finding, or loss of approver authority before merge.

Default approval validity: 24 hours, administrator-configurable downward or upward through protected policy. This is a proposed technical freshness default, not an interview-selected timeout. Revalidate on execution; expiry never permits automatic renewal. Concurrency limits for coding and previews remain independent from the single delivery lock.

## Users, Permissions, and Scope

| Actor | Required capability and scope |
|---|---|
| Candidate viewer | Task ACL + `task_delegation.view`; `tasks.code.view` for source evidence. |
| Final approver | `tasks.deployments.approve`, task access, human identity and administrator-controlled deployment enrollment for the selected target. Owner/author relationship is allowed, not sufficient. |
| Request changes | `tasks.runs.control` and task access; invalidates approval before creating a repair attempt. |
| Legal approver | `tasks.legal.approve` in addition to normal deployment approval; evaluated for semantic legal changes and mixed tasks. |
| Commercial approver | `tasks.catalog_prices.approve` plus installed `catalog.pricing.manage` and normal target deployment approval for coordinated price updates. |
| Recovery administrator | `tasks.deployments.recover` plus external instance administrator enrollment; can acknowledge repaired divergence, not falsify verification. |
| Delivery executor | External machine identity bound to installation, immutable policy and single operation/fence. It alone receives merge/deploy privileges. |

A self-instance source deployment affects all tenants hosted by the instance; an external-site deployment affects the registered site and only explicitly approved scoped catalog records. Tenant-admin roles cannot independently grant installation-wide deployment power. Resolve task tenant/org from stored candidate scope; enrollment is a separate explicit installation authority. API callers cannot override instance/repository/tenant IDs. Application service accounts and models cannot sign human approvals.

Trust limit: the reviewed hosting app and its identity service enforce the human session boundary. These documents do not claim resilience against a fully compromised identity authority. The external executor enforces candidate/operation/host-policy restrictions independently, but proving a physical human click against a malicious hosting app would require an independent authentication/approval factor and is outside the chosen initial trust model. Do not describe a plain app callback as cryptographic proof of user intent.

## Reuse and Ownership Map

| Capability | Reuse / owner |
|---|---|
| Task, change row, pending decision and run screen | Staff + tasks, extended additively. |
| Candidate manifest, tests, reviewer and preview | Execution specification owns v1 contract. Delivery verifies it, never recreates it. |
| Human decision workflow | App command with durable decision record; orchestrator displays/consumes outcome through its adapter. Final approval is not an auto-disposed model proposal. |
| Deployment lock/journal/credentials/artifacts | External supervisor; app is a scoped projection and request origin. |
| GitHub | Provider records PR and merge; executor verifies repository immutable ID and current rules. |
| Database migration state | Existing migration framework, invoked by approved job from the candidate image. No new migration engine. |

## Architecture and Data Flow

```mermaid
flowchart TD
  C[Verified candidate from execution] --> R[Human reviews diff tests and preview]
  R --> A[Version-bound final approval]
  A --> L[External executor acquires instance lock]
  L --> P[Revalidate policy Git state artifact and rollback readiness]
  P --> M[Merge expected PR head and read back commit tree]
  M --> Q[Drain app and workers to safe checkpoints]
  Q --> B[Backup and compatible migrations]
  B --> D[Start tested image and activate]
  D --> V[Identity and functional verification]
  V -->|pass| S[Record succeeded and task done]
  V -->|fail| X[Restore previous image]
  X --> Y[Prepare revert PR and block further deployment]
```

The executor, its journal, preview/auth gateways, image store and recovery mechanism are outside the replaced app containers. Existing installations must meet a documented deployment-driver contract: current app image/digest, stop/start/health commands, worker set, migration command, immutable config version and traffic target. Host paths/service names are fixed in protected installation configuration, not accepted from task code. The initial driver supports the supplied Compose topology; arbitrary existing custom hosting setups remain unavailable until explicitly qualified against this contract.

Local app/preview/control publishing remains loopback-only. VPS delivery is the same algorithm with administrator-provisioned HTTPS/firewall and backup storage. No wildcard tunnel is part of local delivery. A blue/green app slot is useful for preactivation startup checks, but this design permits a maintenance window and does not promise zero downtime.

### Candidate and approval binding (common and self-instance)

Consume `candidateManifestV1` for the legacy self-instance flow, or the execution spec's discriminated target-aware v2. The OCI-specific checks below apply to self-instance artifacts; external static artifacts use the provider contract below. Reject unknown schema major, missing evidence, platform mismatch, mutable tag, expired snapshot, unsupported build recipe or dependency/profile drift. Record manifest hash, `B` (base SHA), `H` (PR head), `T` (tree of H), image digest, required-check observations, independent review digest, migrations, policy epoch, previous release ID and approver identity. Required repository controls must be satisfied, not substituted with the agent reviewer. If a repo requires approvals the configured human/app cannot supply, show the unmet rule and remain blocked; never auto-relax it.

Approval API atomically inserts the approval plus delivery outbox after optimistic locking the candidate/change row. Duplicate same request/hash returns its original delivery; changed payload under the same key returns 409. After the executor accepts the request, the approval is reserved by exactly that deployment. It is consumed at the merge boundary; ambiguous merge response requires reconciliation, not a second blind request. Cancellation before merge invalidates approval; cancellation after merge is an incident/recovery request and cannot pretend the merge did not happen.

### Git consistency and races

Initial automatic merge method is `merge` (a two-parent merge commit). Before approval, the execution capability updates H to include the current B, tests tree T and freezes the image. Before merging, under the installation delivery lock:

1. Verify repository immutable ID, configured branch, PR belongs to it and is open/mergeable, current base exactly B, current PR head exactly H, H contains B, all required checks/review rules pass for the bound revision and the candidate remains valid.
2. Verify no protected paths/dependencies, new hooks/CI privileges, or external install-policy changes. Confirm expected previous running release matches the approval. If base changed, queue a repair/update attempt through the execution contract; invalidate approval, rerun checks/preview/review and ask for a new final approval.
3. Submit merge with `sha=H` and `merge_method=merge`. No auto-merge queue or background branch updater can independently act on this PR. Installation qualification must detect conflicting auto-deploy/merge automation; disable the automatic delivery capability until the operator reconciles it. This includes the pre-publication CI qualification required by the execution spec; an unchanged privileged workflow executing modified tests is unsafe.
4. Read merged commit M from GitHub/Git objects. Require parents exactly B and H in expected order, `tree(M)=T`, PR merged status/head correspondence, and current target ref M. Record M separately from build source H. Deploy the existing image built from H/T; do not relabel its provenance as built from M or rebuild it.
5. If a race moved the base between checks and merge, M's parent/tree checks fail. Mark `merged_unapproved_base`, do not deploy, block the instance and require recovery. If a later external push advanced the target ref, also block; do not deploy an older approved image as if it were current main. A local lock cannot prevent unrelated GitHub actors from writing.

This catches an unapproved Git result before deployment, but cannot undo an already-completed merge atomically. Repository qualification should restrict routine target-branch updates to the controlled merge path, with administrator emergency access audited. If the product requires preventing even a raced merge, it needs a qualified exclusive-writer policy or transactional merge-queue integration; this design does not claim the REST API offers expected-base compare-and-swap.

New commits after review invalidate approval even when tree contents are identical: provenance and checks changed. Candidate build does not depend on merge timestamps or the eventual merge SHA. Runtime version endpoints expose both built-from H and delivered-as M. In local-to-VPS movement, CPU architecture must match the tested image; rebuilding for another platform produces a new candidate and needs new evidence/approval.

### Deployment state machine

`requested -> validating -> merging -> merged -> draining -> backing_up -> migrating -> activating -> verifying -> succeeded`.

Before merge: `blocked`, `stale`, `cancelled` are no-side-effect exits except durable audit. After merge: any failure transitions to `recovering`, then `rolled_back` if old service is verified or `recovery_failed` if not; both leave `instance.recovery_block=true`. If the current image never changed, recovery verifies it and records `unchanged_previous_release` rather than falsely claiming a rollback occurred.

Every step persists operation intent and its idempotency identity before side effects, then observed result. On restart, query GitHub, migration ledger, containers, proxy and artifact pins before continuing. Exactly matching observation may complete the step; zero effect permits a safe retry under the same fence; contradictory or unknown observations require manual attention. Lease expiry alone does not authorize a second executor to race a still-running migration or merge. Recover ownership and process identity first.

### Drain and activation

Draining changes the external installation admission epoch to DRAINING, refusing new starts and new side-effect leases. Existing bounded agent/tool activities finish or reach approved durable waits; queue admission/reconciliation is aware of the epoch. Do not send an arbitrary SIGTERM and call it a safe checkpoint.

Safe: terminal workflow, explicit USER_TASK or named WAIT_FOR_SIGNAL with no active external run/inference/mutation lease, and all branches safe for a fork. Unsafe: RUNNING, WAITING_FOR_ACTIVITIES, unacknowledged side effect, active OpenCode/agent call or unknown pause reason. Existing paused human work remains persisted. Before final drain acknowledgment, the app/worker set confirms no active writes and the executor checks its own leases. A model call timeout may checkpoint through its normal execution policy; delivery does not force-kill it to meet a deadline.

Proposed drain deadline: ten minutes, configurable in protected policy. Expiry fails delivery, reopens safe application admission, verifies the old app and prepares Git reconciliation because merge may already have happened. Show `merged; deployment blocked at drain`, not Done. No silent drop of in-flight requests or task signals.

Once safely drained, enable maintenance/write barrier, stop all old app workers and schedulers, take the backup, apply only approved migrations, launch candidate app/worker set against the installation's existing scoped configuration, and perform preactivation health checks. Freeze new worker consumption until activation ownership transfers. Switch the configured loopback/VPS proxy target, then run identity and functional verification. Keep the previous image/config/migration compatibility manifest pinned throughout. Only after success release admission on the new epoch and acknowledge durable callbacks.

### Migrations and backup

Automation permits only expand-style changes compatible with both previous and candidate app/worker code. A schema migration triggers human plan approval before coding. Final manifest contains SQL and snapshot digests, migration IDs/order, affected objects, expected migration ledger, lock/statement timeouts, backup scope and old-code compatibility evidence. Classify unknown SQL as manual-only. DROP, rename/removal, incompatible type or meaning changes, mandatory non-null without a compatible rollout, irreversible transformations and privilege changes are refused. Even ADD COLUMN can lock or break old inserts; additive syntax alone is insufficient.

Before merge validate backup tooling/storage/quota/restore qualification and compatible rollback image availability. After drain, take a transactionally consistent instance backup of databases plus required uploads/config metadata, encrypted with external secrets excluded. The installation administrator authorizes instance-wide backup scope; task-level snapshot consent does not authorize it. Record backup ID, digest/manifest, completion and a restore verification receipt against the approved recipe. Default: restore into an isolated verification database and run integrity checks before live migration; if that cannot finish within the configured maintenance budget, fail the deployment and restore normal old-app operation. Never test restore over the live database.

Run migrations using the tested image as a bounded job, without application traffic. Use the framework migration ledger plus executor intent/observed record. Prefer transactional migrations; a failed/unknown partial migration pauses for observed-state reconciliation before any retry. Rollback switches code/config while retaining compatible schema additions. It never automatically restores the database backup or runs down migrations; those may lose post-backup writes and need a separate administrator decision. If the actual schema is not known compatible with the old image, do not activate it blindly: keep maintenance and report recovery_failed.

### Verification and recovery

Required verification: running image digest equals approval, runtime reports H/T/M as expected, migration ledger equals approved result, app health responds, authenticated representative API/browser smoke for affected functionality succeeds, workers can process a synthetic scoped fixture and reattach pending workflow callbacks, and error/health observation remains clean for a proposed two-minute window. Synthetic fixtures clean themselves up. A single HTTP 200 is insufficient.

If verification fails, stop candidate consumers, switch to and verify the previous pinned app/worker/config identity, keep compatible schema additions, and record the failed artifact and cause. Deterministically prepare a revert of M (merge mainline parent 1), starting from fresh current target. Run without an LLM or inference budget. Use a normal new branch and draft PR, do not reset main or merge the revert. Detect an existing recovery branch/PR by operation marker before retry. Git conflicts or protected-file changes remain manual; retain an actionable recovery artifact even when GitHub is unavailable.

Block all later deliveries until an authorized recovery administrator resolves Git/runtime/schema identity through a reviewed revert merge and records evidence. A forward repair with a new candidate is a separate administrator-operated recovery procedure outside the automatic delivery queue: the administrator records a fresh candidate-bound recovery approval, acquires the same installation lock with an incident-scoped operation ID, revalidates the candidate/backup/schema, uses the protected installation driver to activate its exact image, performs the same identity/functional checks, and supplies those immutable receipts to the resolution command. The ordinary approval/queue path remains blocked throughout; there is no implicit bypass flag. Clearing a boolean is insufficient. For revert recovery, the resulting Git tree must match the observed restored image source tree (compatible retained schema additions are recorded separately); divergent unrelated commits require a reviewed reconciliation rather than falsely declaring equivalence. The resolution command checks current Git, running image, migration compatibility, open recovery operation and retained backup state. Do not create recursive automated deployment from the recovery PR itself. All rollback and reconciliation steps run independently of inference-budget exhaustion.

### External static-site delivery

D-038..042 add the registered Metal Zbiorniki repository without replacing self-instance delivery. Keep a single installation delivery lock initially, so self-deployment cannot drain OM in the middle of a catalog apply and two website publishes cannot race. Record target ID/config epoch on approval, every provider operation, receipt, release and recovery. Website delivery does not restart/drain OM app workers, run OM migrations or claim an OCI image deployment; it runs the static-site adapter and, when present, the catalog apply command. Shared budget/attempt/review policies remain unchanged. Unknown targets/artifact kinds are rejected.

One final human approval is mandatory for content, code, prices and legal changes. There is no SPEC-005 low-risk publication waiver in this process version. Effective permission set is the union of normal task/target deployment features, `tasks.legal.approve` for any legal change, and `tasks.catalog_prices.approve` plus the installed pricing feature for coordinated prices. Source path classification is a floor, never proof that commercial/legal content is absent. Re-evaluate final diff, proposals and permissions when consuming approval. No eligible human means a visible waiting-for-authorized-approver state, not a fallback approver or automatic merge.

For Vercel, ordinary preview-to-production promotion can rebuild with different environment values. Instead create a protected staged **production** deployment before final approval, upload the already-built static artifact without running code in the privileged uploader, test that exact deployment through the OM gateway, and bind its immutable ID/project/account/static manifest to approval. Official CLI describes `--prebuilt --prod --skip-domain` and subsequent promotion of that staged deployment without rebuilding. These commands describe the future adapter, not commands executed during drafting. Qualify the pinned CLI/API and actual account; never infer capability from the documentation alone.

Merge H using the existing B/H/T checks; for external sites verify the merged tree against the source bound to the static manifest. Git merge must not independently publish or trigger a new provider build. Administrator prerequisites: protect all generated deployment URLs, disable competing Vercel Git builds/automatic production aliasing, establish a known previous production deployment and a verified rollback path. Fresh targets without a previous production release need an explicit initial bootstrap outside this automatic update path. Existing `main -> Vercel auto-deploy` from SPEC-005/README must be replaced for this process, not left racing the executor.

After merge, read back current production deployment and expected predecessor, revalidate the protected configuration, and promote only the approved staged deployment ID. Verify public domain routing, deployment ID/static manifest, expected pages and updated prices/legal text; record tested observations and provider receipts. No new build, floating branch alias or successful deployment-status URL can substitute for this identity binding. Public production remains deliberately public; generated and unapproved candidate URLs remain protected. The provider owner is an infrastructure trustee; normal reviewers get no direct Vercel bypass access.

Website-only success completes the task after public verification. On failure restore the previous provider deployment without rebuilding, verify its public routes/content, prepare an unmerged revert PR for M and block further delivery as in the common recovery policy. Protect previous/current/provider artifacts against cleanup. If provider rollback or identity readback fails, report recovery_failed and the observed state; do not assert that traffic was restored. Honor any known provider operation still in flight before releasing/reassigning the delivery lease.

### Vercel rollback and configuration qualification

The documented [Hobby rollback limit](https://vercel.com/docs/cli/rollback) is the immediately previous production deployment; retaining an older deployment ID does not make it eligible. Record the actual account plan, current production ID and eligible predecessor at admission and immediately before promotion. Initial Hobby support requires exclusive publication ownership and rollback to that exact predecessor; any unexpected production transition or unavailable predecessor blocks publication. Do not substitute a rebuild or assume an arbitrary older deployment can be promoted. The [promotion guide](https://vercel.com/docs/deployments/promoting-a-deployment) distinguishes staged never-promoted deployments from already-promoted ones; use the rollback operation for the latter and qualify its eligibility.

Rollback CLI timeout limits waiting, not the provider operation itself. On timeout, retain the delivery lock and reconcile provider operation status plus public routing before retry, completion or manual recovery. A successful CLI exit alone cannot certify restored service. [Undoing rollback via promotion](https://vercel.com/docs/cli/rollback) re-enables automatic production-domain assignment. Therefore disabling domain assignment alone is insufficient: the administrator must independently prevent competing Git/CI/hook deployments, and qualification must exercise promotion after rollback. Recheck effective policy after each provider transition; unexpected policy drift blocks later ordinary deliveries and enters recovery. This document authorizes none of those account changes.

### Coordinated website and catalog price change

One approved candidate groups a code change and staged record changes; no live catalog write occurs during generation or preview. Approval binds the before/after decimal price, exact price/product/variant scope and source versions, tax calculation/rounding result, website artifact, operation IDs and the required combined permission set. Preflight re-reads catalog state before merge/promotion and again at catalog apply. A preflight conflict stops before publication; a conflict after publication enters compensation. This is a journaled sequence with compensation, not a transaction spanning Vercel and PostgreSQL.

State sequence: `requested -> validating -> merging -> merged -> publishing_site -> verifying_site -> applying_catalog -> verifying_pair -> succeeded`. The unchanged catalog before-state and the approved staged after-state are both shown in OM. A short discrepancy window begins when the public domain serves the new site; it ends only after the catalog apply succeeds or provider rollback is verified. Persist timestamps and show an incident when the window remains open; never describe the two systems as atomically updated.

1. Before publication, validate all exact record identities/versions and authority, both provider artifacts, and ability to perform a compare-and-set through a qualified catalog adapter. Reserve operation IDs and prepare a durable outcome journal. Lack of a proven safe write adapter blocks the entire paired delivery before site promotion.
2. Publish and verify the website as above. If this fails, leave the catalog untouched, restore the previous site if necessary, and enter the recovery block.
3. Apply the approved record intention through `tasks.delivery.apply_catalog_change`, a new narrow deterministic app-owned command, not a general model tool or raw UPDATE_ENTITY permission. Its input contains deployment/intention/approval IDs and expected versions, never an arbitrary catalog patch. It resolves the immutable proposal internally, checks live actor authorization and granted service authority, tenant/org, target mapping, active delivery fence and exact allowed price fields, then uses catalog pricing validation/calculation and command side effects.
4. Prove current row and parent/product/variant/price-kind/tax/applicability context still match the approved before-state under the mutation's concurrency boundary. Persist an applied receipt atomically with the price mutation, including operation ID, input digest, resulting normalized prices/version and scoped record identities. A repeated operation returns that receipt only if its digest matches; a same-value row without a receipt is not proof that this operation succeeded. Compare-and-set must cover ordinary human/API writers, not just competing factory jobs.
5. After durable catalog commit, verify the receipt/current catalog and website both correspond to the approved after-state. Mark Done only then. If the write definitely failed/conflicted, the catalog remains unchanged by this task: roll back the site, prepare the code revert PR and require intervention. Never overwrite a concurrent human price change to restore an old value.
6. If the catalog request times out, do not immediately roll back or retry blindly. Reconcile the operation receipt and current source version first. Applied receipt with exact result means continue paired verification; no receipt with proven unchanged before-state permits retry under the same operation; ambiguous or changed state requires intervention and a tracked inconsistency. If the catalog did commit but later paired verification fails, do not leave new catalog data with a silently rolled-back site: retain the last observed consistent pairing when possible; any automatic price compensation requires its own compare against this operation's after-version/values, atomically receipted, and must never overwrite later edits. If safe compensation is unavailable, block with both observed states and require an administrator instead of claiming recovery.

Installed catalog evidence: 0.8.0 has `catalog.prices.update` and `/api/catalog/prices`, but `catalog/workflows.ts` deliberately excludes prices from workflow-safe commands because parent/pricing context can be stale. `commands/prices.ts` uses a forked entity manager and flushes before some side effects. Consequently an outer tasks wrapper or pre-read is **not proof** of atomic compare-and-set plus receipt. Before implementation readiness, the owner must demonstrate an installed transaction/guard seam covering price and relevant context, or propose a reviewed upstream capability. Do not modify the installed package, declare unrestricted prices workflow-safe, bypass command side effects, or claim this gap is solved by a wrapper name. Paired price delivery remains disabled until this gate passes. Website-only tasks do not require this adapter.

Further source inspection confirms that shared 0.8.0 `CommandRuntimeContext.transactionalEm` exists, but `catalog.prices.update` does not use it. Installed MikroORM 7.2.0 `EntityManager.fork()` defaults to a separate manager and copies transaction context only when `keepTransactionContext` is requested; the price command calls bare `fork()`. The command bus invokes handlers directly without supplying a universal transaction around mutation and receipt. A pre-read, HTTP optimistic-lock header, interceptor, or passing an ignored `transactionalEm` therefore does not establish the required atomicity.

DL-Q4 requires a reviewed catalog-owned transaction seam before implementation of paired writes: reuse one transaction for locked/version-checked price and relevant pricing context, apply catalog validation/calculation, atomically persist the operation receipt, and dispatch normal side effects after commit through recoverable delivery. Merely changing the manager choice is insufficient: fixtures must also race ordinary API writers and parent/tax/price-kind changes, inject failure before/after commit, and prove no partial multi-row write. This is a requirement for a future framework capability, not approval to patch dependencies, replace the command ID, bypass catalog pricing or grant prices to generic workflow UPDATE_ENTITY.

For several catalog rows in one task, initial paired delivery supports only a proven all-or-none catalog transaction with per-row receipts and complete prevalidation. If that is unavailable, require a human-approved decomposition into independently publishable tasks before any site publication; never sequentially leave a partially changed price list while reporting rollback complete. New rows, destructive changes and unsupported pricing contexts stay outside this first price adapter.

### Provider and catalog evidence

Official sources consulted 2026-09-19: [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection), [automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation), [staged promotion](https://vercel.com/docs/deployments/promoting-a-deployment), [prebuilt deploy CLI](https://vercel.com/docs/cli/deploy). They document Standard Protection on Hobby, project-wide bypass secrets, secret availability in builds, and no-rebuild staged-production promotion. They do not prove settings/entitlements of the actual account. Repository baseline is [SPEC-005](../../docs/specs/SPEC-005-2026-09-19-metal-zbiorniki-www.md) plus website commit `6ae78f584dffa312b0dd1cf28f98c49d98d35692`; README currently describes public preview and main auto-deploy, both incompatible with the newly selected flow.

## User Journeys

J-DL-1: User opens candidate in the existing run view, sees version/base, diff/files, independent review, tests, migration/impact summary and preview, then chooses Approve merge and deploy. The dialog names the hosting instance, affected shared code and exact candidate. The timeline shows validation, merge, drain, backup, migration, activation and verification. Only observed success marks the task Done and releases the delegate.

J-DL-2: Another PR changed the base -> candidate becomes stale -> task returns to a bounded repair attempt -> new tests/review/preview -> previous approval visibly revoked -> new final approval required. Multiple PRs may remain open; deployment requests are serialized, revalidated on dequeue and never batch-approved.

J-DL-3: Activation fails -> old service is verified -> UI shows Rolled back, retained schema additions, failed check, running vs Git version and recovery PR status -> further deployment button disabled with reason. If app is unavailable, administrator reads the executor's local status/CLI; durable outcomes are imported into the UI after recovery.

J-DL-4: Human requests changes before merge -> invalidate approval and delegate a new attempt on the same task/branch/PR. Terminate without deployment stops this delivery path and retains evidence. After merge the UI offers recovery, not a misleading no-effect cancel.

## UI and Interaction Contracts

Reuse [backend UI guide](../guides/backend-ui.md), [example page shell](../../src/modules/example/backend/todos/page.tsx), [TodosTable](../../src/modules/example/components/TodosTable.tsx), and the execution spec's existing run view. No second review dashboard or Kanban board.

| Surface | Data / actions | States and canonical components |
|---|---|---|
| Candidate section in `/backend/tasks/{taskId}/runs` | Deployment eligibility and approval/reject commands | Standard detail sections, check `DataTable`, shared buttons and guarded dialog. Eligible/stale/blocked/approval expired/permission denied. |
| Delivery timeline on same page | Deployment projection and safe error details | Semantic badges, grouped step list, observed and desired versions; polling fallback after SSE reconnect. |
| `/backend/settings/tasks/infrastructure` recovery section | Current release, block reason, backup and recovery PR refs | `DataTable` history; guarded recovery resolution dialog, read-only protected policy. |
| External local executor status | Read-only operational command when app down | Installation/deployment IDs, safe phase/error, current/previous digests; never credentials. |

```text
Candidate 7    Tested source H    Base B    Image sha256:...
Diff | Checks | Independent review | Preview
Deployment impact: instance-wide code; additive migration summary
[Request changes] [Terminate without deployment] [Approve merge and deploy]
Delivery: Validate -> Merge -> Drain -> Backup -> Migrate -> Activate -> Verify
Running release / Git release / recovery status
```

Approval is a custom command dialog, not generic record editing; it uses shared dialog/form controls and optimistic headers. Cmd/Ctrl+Enter confirms only when the explicit dialog is focused; Escape cancels. Required checked facts and failures are text, not color alone. Loading/empty/offline/conflict/recovery states preserve user input and prevent duplicate submission. `apiCall`, `LoadingMessage`, `ErrorMessage`, semantic tokens, `task_delegation.*` translations, focus restoration, keyboard navigation, narrow-width layout and light/dark coverage follow the execution spec. Display named task/instance/repository references, not raw IDs. No requirement to open GitHub for ordinary approval; link to GitHub remains optional for auditing.

## Data Models

All tasks-owned rows are scoped by trusted tenant/org; cross-module links are IDs. Mutable projections expose `updated_at`/`updatedAt`; immutable approvals and operation receipts are append-only.

| Record | Minimum fields / invariants |
|---|---|
| Approval | ID, target ID/config epoch, artifact kind, task/change/candidate IDs, manifest hash, human ID, enrollment/policy epoch, B/H/T/image, previous deployment ID, requestedAt/expiresAt, request ID, decision, consumedBy; unique request ID per installation. |
| Deployment | ID, installation, approval, candidate digest, expected previous release, state/reason, fence, step/operation sequence, M, observed image/schema, started/finished; one active operation per installation enforced by unique lease record. |
| Release | immutable source/image/config/migration/evidence identity, parent release, activatedAt, verifiedAt, result; never a floating branch pointer. |
| Catalog apply receipt | operation/intention/deployment IDs, digest, before/after context versions, normalized result and event delivery state; atomic with mutation, unique operation ID. Required seam is DL-Q4. |
| Recovery | failed deployment, previous release, backup refs, rollback observations, revert operation/PR, resolution evidence and resolving human. |
| Artifact pin | artifact/dataset/backup identity, owning deployment/recovery, reason, acquiredAt/releasedAt; atomically shared with cleanup admission. |

Supervisor journal is authoritative while the app is offline. Tasks stores an idempotent encrypted projection with last received sequence. A gap triggers resync, not guessed status. Approval actor/reason and safe error details follow encryption/access conventions; images/source artifacts inherit code-view requirements. The instance-level release journal is not exposed wholesale to a tenant: return only the linked authorized task's delivery and allowed installation summary.

Pin current release, last known-good rollback release, required backups and every unresolved recovery reference. The execution spec's seven-day cleanup cannot delete them. After a later verified release and resolved incidents release obsolete pins under retention policy; default keep at least two verified releases and seven days of backup recovery coverage. Required storage admission fails before merge if reserve is insufficient. Audit uses the package's separate retention policy.

## API, Command, and Error Contracts

Proposed additive guarded command routes. Resolve candidate/task/installation from stored scope, enforce feature plus external enrollment, validate zod/OpenAPI, optimistic version and idempotency body hash. Standard errors: 400 validation, 401 auth, 403 feature, scoped 404, 409 stale/version/state/policy conflict, 410 expired approval/candidate, 429 busy admission, 503 executor/GitHub/identity unavailable.

| Method / route | Input | Result / guard | Requirement |
|---|---|---|---|
| GET `/api/tasks/candidates/{id}/delivery-eligibility` | candidate ID | all blockers, expectedVersion, current base/release, safe policy summary | DL-01/02 |
| POST `/api/tasks/candidates/{id}/approve-deployment` | requestId, expectedVersion, manifestHash, expectedPreviousReleaseId | 202 approvalId/deploymentId, `tasks.deployments.approve`, human-only | DL-01 |
| GET `/api/tasks/deployments/{id}` | ID | sequenced state, B/H/M/image, verification, recovery refs | DL-06 |
| POST `/api/tasks/deployments/{id}/cancel` | requestId, expectedVersion, reason | 202 only pre-merge; 409 recovery_required after merge intent may have executed | DL-01/05 |
| POST `/api/tasks/deployments/{id}/resolve-recovery` | requestId, expectedVersion, resolution evidence IDs | 202 reconciliation, not immediate unblock; recover feature + admin | DL-05 |
| POST internal `/api/tasks/deployments/{id}/catalog-apply` | intentionId, requestId, expectedVersion; no raw patch | durable operation result/202 pending; scoped executor plus approved human/price authority, CAS or conflict | DL-04/05 |
| POST internal `/api/tasks/delivery-receipts` | operationId, sequence, digest, state ref | durable 202 or hash-conflict 409; installation service identity | DL-06 |

Commands: `tasks.deployment.approve`, `tasks.deployment.cancel`, `tasks.deployment.resolve_recovery`, plus guarded non-model-tool `tasks.delivery.apply_catalog_change` for v2 paired delivery only. Network side effects occur after committed outbox. No ordinary update/delete approval endpoint; revocation is a new audited event. Executor `/v1/deployments` accepts only registered manifest+approval IDs with request ID and fence; `/v1/deployments/{id}` returns safe status. App cannot send raw deploy commands. Approval cannot bypass executor validation.

## Events, Jobs, Notifications, and Cross-Module Flows

Publish `tasks.deployment.updated` and `tasks.deployment.recovery_required` after durable projection commits, with scoped task/deployment IDs, sequence and state. Use DOM event bridge to refetch, not as a durable delivery channel. Notifications go to permissioned task owner/approver and instance administrators with scope-appropriate detail.

Executor independently polls/reconciles GitHub when local callbacks/webhooks are unavailable. Local mode needs no public webhook. Future VPS webhook receiver must verify signature and deduplicate delivery IDs; this is an optimization, not sole correctness mechanism. Do not configure it during documentation work.

Delivery success calls existing process-safe task status/link commands through the version-bound adapter, checks active delegation/fence, and releases the delegate. Task is `in-review` while awaiting approval; deployment phases appear as run substate without creating arbitrary staff columns. Failure moves to the agreed closed/failed outcome with recovery detail after safe recovery; it never overwrites a new delegation. In execution-only mode, candidate-ready remains in review for the user to complete through the legacy process; it never pretends deployment succeeded.

## Security, Privacy, and Compliance

External executor owns Docker/deploy and merge capability; sandbox and generated app never receive these secrets. Broker operation allowlists differ for coding and delivery even if the same GitHub App installation issues their server-held tokens. Least-permission installation tokens and immutable repository IDs reduce scope; they are not branch-limited credentials. Secret issuance, GitHub App setup and repository policy changes are separate administrator operations.

Protected path policy covers deployment machinery, grants/ACL, approval validation, budgets, secret plumbing, dependency/toolchain pins, CI workflows and scripts that can alter those controls. Classify transitive control changes too: renaming/moving a protected file, changing a dynamically loaded module or modifying tests to hide a control change does not bypass review. Unknown control impact yields proposal-only/manual delivery. The policy itself and trusted verifier live outside candidate control. This is a fail-closed change-classification gate, not a proof against all malicious application behavior.

No candidate receives production data before deployment. During deployment the reviewed application necessarily gets its normal runtime data permissions; sandbox isolation is not a claim that arbitrary deployed application code is harmless. Authorized human review, baseline checks, protected policy and instance-wide permissions are required together.

Backup data is instance-scoped and encrypted; task users see receipts, not backups or keys. Logs redact tokens/headers/SQL parameter values and restrict raw errors to authorized diagnostics. Profile commands cannot exfiltrate deployment secrets because execution sees only constrained runtime/migration credentials required for its approved job, not GitHub/host-control keys. Migration jobs are treated as privileged reviewed code and require explicit SQL/compatibility gates.

## Integration Coverage

Self-contained fixtures: fake GitHub with controllable races, two tenants and permission tiers, fake executor drivers with fault injection, two candidate images and compatible/incompatible migration fixtures, isolated restore database. API/browser tests cover every method in the route table with allowed/denied/stale/replay cases. Real Docker qualification proves traffic/image/process observations without contacting production services.

| Test | Actions and oracle |
|---|---|
| DL-T01 | Owner/author with feature can approve; same identity without enrollment cannot; agent cannot; tenant mismatch hidden; double click produces one operation; changed hash under same key rejected. |
| DL-T02 | Head/base/check/reviewer/policy/previous-release changes before dequeue invalidate approval; request-changes revokes it; no merge occurs. |
| DL-T03 | Inject base advance between precheck and merge, external post-merge push, wrong tree/parents, uncertain merge response: no unapproved deployment; truthful merged-but-blocked outcome and no duplicate merge. |
| DL-T04 | Two simultaneous delivery requests serialize; drain refuses new starts, preserves human waits, inspects all fork branches, times out without forced restart; admission recovers safely. |
| DL-T05 | Additive compatible migration with verified restore succeeds; destructive/unknown SQL or missing backup/old image rejects; partial migration never auto-replayed or down-migrated. |
| DL-T06 | Image/provenance/platform mismatch blocks; passing health with failing functional smoke rolls back; previous workers/config/image and schema compatibility verified; no rebuild after approval. |
| DL-T07 | Kill executor/app at every persisted boundary, including merge/migration/proxy switch: reconcile exact observed effect or require attention; sequence gaps resync. |
| DL-T08 | Inference pool exhausted, GitHub unavailable, revert conflict, existing recovery PR: deterministic rollback still runs; retry never duplicates revert; later deploys remain blocked; a manually approved incident-scoped forward repair records the exact new image and full verification, then resolution clears the block while unrelated queued deliveries remain unexecuted and require revalidation. |
| DL-T09 | Cleanup races rollback/backup pin; pins win atomically; recovery resolution refuses unverifiable Git/runtime/schema divergence. |
| DL-T10 | Browser: full diff-to-approval flow, changes requested, stale approval, cancel boundary, rolled-back/recovery views, permissions, light/dark/narrow, keyboard and conflict states. |
| DL-T12 | Target-aware approval: ordinary, price, legal and mixed changes require the union of features; author may hold all; no waiver; missing permission or changed source invalidates approval. |
| DL-T13 | Staged static deployment test: wrong account/project/artifact, unexpected provider build, main auto-deploy race, missing protection or rollback predecessor blocks. Exact approved deployment serves production without rebuild; protected URLs remain protected. Exercise the Hobby immediate-predecessor limit and promotion after rollback with Git/CI/hook publication still disabled. |
| DL-T14 | Site succeeds then catalog conflicts/fails: old site restored, live catalog not overwritten, recovery blocked. Inject catalog commit timeout: reconcile atomic receipt before retry/rollback; later human edit is preserved; multi-row partial write is impossible or rejected pre-publication. |
| DL-T15 | Restart at site promotion/catalog commit/verification/compensation boundaries; reattach provider/catalog operation IDs, never duplicate price writes or lose discrepancy state. Test rollback failure and post-commit verification failure without falsely reporting success. A rollback CLI timeout retains the lease until the provider operation and public routing are reconciled. |
| DL-T11 | Shared-instance tenant user attempts granting itself deploy enrollment; protected control/CI/profile changes cannot pass auto-delivery; forged/replayed callback rejected. |

## Implementation Phases

Future work only, no implementation approval implied.

### DL-P1: candidate eligibility and human approval

Depends on execution candidate v1 and scope/identity contracts. Implement scoped immutable approval, eligibility checks, protected policy, delivery outbox and UI dialog/timeline using a dry-run executor that cannot merge. Steps: model/command/idempotency; safe eligibility adapter; UI and auth tests. Close DL-01 via DL-T01/02/10/11. Exit: one correctly bound request, stale or unauthorized requests never enqueue; UI labels the dry-run mode and cannot claim deployment.

### DL-P2: serialized merge and observable delivery to a fixture instance

Depends on P1 plus qualified GitHub policy and deployment-driver contracts. Implement lock/fence/journal, exact-head merge/readback, drain, image verification, app/worker activation and all associated safe recovery handling for schema-unchanged fixtures. Steps: provider adapter/race tests; drain and driver; full success/failure fixture with independent executor. Close DL-02/03 and schema-unchanged DL-04/05 via DL-T02/03/04/06/07/08. Exit: exact tested image deployed or previous service verified, with a blocked recovery PR when merge preceded failure. Never enable real deliveries with rollback deferred to another phase.

### DL-P3: compatible migrations and durable recovery

Depends on P2. Add backup admission/restore proof, migration manifests/classifier, partial-failure handling, retained pins, recovery resolution and scoped audit projection. Steps: compatible/forbidden migration fixtures; backup and schema reconciliation; cleanup/race tests and UI. Close remaining DL-04/05/06 via DL-T05/07/08/09/10/11. Exit: an additive migration can deploy and roll back code without data restore; incompatible/unknown changes are blocked before privileged work.

### DL-P4: installation qualification and VPS portability

Depends on P3. Document/install the driver into an existing local instance, record host/process/storage capacity, verify administrator emergency recovery, then qualify the same contracts on a separately approved VPS. No automatic purchase or remote exposure. Exit: local qualification evidence matches instance/source/image/platform, and VPS readiness is explicitly separate until its DNS/TLS/firewall/backups and tests pass.

### DL-P5: external website publication and combined approval

Depends on execution EX-P5, DL-P1 approval and the shared journal/recovery/pin contracts specified in DL-P2/P3, plus the qualified protected provider profile. It does not depend on the OCI/OM-migration driver or VPS qualification; provider-specific tests qualify the same shared invariants. Add v2 validation, target/semantic permission gates, prebuilt staged deployment promotion/rollback and website verification. No OM worker drain for this profile. Tests DL-T12/13/15 plus UI/auth cases close DL-01/02/03/05/06 for website-only work. Exit: one final OM approval publishes the exact tested static artifact, or rollback/recovery is truthful; all direct unapproved URLs deny access. Provider configuration is a separately approved administrator operation.

### DL-P6: coordinated catalog price delivery

Depends on DL-P5 and DL-Q4 atomic catalog qualification. Implement staged intentions, narrow apply command/receipt, source-context conflict check, site-first sequence and safe compensation/reconciliation. Close DL-04/05/06 with DL-T12/14/15 and proposal/price UI tests. Exit: approved price changes reach site then catalog; a concurrent edit or failure restores the site without overwriting newer catalog state; ambiguous commits never cause blind repeats. If the framework seam is absent, this phase remains blocked while website-only delivery remains independently useful.

Validation each phase: Corepack Yarn generate/typecheck/lint/ds:check/test/build plus route-specific `test:integration:ephemeral`, driver/GitHub fault fixtures, image and restore verification. Never change repository protections, apply migrations to the user's runtime or trigger an actual merge merely to validate this documentation.

## Requirement Traceability

| Requirement | Journey / contract | Phase | Test | Acceptance |
|---|---|---|---|---|
| DL-01 | J-DL-1/4, approval API/binding | P1 | T01/T02/T10 | A01 |
| DL-02 | J-DL-2, lock/policy/repository checks | P2 | T02/T04/T11 | A02 |
| DL-03 | Git consistency, candidate manifest | P2 | T03/T06 | A03 |
| DL-04 | J-DL-1, drain/backup/migration/verify | P2-P3 | T04/T05/T06 | A04 |
| DL-05 | J-DL-3, journal/recovery/revert | P2-P3 | T07/T08/T09 | A05 |
| DL-06 | J-DL-1/3, projections/task outcome/pins | P3 | T09/T10 | A06 |
| DL-01/02/03/05/06 | target-aware static publication and legal gate | P5 | T12/T13/T15 | A07 |
| DL-04/05/06 | approved site-first catalog intention and receipt | P6 | T12/T14/T15 | A08 |

Prefixes omitted in phase/test/acceptance cells are `DL-`. Exact source-present reference capabilities:

| Extension | Capability ID / reference file | Classification | Phase / test |
|---|---|---|---|
| Approval/deployment projection entities | `data.entities`: `src/modules/example/data/entities.ts`; `data.encryption-map`: `src/modules/example/encryption.ts` | emitted-example | P1/T01,T11 |
| Approval/recovery features | `module.acl-features`: `src/modules/example/acl.ts` | emitted-example | P1/T01,T11 |
| Guarded approval/recovery commands | `commands.write`: `src/modules/example/commands/todos.ts` | emitted-example | P1-P3/T01,T07,T09 |
| Eligibility/approval/status/recovery/receipt routes | `runtime.bulk-operation-progress`: `src/modules/example/api/todos/bulk-complete/route.ts` | emitted-example | P1-P3/T01,T02,T07,T09 |
| Event definitions | `events.typed-definitions`: `src/modules/example/events.ts` | emitted-example | P1-P3/T07,T10 |
| Outbox/receipt worker | `runtime.bulk-operation-progress`: `src/modules/example/workers/todos-bulk-dispatch.ts` | emitted-example | P1-P3/T07 |
| DI adapter registration | `module.di-registration`: `src/modules/example/di.ts` | emitted-example | P1/T01 |
| Existing run/settings UI additions | `ui.page-shell`: `src/modules/example/backend/todos/page.tsx` | emitted-example | P1-P3/T10 |

External-target extension surfaces and distinct self-contained fixtures:

| Requirement | Surface | Capability / exact reference | Classification | Phase / test |
|---|---|---|---|---|
| DL-01 | Legal/commercial approval features | `module.acl-features`: `src/modules/example/acl.ts` | emitted-example | DL-P5/DL-T12-permission-union |
| DL-01/03 | Target-aware approval command | `commands.write`: `src/modules/example/commands/todos.ts` | emitted-example | DL-P5/DL-T12-target-approval |
| DL-01/06 | Approval UI with price before/after | `ui.page-shell`: `src/modules/example/backend/todos/page.tsx` | emitted-example | DL-P5-P6/DL-T12-price-approval-ui |
| DL-04/05 | Catalog apply command registration | `commands.write`: `src/modules/example/commands/todos.ts` | emitted-example | DL-P6/DL-T14-apply-command |
| DL-04/05 | Catalog apply guarded route | `runtime.bulk-operation-progress`: `src/modules/example/api/todos/bulk-complete/route.ts` | emitted-example | DL-P6/DL-T14-apply-route |
| DL-04/05 | Catalog operation receipt entity | `data.entities`: `src/modules/example/data/entities.ts` | emitted-example | DL-P6/DL-T14-atomic-receipt |
| DL-05/06 | Catalog receipt read route | `api.crud-query-engine-custom-fields`: `src/modules/example/api/todos/route.ts` | emitted-example | DL-P6/DL-T14-receipt-read |

Each named fixture creates and cleans up its own scoped records and exercises authorization, stale inputs and retry behavior relevant to that surface. The command/route/entity examples prove registration patterns only. Atomic catalog CAS, parent-context concurrency and a receipt committed in the same transaction remain unresolved DL-Q4 qualification dependencies; neither the example nor an outer wrapper proves them. The external Vercel upload/promotion driver is not a module discovery contribution; its independent DL-T13 fixture proves exact artifact promotion and protection before DL-P5 is enabled.

Each route is a distinct fixture case; task status/link integration must be verified against the installed SPEC-002 command contract before enabling the process version. External executor driver is not a module-discovery surface and is qualified by DL-T03 through DL-T09, not falsely classified as an emitted example.

## Rollout, Migration, and Rollback

### Migration & Backward Compatibility

Target-aware v2 is additive; no v1 consumer is allowed to misinterpret static artifacts as images. Existing public-preview/waiver/main-auto-publish policies in SPEC-005 remain legacy behavior until the installation is explicitly switched to this process version, at which point qualification must refuse them. Existing Vercel settings are not changed by this document. Price adapter activation is separately gated on proved concurrency/receipt semantics; registering an app command does not automatically expand the framework's safe vocabulary.


The delivery capability is administrator-enabled per installation only after execution candidate v1, protected external policy and compatible driver are qualified. Add tasks-owned state without removing existing change fields/routes. Keep delivery protocol/schema version explicit; incompatible candidates are rejected with a visible error. Preserve legacy non-code/GitHub-review processes; process definitions already running keep their version.

New delivery-enabled process retains task ownership until verified deployment; manual staff `in-review -> done` must be intercepted for that mode so it cannot bypass runtime verification. Existing legacy mode keeps its documented behavior. Roll back feature admission before code: stop new delivery requests, finish or reconcile active operations with the external executor, then disable the app surface. Never uninstall the journal, old image or recovery driver while an unresolved deployment exists.

## Risks and Tradeoffs

| Risk | Mitigation | Residual |
|---|---|---|
| Base race at GitHub merge | Exact head/base precheck, merge parents/tree/ref readback, exclusive-writer qualification | REST API cannot atomically compare expected base; merge may already exist when detected. |
| App self-deployment corrupts control path | External privileged executor/journal/policy, protected path rules | Trusted app identity boundary remains; malicious app compromise is not solved by code review. |
| Migration falsely classified compatible | SQL + old/new code tests, restore proof, unknown means manual | Application semantics need human review. |
| Single host fails entirely | Retained immutable artifacts, backup recipe, offline recovery docs | No HA or automatic host replacement is promised. |
| Rollback restores code but Git stays advanced | Block further deployment, deterministic revert PR, observed resolution | Human resolution may delay later delivery. |

## Acceptance Criteria

- DL-A01: only an enrolled authorized human can create one approval bound to current candidate evidence; agent, stale and replay-mismatch attempts fail.
- DL-A02: one active deployment per instance; a changed base or protected control cannot reuse approval.
- DL-A03: merged tree/parents and current target pass the contract, and observed runtime uses the exact tested image digest without rebuilding.
- DL-A04: safe drain preserves waits, proven backup precedes compatible migration, and identity plus functional verification gates success.
- DL-A05: each injected failure recovers the previous compatible service or honestly reports recovery_failed; deterministic revert PR and deployment block survive empty inference budget.
- DL-A06: task Done means observed success in delivery mode; UI/audit/pins reflect actual Git/runtime/schema and cannot leak another tenant's task.

- DL-A07: every external website publication has one human approval with all applicable legal/commercial permissions; the exact tested static deployment is promoted without rebuild and unsafe provider configuration blocks it.
- DL-A08: the paired operation changes the website before catalog, detects concurrent catalog/context changes, reconciles uncertain commits, and compensates or reports intervention without overwriting later edits.

## Final Compliance Report

| Check | Status | Evidence / gate |
|---|---|---|
| Scope cohesion | Draft-defined | Candidate consumer; no coding/runtime implementation. |
| End-to-end and recovery contracts | Draft-defined | Approval through rollback/revert, no deferred recovery in first real delivery phase. |
| Data/API/UI/test traceability | Draft-defined | DL-01..06 and T01..15; framework task commands require version qualification. |
| Driver/provider conformance | Not executed | GitHub race, safe drain, backup restore and compatible rollback tests defined, not run. |
| Independent architecture/security review | Passed for draft handoff | Independent architecture/scope and security reviews cover provider promotion and paired catalog changes; no runtime qualification implied. |
| Implementation authorization | Not granted | Documentation-only request. |

Verdict: Blocked - installation/provider conformance gates and implementation authorization remain; no deployment readiness claim.

## Open Questions

No unresolved product question from the interview (through D-042). DL-Q1: infrastructure owner must qualify the installed worker/process safe-checkpoint adapter and Compose driver; DL-Q2: repository administrator must establish compatible merge rules and absence of competing deployment automation; DL-Q3: data/operations owner must qualify backup/restore and old/new schema compatibility. DL-Q4: catalog/framework owner must qualify atomic price/context compare-and-set and durable receipts, including concurrent ordinary writers and post-commit side effects; otherwise propose an upstream seam. DL-Q5: infrastructure/security owner must prove protected staged static upload, exact-ID promotion/rollback, and disabled competing provider automation on the actual account. These are explicit installation/implementation gates, not requests for the user to answer facts discoverable from the system.

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Technical qualification: transaction seam evidence, Hobby predecessor limits, provider timeout and post-rollback policy drift. |
| 2026-09-19 | Initial companion specification after D-037; approval, merge, exact-image deployment and recovery contracts. |
| 2026-09-19 | D-038..042: registered static-site promotion, legal authorization and site-first paired catalog delivery; provider and catalog gates explicit. |
| 2026-09-19 | D-043..047: self-instance delivery superseded (agent never edits OM); `pr_only` repositories have no delivery; external enrollment replaced by OM features plus project access ([code repositories](2026-09-19-code-repositories.md)). |
