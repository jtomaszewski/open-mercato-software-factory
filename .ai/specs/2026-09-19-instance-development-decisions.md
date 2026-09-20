# Instance development: accepted decisions

Date: 2026-09-19
Status: accepted product decisions; technical contracts pending; target scope expanded by D-038, narrowed by D-043 and further moved by D-044..D-047. No decision flatly contradicts the code any more; D-013 and D-047 are partly satisfied with named remainders, and SPEC-008 is now the document out of step — see Known drift at the end.

These decisions were recorded during the specification interview. They describe the requested behavior, not existing implementation or permission to implement, deploy, or spend.

## D-001

Open Mercato Developer is the first required scenario: manual task intake, application code and tests, then a pull request. WordPress is outside this scope.

## D-002

Run the entire stack locally first; support a single VPS later. No provider purchase or provisioning is authorized by this document.

## D-003

The factory is an installable module that changes the source code of its own hosting instance. Instance configuration identifies that source repository.

## D-004

The full outcome includes isolated execution, preview, PR, approved merge, deployment to the hosting instance, verification, and rollback.

## D-005

One final human approval inside Open Mercato authorizes merge and deployment. Show files, diff, tests, and preview there. Bind approval to an exact candidate and invalidate it on changes.

## D-006

Plan approval depends on deterministic size and risk rules. Simple work can run directly; larger or risky work requires approval. A model cannot lower the classification.

## D-007

Only additive, backward-compatible database migrations may run automatically, with an approved plan, testing, and backup. Code rollback retains compatible schema additions; incompatible or destructive changes require a manual path.

## D-008

Use synthetic fixtures by default. A sanitized instance snapshot requires separate consent for that run, with secrets removed and outbound integrations and schedules disabled.

## D-009

Use OpenCode as the initial coding harness. Keep coding execution distinct from the propose-only orchestrator sidecar.

## D-010

When waiting for a human answer, keep the environment for 30 minutes, then persist the session and workspace, stop it, and release compute. Restore it when an answer arrives.

## D-011

Only the explicit Send instruction to agent action steers the run, with delivery status. Ordinary comments do not. Expanded scope may require another plan approval.

## D-012

Review fixes use the same task, branch, and PR, with a new attempt, verification, and approval. Request changes and terminate without deployment are separate actions.

## D-013

Use a GitHub App with short-lived repository-scoped tokens. The coding sandbox must not possess credentials that permit merge or deployment. The enforceable credential boundary requires technical verification.

## D-014

Allow multiple open PRs, but serialize deployment per instance. A changed base requires branch update, new tests, preview, and approval. Send conflicts to the coding agent.

## D-015

Deployment blocks new starts and drains active steps to safe checkpoints while preserving durable human waits. A drain deadline fails deployment rather than forcing an unsafe restart. The deployment executor runs independently of the app.

## D-016

Preview sleeps after 30 minutes idle, preserving the tested version and data. Wake it on demand; diff and verification results remain available.

## D-017

Default active-work/inference limits per attempt are small: 20 minutes and USD 2; medium: 60 minutes and USD 10; large: 120 minutes and USD 20. Administrators can configure them.

## D-018

There is no aggregate per-task budget cap. Attempts also consume the shared daily instance pool.

## D-019

The default inference pool is USD 20 per instance per Europe/Warsaw calendar day, with a warning at 80%. Research, design, coding, review, and retries count. The effective allowance is the minimum of the attempt allowance and remaining pool. These values are product requirements, not spending authorization.

## D-020

The author or task owner may approve if separately permissioned. A second human is not mandatory. Agents cannot approve; repository rules must support the selected policy.

## D-021

A failed deployment automatically rolls back the application and prepares a revert PR without merging it, then blocks further deployments. Prefer deterministic Git revert independent of inference budget; conflicts require manual resolution. Keep compatible schema additions.

## D-022

Keep commands, services, builds, and tests in a versioned repository execution profile. Secrets and privileged host policy remain external. Editing the profile cannot increase the current run permissions.

## D-023

Deliver an installable module plus a separately installed Docker Compose infrastructure package, supporting existing instances. The application does not provision Docker itself.

## D-024

Factory approval, permission, secret, budget, and deployment controls are protected from their own automated deployment path. An agent may propose a PR; an administrator handles it separately.

## D-025

Support parallel coding runs and previews from the first version, with independent configurable limits. Isolate checkout, database, network, and resources; serialize deployments and reserve inference budget atomically.

## D-026

Preview access requires an authenticated Open Mercato user with access to the task, enforced through an authentication gateway. Possession of a URL is insufficient.

## D-027

Budget exhaustion requires manual resume, including after the daily budget resets.

## D-028

Clean up execution resources seven days after a task becomes terminal, configurable by an administrator. Preserve audit records, Git references, and check summaries. Protect rollback resources and honor earlier snapshot-consent expiry.

## D-029

Recover automatically from crashes or sleep only when state is unambiguous. Reconcile session, workspace, and GitHub before retrying, without duplicate side effects. Budget pauses remain paused; ambiguity requires human intervention.

## D-030

The local phase exposes services only on localhost. Remote team access and tunnels are excluded from that phase.

## D-031

Build an immutable candidate image before final approval. Run preview and tests against that candidate, bind approval to commit and image, and deploy the same image without rebuilding. Base changes invalidate approval. Exact merge-tree equivalence remains a technical contract to verify.

## D-032

Application dependency changes are allowed with plan and security checks. Framework, orchestrator, base-image, and toolchain changes use the protected manual path.

## D-033

Every change receives an independent reviewer-agent session. Blocking findings prevent merge and deployment. Review consumes the shared inference pool.

## D-034

Allow up to three automated reviewer-fix rounds with renewed verification and review, then require human intervention. A separate single CI-repair allowance applies. Budget or scope gates may stop earlier.

## D-035

Require repository checks plus API/browser verification for affected paths, with evidence bound to the candidate. Full E2E on every change is not mandatory. Unmet acceptance criteria block completion.

## D-036

A human approves decomposition of an oversized task. Run the first independently deployable slice; remaining subtasks await manual delegation.

## D-037

Use two linked specifications: execution through a verified PR and preview; and approval through merge, deployment, and recovery. Preserve the full scope across both.

## D-038

Support both the hosting Open Mercato repository and administrator-registered external website repositories, initially jtomaszewski/hackaton-stal-zbiorniki-landing. For every website change, the agent prepares a PR, checks and preview; a human final approval inside Open Mercato is required before automatic merge and publication. No low-risk automatic publication waiver. This expands the original own-instance-only target boundary in D-003.

## D-039

One task may propose coordinated catalog and website price changes. Show both before/after values and the proposed website preview before one final approval. Prices remain unchanged in the live catalog until delivery applies the approved change.

## D-040

For a coordinated price change, publish and verify the website first, then compare-and-set the approved catalog update. If the catalog write fails or conflicts with a concurrent edit, restore the previous website deployment and require intervention; never overwrite the later catalog edit. A short interval with different prices is accepted.

## D-041

A terms/legal-content change requires an additional legal-approval feature. One final approver may satisfy all applicable permissions; no mandatory second human. A mixed task requires the union of permissions for every included change.

## D-042

External website previews are available only to authenticated Open Mercato users with access to the task. Direct Vercel deployment URLs must not bypass this gate. There is no public-demo exception.

## D-043

The agent never edits the hosting Open Mercato instance. The `self_instance` target is dropped. Supersedes D-001 (first scenario) and D-003, and the self-instance deployment parts of D-007, D-015 and D-021. Self-instance sections in the execution and delivery specs are superseded pending their rewrite.

## D-044

Open Mercato is the authority for the repository registry, project links and delegation rights; external developer/deployment enrollment is replaced by Open Mercato features plus project access. The GitHub App installation screen is the per-repository consent. The broker alone holds the GitHub App key. See [code repositories](2026-09-19-code-repositories.md).

## D-045

A project links many repositories, with at most one default. A task works on exactly one repository, resolved from its project at delegation and frozen.

## D-046

Add a generic `pr_only` profile kind: sandbox checks, one branch and PR, human merge in GitHub, no preview or delivery. `static_site` keeps D-038..D-042 behavior.

## D-047

The agent is named Developer (`developer`), replacing `factory` and "Open Mercato Developer".

## Known drift (audit, 2026-09-20)

Recorded from an evidence-based audit of every spec against the code, re-verified after `4259a41` split `factory` into `code_changes` + `website_publishing` and renamed the agent id, and after `cfc4908` added the `repositories` module. These are reconciliation items, not new decisions: no decision is withdrawn here, and nothing below authorizes a code change.

**D-047 — identifier half satisfied, display name still open.** The delegatable agent id is now `developer` (`src/modules/task_delegation/lib/agentIdentity.ts:10`), carried into the roster (`lib/agentRoster.ts:27`), with `LEGACY_DEVELOPER_AGENT_IDS = ['factory']` matched but never provisioned (`agentIdentity.ts:17`). What D-047 still does not have: the user-visible name, which remains `Software Engineer` (`agentIdentity.ts:32`, `agentRoster.ts:29-30`, `task_delegation/i18n/{en,pl}.json:24`), and disabling the idle legacy `factory` principal. `agentIdentity.ts:29-30` records the split deliberately — the rename of the id is not the rename on screen.

**SPEC-008 is now the document out of step, not the code.** [SPEC-008](../../docs/specs/SPEC-008-2026-09-19-software-engineer-rename.md) is still marked Implemented, and its "Out of scope — identifiers and internals" section freezes `FACTORY_AGENT_ID`, every `agentDefinitionId: 'factory'` comparison, `subscribers/start-factory.ts`, `FACTORY_COLUMNS` and "the whole `src/modules/factory/` module". All of those have since been renamed or deleted: `FACTORY_AGENT_ID` no longer exists, the subscriber is now `start-delegated-run`, and `src/modules/factory/` is gone. Only SPEC-008's user-visible half still matches reality. It needs an amendment or a superseded-by pointer.

**D-013 — partly satisfied; no broker, and a PAT is still a live fallback.** A real GitHub App now issues short-lived repository-scoped installation tokens (`src/modules/repositories/lib/github-app.ts:44-45,68-71,120-121,225`), and that is the path taken whenever a task's project has a linked repository (`lib/repository-access.ts:44`, `src/modules/code_changes/lib/github-source.ts:17-25`), failing closed rather than falling back to another repo. Three things D-013 asked for are still missing: there is no broker — the App private key sits in app environment (`REPOSITORIES_GITHUB_APP_*`, `github-app.ts:54-59`), an accepted deviation recorded in the code-repositories spec; a long-lived PAT remains the operative credential for any project without a linked repository, with `FACTORY_GITHUB_TOKEN` still honoured through a legacy-name shim (`src/modules/code_changes/lib/github.ts:40-42,45-47`); and "the sandbox holds no merge or deploy credentials" is unverified, because no `internal/usability` endpoint exists.

**D-042 — still contradicted.** Previews are to be reachable only by an authenticated Open Mercato user with task access. The task drawer still links the raw public Vercel deployment URL returned by `findPreviewUrl` (`src/modules/code_changes/lib/github.ts:177`, rendered as a plain `target="_blank"` anchor at `src/modules/code_changes/widgets/injection/task-approve/widget.client.tsx:111`). Unchanged by the split; only the path moved.

**D-009 — still reversed.** The disposable per-run `om-developer-runner` container was built in `5ffb260` and removed in `67a838f`, which moved execution into the shared long-lived OpenCode sidecar. `docker/developer-runner/` does not exist; `docker/opencode/` does, now carrying `agents-local/website_publishing_developer.md`. The spec update that commit promised is still pending.
