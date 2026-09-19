# SPEC-001: Agentic Software Factory on the Open Mercato Agent Orchestrator

**Status**: Draft
**Owner**: HackOn team · **Date**: 2026-09-18 · **Tracker**: —

## TLDR

The bottleneck in agentic development is **initiation, merge policy and a fleet view**, not
agent capability. Open Mercato's enterprise **Agent Orchestrator** (merged upstream on
2026-09-15, PR #5718) already provides the control plane: durable processes with schedule,
event and manual triggers, propose-only agents, a nine-gate disposition policy, a Caseload for
pending decisions, traces with cost, and a corrections-to-evals flywheel. This spec builds the
**Agentic Software Factory** on top of it, inside a standalone Open Mercato 0.8.0 app:

- a thin **`tasks` module** as the intake ("everything is a task"), specified in
  [SPEC-002](./SPEC-002-2026-09-18-tasks-module.md): it adds agent delegation to the core `staff`
  module's task board, and delegating a task to an agent (a Sentry or GitHub webhook later does
  the same) emits `tasks.task.delegated`;
- one orchestrator process triggered by that event: research, then sizing, then the WSFF design
  phases for large work (product review, architecture, program design, vertical slices), with
  a human gate in the Caseload before anything is built;
- a self-hosted, stateless **coding runner** that turns one approved slice into one PR opened by
  a bot, with one bounded CI fix round; non-code tasks (a catalog correction, a reply to a
  customer) end as record or message changes instead, specified in
  [SPEC-003](./SPEC-003-2026-09-18-task-change-set.md) with everything else a task changed;
- a review agent whose findings come back to the board as follow-up tasks.

It is the Open Mercato HackOn build, sized so the tasks module, the process and agents, and the
runner are each one person's weekend. It is structured as portable local modules so it can be
lifted into a standalone npm package and reused on client projects afterwards.

## Problem Statement

A team with good repos still starts every agent run by hand. A Sentry issue, a stale roadmap, a
ticket that needs a design pass: each waits until a human opens a coding agent and types a
prompt. Agent work is spread across local sessions, PRs and chat, so nothing answers "what is
running, what did it cost, what is waiting on me", and every change goes through one reviewer
regardless of risk.

The opposite failure is documented too. HumanLayer's *Why Software Factories Fail* argues that
lights-off factories degrade codebases within 3 to 6 months because models optimise for passing
tests, not for design, and the human stopped reviewing the design. Its remedy (WSFF) is four
reviewed artifacts before code: product review, system architecture, program design, vertical
slices. It claims 30 minutes of design review saves hours of code review, and that a PR needing
even 20 percent rework is not worth a human's time (most one-shot PRs, it says, trend closer to
50).

We need initiation and a fleet view without building a lights-off factory. The orchestrator's
load-bearing invariant, *an agent never mutates domain state; a human or a policy disposes of its
proposal; only then does an effector act*, is the WSFF gate placed at the design stage instead
of at the diff.

The process diagram below must stay legible to a non-engineer: it names the two points where a
human is in the loop, the product owner at the design gate and, at review, whichever reviewers
the change class requires (an engineer, a lawyer, both, or none by policy).

## User Stories

- **Product owner** delegates a task on the board to the factory agent, staying its assignee →
  gets a design to approve in the Caseload, then a PR link on the task. Empty board shows how to
  create a task; a user without the delegate feature cannot delegate to an agent; a failed run
  leaves the task `failed` with the reason.
- **On-call engineer** gets a task created automatically from a Sentry alert, already delegated to
  the agent (post-MVP intake, SPEC-002) → a PR with a fix and evidence, or a `rejected` task with the sizer's reason. Alerts
  below the configured event count create nothing.
- **Reviewer** opens the PR in GitHub, never in Open Mercato → CI result, evidence and the
  reviewer agent's findings are on the PR; follow-up findings appear as child tasks on the board,
  with the parent's assignee and no delegate.
- **Team lead** opens the board → sees every task by status, assignee and delegate, with the process
  instance, cost so far and the pending decision linked.
- **Business owner** (e.g. the steel-tank manufacturer of the demo,
  [SPEC-004](./SPEC-004-2026-09-18-demo-stal-zbiorniki.md), running sales, catalog and staff in Open Mercato, with
  the company website's repo connected as a project) adds a product in the catalog → a task
  "publish a product page" appears on the board, already delegated to the agent → a preview link
  to approve, then the page live. They never read a diff; a change that needs an engineer or a
  lawyer waits for them, visibly, on the task.
- **Legal reviewer** gets a Caseload item only when a change touches legal text (terms, privacy
  policy, pricing, product claims) → reviews the preview and a diff of the rendered text, approves
  or rejects with a reason, never sees GitHub.

## Proposed Solution

### What the orchestrator gives us, verified against the published 0.8.0 packages

How the orchestrator works end to end: [`docs/agent-orchestrator.md`](../agent-orchestrator.md).

| Need | Orchestrator primitive | Where |
|---|---|---|
| Initiation | `ProcessDefinition.triggers`: `schedule`, `event { eventPattern, config }`, `manual { requireFeatures }`; wildcard subscriber with jsonb-GIN candidate probe. We use only `manual`, started by our own subscriber (see *The process*) | `lib/tasks/triggers.ts`, `subscribers/process-event-trigger.ts` |
| Dedup | idempotency key claimed on `ProcessInstance` before the workflow exists, partial-unique on (definition, key); passed to `agent_orchestrator.processes.startExecution`, not available on event triggers | `commands/processes.ts:114-153` |
| Bot identity | agent principals: a non-interactive `auth.User` of kind agent plus a scoped role; the runner callback uses an API key on such a principal | `auth.md`, `core/api_keys` |
| Human gate | `USER_TASK` step with a `formSchema` (core workflows); proposal disposition with mandatory reason on edit or reject | `refund-triage-workflow.json`, Caseload |
| Merge policy | `evaluateAutoApproval`: tenant switch, guardrails, trace completeness, **per-action risk ceiling**, then confidence, then near-tie | `lib/disposition/autoApprovalPolicy.ts` |
| Fleet view | process instance list, Caseload, run traces with `cost`, `latency`, `step_count` scorers | cockpit UI |
| Flywheel | edit or reject with reason drafts an eval case; `yarn mercato agent_orchestrator eval --gate` exits non-zero on regression | evals §8 |
| Runner call and return | `CALL_WEBHOOK` activity (SSRF-guarded), `WAIT_FOR_SIGNAL` step, `POST /api/workflows/instances/{id}/signal { signalName, payload }` | core workflows |
| Module writes from a workflow | `UPDATE_ENTITY` runs a command declared with `registerWorkflowSafeCommands` and enabled for the tenant | `workflows/lib/workflow-safe-commands.ts`, `activity-executor.ts:1016-1053` |

Two facts shape the design and are easy to get wrong:

1. **Artifact results have no human gate.** An `artifact` result routes onto the `researcher`
   outcome handle and the step resumes (confirmed in `outcome-routing.ts:217-228`). So each WSFF
   design phase is an artifact agent **followed by a `USER_TASK`**. Consequence: the correction
   flywheel fires on proposal dispositions (sizer, slicer), not on design verdicts. Accepted for
   now; see Open Questions.
2. **Proposals are data; the workflow is the effector.** `executeProposal` is not called anywhere
   in the orchestrator. The shipped demo routes the `approved` handle to an ordinary step whose
   `UPDATE_ENTITY` reads `context.proposalPayload`. We do the same: the sizer and slicer return
   declarative actions with a declared `risk`, and the workflow's next step performs the
   `CALL_WEBHOOK` or the `tasks.task.*` command.

### The tasks module: intake and board

Specified in [SPEC-002](./SPEC-002-2026-09-18-tasks-module.md). Tasks, projects, the board and
comments are the core `staff` module's (time tracking), enabled as shipped with `planner` and
`resources`; the `tasks` module adds delegation on top. What this spec relies on:

- A task is a `staff` task with a human **assignee** (accountable) and an optional agent
  **delegate** (the agent principal's `auth.User`, `kind='agent'`, provisioned once per org with
  `agentPrincipalService.provision({ agentDefinitionId: 'factory' })` and shown as "Factory
  agent"), held in the `tasks` module's delegation table. Tasks belong to a `staff` project whose
  `code` is the `projectKey` and prefixes a frozen reference (`WEB-12`). The code can be renamed,
  so configuration keys on the project id.
- Delegating emits `tasks.task.delegated { taskId, reference, delegationId, delegateUserId,
  agentId, assigneeUserId, delegatedBy, projectId, projectKey, source, title }`, persistent, with scope in
  the emit **options** as well as the payload. `agentId` is the agent definition id read from
  the principal. It is the only start path; later intake (Sentry, GitHub, MCP, domain events)
  creates tasks already delegated and emits the same event.
- The process writes back only through the module's **workflow-safe commands**
  `tasks.task.set_status`, `tasks.task.link` and `tasks.task.create_followup`, run by
  `UPDATE_ENTITY` steps, declared with `registerWorkflowSafeCommands` in `workflows.ts` and
  **enabled per tenant** by the module seed (off by default). Each is idempotent on (taskId,
  processInstanceId, stepId), because activities retry and `UPDATE_ENTITY` has no idempotency
  key. The workflow never writes the tables directly; `set_status` moves the card through
  `staff`'s own status command.
- While a task has a delegate, only the process writes its status: a command interceptor on
  `staff`'s task commands refuses people's moves. Un-delegating before the
  sizer has decided emits `tasks.task.undelegated` and cancels the instance; after that the
  decision sits in the Caseload and the human disposes of it there.
- **Follow-ups keep the parent's assignee and get no delegate.** Only a human delegation or an
  external alert starts work, so the factory cannot feed itself.

Status lifecycle (close results `done | rejected | failed`, SuperPlane's vocabulary). Each status
is a `staff` board column addressed by slug; `rejected` and `failed` share one `closed` column,
with the outcome on the delegation (SPEC-002 *Status columns*):

```
open ──delegate──▶ queued ──sized──▶ in_design ──approved──▶ in_progress ──PR open──▶ in_review ──PR merged──▶ done
  ▲                  │                  │                        │
  └── un-delegate ───┘                  │                        │
         (before sizing)  sizer: reject ┴─ human: reject ──▶ rejected
                                                          └─ run failed / timeout ──▶ failed
```

### The process

One `ProcessDefinition`, `factory.deliver`, bound to one workflow. Every step below runs as the
workflow's execution principal (see *Starting and seeding*); every task write is an
`UPDATE_ENTITY` on a `tasks.task.*` command.

```
tasks.task.delegated
  sources: board delegation (MVP) · later: Sentry hook · GitHub hook (PR opened, author ≠ bot) · factory_send_task MCP
  └─ tasks subscriber → agent_orchestrator.processes.startExecution
        idempotencyKey task:{taskId}:{delegationId} · input { taskId, delegationId, projectKey, title }
      ↓
START         (definition declares only a `manual` trigger)
AUTOMATED     set_status → queued; link → workflow instance
INVOKE_AGENT  factory.research         artifact → resumes on the `researcher` handle, no gate
INVOKE_AGENT  factory.sizer            proposal: ONE option, the recommended size
      │   approved | auto_approved | edited ──SET_VARIABLE factory.size ← proposalPayload.options.0.actions.0.payload.size
      │   option id = reject (agent), outcome `rejected` (human), outcome `researcher` (nothing proposed)
      │                                                             ──▶ set_status → rejected ──▶ END
      ↓ condition on context.factory.size
[large]   INVOKE_AGENT factory.product_review   artifact  →  USER_TASK  designDecision approve | reject + notes
[large]   INVOKE_AGENT factory.architecture     artifact  →  USER_TASK
[medium+] INVOKE_AGENT factory.program_design   artifact  →  USER_TASK
      ↓ designDecision = approve   (reject → set_status rejected → END)
INVOKE_AGENT  factory.slicer           proposal: ONE option carrying the ordered slices; the first is run
      ↓ approved (same shape as the sizer)                        → set_status → in_progress
[code]      CALL_WEBHOOK  POST {RUNNER_URL}/runs   { workflowInstanceId: {{workflow.instanceId}}, taskId, repo,
                                                     baseBranch, slice, design, limits }
            WAIT_FOR_SIGNAL  factory.run.finished   ← runner: POST /api/workflows/instances/{id}/signal
                ↓ run.status = failed (incl. the runner's own timeout) → set_status → failed → END
            WAIT_FOR_SIGNAL  factory.checks.settled (from the GitHub hook: success | failure, head sha)
                ↓ failure, attempts < 2  →  CALL_WEBHOOK POST {RUNNER_URL}/runs (fix run: same slice, same
                │                           branch, failing check output in the prompt) → factory.run.finished
                ↓ success, or attempts = 2
[non_code]  INVOKE_AGENT factory.operator   proposal: ONE option, actions = record updates and staged messages
            EXECUTE_FUNCTION tasks.apply_change_set   (gates + compare-and-set per action; SPEC-003)
                ↓ conflict or failed → create_followup; artifact-only → link the artifact to the task
      ↓
INVOKE_AGENT  factory.reviewer         proposal: approve | request_changes { findings[] }
      ↓ approved
AUTOMATED     CALL_WEBHOOK  POST {RUNNER_URL}/review-comment      (posts findings on the PR)
AUTOMATED     create_followup  (remaining slices, findings marked follow-up; parent's assignee, no delegate)
AUTOMATED     set_status → in_review   (done when the GitHub hook sees the PR merged)
AUTOMATED     factory.review_route  → reviewers = f(change class, touched paths, risk)   (see below)
PARALLEL_FORK ├─ [developer] WAIT_FOR_SIGNAL factory.pr.approved   (GitHub review, from the hook)
              ├─ [legal]     USER_TASK assignedToRoles: legal      (preview + rendered-text diff)
              └─ [none]      waiver: class allowed by project policy, required checks green
PARALLEL_JOIN
END           SET_VARIABLE outcome = { type: 'staff:staff_time_task', id: taskId }
milestones:   researched · sized · design_approved · pr_open · reviewed   (top-level `milestone` key per step)
```

How each piece works in 0.8.0, and why it is shaped this way:

- **Start.** Our own persistent subscriber on `tasks.task.delegated` returns unless `agentId`
  is `factory`, looks up `factory.deliver` and calls
  `agent_orchestrator.processes.startExecution` with `idempotencyKey: task:{taskId}:{delegationId}`,
  `sourceEntityType: 'staff:staff_time_task'` and `triggeredBy: { kind: 'manual', ref: delegatedBy }`. A process
  `event` trigger cannot carry an idempotency key, and its `.strict()` config schema silently drops
  the trigger if one is added, so the definition declares only the `manual` trigger that
  `startExecution` requires. Never declare both, or every assignment starts two instances.
- **Sizer approval.** On the human path the resume ignores `outputMapping` and never says which
  option was selected; the context gets `disposition` and the whole `proposalPayload` envelope. So
  the sizer returns exactly one option, its recommendation, and a `SET_VARIABLE` on the approved
  transition copies the size into `factory.size`. Approve keeps the size, edit changes it, reject
  takes the `rejected` outcome route. Once any outcome route is wired, every unwired non-approved
  outcome fails the instance, so `researcher` (nothing proposed) is wired too. The slicer follows
  the same one-option rule.
- **Design gates.** Artifact results skip the human gate, so each design agent is followed by a
  `USER_TASK` (`assignedToRoles`, a `formSchema` with `designDecision` and `designNotes`, a
  deadline). Completing it merges the form data flat into the context, and the outgoing
  transitions branch on `designDecision`. The artifact link goes into the task description and
  onto the board card.
- **Runner callback.** The `CALL_WEBHOOK` body passes `{{workflow.instanceId}}`; the runner signals
  `POST /api/workflows/instances/{instanceId}/signal` with an API key whose role holds
  `workflows.instances.signal`. The webhook fires before the instance parks at the wait step, so
  the runner replies 202 first and signals afterwards (an early signal gets 409). The signal
  payload merges flat into the context: `{ run: { status, prUrl, costUsd, summary } }`.
- **Timeouts.** `WAIT_FOR_SIGNAL` parses a `timeout` but 0.8.0 never enforces it. The runner owns
  the wall clock and signals `failed` with a reason on breach. A watchdog in the `tasks` module
  that fails instances parked past a deadline is post-hackathon.
- **Dev only:** a runner or stub on localhost needs `OM_WORKFLOWS_ALLOW_PRIVATE_URLS=true`, and
  `APP_URL` must match the dev server's port.

The human never reviews code inside Open Mercato: the PR is the review surface, with CI as the
verdict. Open Mercato reviews *decisions*. CI failing is a verdict too: it buys exactly one
bounded fix run (Stripe's "at most two rounds of CI", SuperPlane's check handler), never an open
loop, and a red PR after the second round goes to the reviewer and the human as red.

### Starting and seeding

The workflow is **seeded as a database row**, not shipped in `workflows.ts`. The module's
`setup.ts` `seedDefaults` calls
`workflowDefinitionAuthoring.upsertOwnedDefinition({ ownerModule, workflowId, definition, grantedFeatures: ['tasks.process'], … })`,
which is idempotent and provisions the workflow's execution principal: a service user whose ACL
is exactly `grantedFeatures` (SPEC-003 adds the `requiredFeatures` of each record command a
project enables, e.g. `catalog.products.manage`). A run started by an event or a process has no initiating user, and
code-shipped definitions have no `createdBy` and no grant, so `INVOKE_AGENT` and `UPDATE_ENTITY`
would refuse to run. The same seed validates the graph with `workflowDefinitionDataSchema`,
upserts the `ProcessDefinition` (manual trigger, milestones), enables the `tasks.task.*`
commands for the tenant, and provisions the `factory` agent principal. `mercato init` runs it
for new databases; existing ones run `yarn mercato seed:defaults --module tasks`.

### The scenarios it must satisfy

| Scenario | Task comes from | Path through the process | Runner |
|---|---|---|---|
| Bug from alert | Sentry hook creates a task delegated to the agent | research → sizer: single_shot, auto-approved if `risk: low` → slicer (one slice) → run → PR → reviewer | yes |
| Feature from ticket | a human assigns a board task to the agent | research → sizer: large → three design gates → slicer → run one slice → PR → follow-ups for the rest | yes |
| Code review | GitHub hook creates a review task (PR opened, author ≠ bot) | research → sizer: `review_only` → reviewer → findings posted | no |
| Non-code task | a human assigns e.g. "summarise last week's failed syncs" | research → sizer: `non_code` → operator: artifact → linked to the task | no |
| Catalog correction | a human delegates "ZDP-5000 holds 5200 l, not 5000" | research → sizer: `non_code` → operator: `catalog.products.update` → Caseload (before → after on the task) → compare-and-set apply, revertable ([SPEC-003](./SPEC-003-2026-09-18-task-change-set.md)) | no |
| Support reply | a human delegates "answer the customer on *Late delivery SO-1042*" | research → sizer: `non_code` → operator: staged reply → Caseload → the assignee sends it under their own name (SPEC-003) | no |
| Project status update | schedule, weekly | separate process `factory.status`: research agent → artifact → USER_TASK → `CALL_WEBHOOK` to the team chat | no |
| Business data → website | `catalog.product.created` in Open Mercato; a `tasks` subscriber creates a task (`source: event`) delegated to the agent | research (product record, site repo) → sizer: single_shot → run → PR with preview → review route (usually waiver: new product page) → merged | yes |

The status process is deliberately separate: it proves the schedule trigger and the artifact path
with zero runner dependency, so it is the fallback demo and the first thing a non-technical
teammate can own.

The business-data scenario is the one no repo-only factory can run: the event originates in the
company's own system of record, and "done" checks against it (a Playwright test on the preview
asserts the page renders the product's name, price and SKU from the catalog record).

### Who reviews: routing by change class, previews per run

Every run ends with a PR and a **preview**: the run's own stack (already started per run, see
*Run lifecycle*) is kept up behind a per-run URL until the review route closes, with a TTL (default
72 h), then torn down. The URL goes into the signal payload, the PR body and the task card. The
preview is for the human; the automated check stays the verdict.

`factory.review_route` decides who must approve. It takes the **maximum** of two inputs, so an
agent can raise its own risk but never lower it:

- deterministic signals: touched paths matched against the project's review map, diff size,
  flagged files (CI config, test config, lockfile), and the change class of the approved slice;
- the risk the sizer and slicer declared.

The project's review map is configuration on the project, owned by a human:

| Change class | Matched by (example) | Reviewers |
|---|---|---|
| `content` | `content/**`, product pages, images | none (waiver) if checks green, else developer |
| `code` | everything else | developer |
| `legal` | `legal/**`, terms, privacy, pricing copy, product claims | legal |
| `code` + `legal` | both | developer and legal, in parallel |

The same map has action rows for non-code changes (a staged reply may auto-approve because a person
sends it; record updates never auto-approve in the MVP), see
[SPEC-003](./SPEC-003-2026-09-18-task-change-set.md#who-approves-which-change).

Routing is data, not code: new roles (accounting for price changes, HR for a job ad) are rows,
reviewed where they work. Developers review in GitHub; everyone else reviews in the Caseload as a
`USER_TASK` with `assignedToRoles`, fanned out with `PARALLEL_FORK` / `PARALLEL_JOIN`. Any reject
ends the route with the reviewer's reason on the task. This is why decisions live in Open Mercato:
a lawyer will not review on GitHub, and Open Mercato already has the roles, the audit and the
inbox.

The **waiver** (no human review) is a policy, not the agent's judgment: allowed only for change
classes the project lists, only after required checks pass, and executed by a merge identity
distinct from the coding bot (decision 6).

### The agents

| Agent | Type | Result | Tools | Notes |
|---|---|---|---|---|
| `factory.research` | researcher | artifact | web_fetch, repo read tool, task read tool | Gathers context for the sizer; no gate |
| `factory.sizer` | decision maker | proposal | none, object mode | One option: the recommended size out of `single_shot`, `medium`, `large`, `review_only`, `non_code`, `reject`, with one `set_size` action; `risk` declared on the action; runner-up named in the rationale |
| `factory.product_review` | researcher | artifact | web_fetch, repo read tool | WSFF phase 1: PRD plus HTML mockup, from a `TEMPLATE.md` skill |
| `factory.architecture` | researcher | artifact | repo read tool | WSFF phase 2: sequence diagram, endpoints, data model |
| `factory.program_design` | researcher | artifact | repo read tool | WSFF phase 3: call-stack tree, file-tree diff, signatures |
| `factory.operator` | decision maker | proposal | read-only Open Mercato tools (catalog, customers, sales, messages), task read tool | `non_code` tasks: one option whose actions are record updates from core's workflow-safe list and staged replies; `allowedActions` narrowed per project (SPEC-003) |
| `factory.slicer` | decision maker | proposal | none | WSFF phase 4: one option whose action carries the ordered slices, `{ files[], risk, acceptance[] }` each; the first is run, the rest become follow-ups |
| `factory.reviewer` | decision maker | proposal | PR diff read tool | Findings with severity and a follow-up flag; never approves on its own authority |
| `factory.status_writer` | researcher | artifact | GitHub read tool, task read tool | Weekly status from tasks, PRs and traces |

Runtime: **native** (`defineAgent` in `ai-agents.ts`, Vercel AI SDK object mode) is the default
for the sizer, slicer and reviewer, because they are typed decisions with no need for a file
workspace and they test in the Playground in seconds. **File-defined** (`agents/<id>/AGENT.md`)
is the target for the research and design agents, because their value is the WSFF template
skills and they should be editable by someone who does not write TypeScript. File agents in app
modules do load in a standalone 0.8.0 app, but running one needs the OpenCode sidecar
(`OPENCODE_URL`) plus the MCP server, and a file agent may not reference app-module
`defineAiTool` ids. For the hackathon **all agents start native**, with the templates as prompt
sections; an agent moves to file-defined only once the sidecar runs. Agent ids are globally
unique across modules (`defineAgent` throws on a duplicate).

Provider: `OM_AI_PROVIDER=anthropic`, `OM_AI_MODEL` (the adapter default is
`claude-haiku-4-5-20251001`, enough for the sizer and slicer; the design agents and reviewer set
a stronger model through the agent's `defaultModel`), and `ANTHROPIC_API_KEY`.
Agent runs go through the `invoke_agent` queue, so the workers must be running.

The repo read tool is one `defineAiTool` with `isMutation: false` that returns a file listing and
file contents from a shallow clone kept by the runner, ACL-gated like every other tool. The task
read tool returns a task, its parent and its siblings.

### The runner

The propose-only OpenCode sidecar denies `write`, `edit`, `bash` and `task`, so it cannot be the
coding runner. The runner is a second container, built from the same
`openmercatocom/open-mercato-opencode` base image so there is one image lineage, with a writable
clone and a headless coding agent. Contract:

```
control → runner   POST /runs
                   { runId, workflowInstanceId, taskId, repo, baseBranch, slice, design, limits:
                     { maxMinutes, maxCostUsd }, bot: { prAuthor },
                     harness: 'claude' | 'opencode',            (per run; default 'claude')
                     attempt: 1 | 2, failingChecks?: [...] }     (2 = the bounded fix run)
                   → 202 { runId }                               (dedup on workflowInstanceId + attempt:
                                                                  the webhook activity retries)

runner  → control  POST /api/workflows/instances/{workflowInstanceId}/signal
                   (x-api-key: key whose role holds workflows.instances.signal; sent only after
                    the 202, since the instance parks after the webhook returns; retry on 409)
                   { signalName: 'factory.run.finished',
                     payload: { run: { status: 'pr_open'|'failed', reason?, prUrl?, previewUrl?,
                                     costUsd?, summary } } }
```

SPEC-003 extends this contract: a change manifest in the signal (files touched against the
slice's `files[]`, flags, screenshots), coarse progress events pushed while the run works
(`POST /api/tasks/runs/{runId}/events`), and how the preview is routed and authenticated.

The runner owns the timeout: 0.8.0 does not enforce `WAIT_FOR_SIGNAL` timeouts, so on breach it
kills the run and signals `failed` with `reason: 'timeout'`.

Runner steps: fresh worktree from `baseBranch`, write the approved design and slice into the
prompt, run the coding agent headless (`claude -p` or `opencode run`, chosen by the `harness`
field; the two differ in one launch line, which is why the harness is a per-run field and not an
architecture, as Warp's `harness:` and SuperPlane's model setting also treat it), enforce the
time and cost caps, push a branch named `factory/<runId>`, open the PR **as the bot identity**
with the task link in the body, send the signal. It keeps no state beyond the run directory.
Every run records the repo SHA, the factory module SHA and its full input, so any run can be
replayed later against a different harness, model or prompt (the WarpBench method: rehydrate the
task, rerun, compare). Dev needs `OM_WORKFLOWS_ALLOW_PRIVATE_URLS=true` for a runner on the
compose network; never in production.

### What the runner can reach, and with what

The orchestrator agents are propose-only by construction, so every capability people associate
with "an agent that can fix things" lives in the runner. The runner is a developer laptop in a
box: a headless coding agent in a fresh worktree, the repo's own tooling, MCP servers for the
outside world, and a per-project secret bundle on the runner host that Open Mercato never sees.

| Needs | Reached through | Credential and scope |
|---|---|---|
| Code | git clone and push, PR via `gh` | GitHub App installation token, short-lived, one repo, contents and PRs; this is the bot identity |
| Errors | Sentry MCP | read-only token (Sentry scopes tokens per org, so the org is the boundary) |
| Traces, logs, metrics | your observability tool's MCP server | read-only API key per project |
| Uptime, incidents | your incident tool's MCP server | read-only, team-scoped token |
| Infra | `kubectl` with a namespaced view role; IaC `plan` only | read-only kubeconfig; no apply, no prod DB, no secret manager |
| Running the app | the repo's compose, seed and dev commands; docker socket on the host; per-run port offsets | none |
| Verification | repo lint, typecheck, tests, Playwright; then CI and the per-PR preview env after push | none; evidence goes into the PR body and the signal payload |

Rule: **read on production, write only on its own ephemeral environment and its own branch.**
Production credentials are not in the bundle at all, which also closes the trap where a CLI run
inside a dev or preview pod silently targets the production database.

The agent's capability equals how verifiable the target repo is: tests, seed data, a one-command
local stack, CI and preview environments. A repo with all of these satisfies every row above;
nothing in the runner can make an unverifiable repo verifiable. Guards on every run: bot identity
for loop prevention, egress allowlist, daily cap per project, time and cost limits, no automerge.
For the hackathon the demo runner needs only the code row and a throwaway target repo; the
monitoring and infra rows are wired on a real target afterwards.

### Identity: who starts a run, who acts, what it can reach

Three things, kept apart. The orchestrator already separates the first two: the invoker is
`ProcessInstance.triggeredBy`, provenance and never an ACL identity; the execution identity is
the workflow's `grantedFeatures` and an agent principal (unification spec §2). The task records
both: `delegatedBy` is the initiator, the agent delegate is the actor, and the human assignee stays
accountable.

| | What it answers | Who or what |
|---|---|---|
| Initiator | may this person start this work on this project | a human, checked when assigning a task to an agent (a `tasks` feature) or implied by the webhook; stamped as `triggeredBy` on the instance, the task, the PR body and any post; **never travels into the runner** |
| Actor | the identity that pushes, opens PRs, posts | a per-client bot: GitHub App installation, chat app, tracker integration, observability key; the agent principal for the signal callback and task commands |
| Capability | what this run may reach | a bundle minted at dispatch, one project, tiered by run class, short-lived |

Rules that follow:

- **Machine identity, not machine users.** Use each provider's installation primitive. A login
  account only where a service has no non-human identity (a client console, a database role), and
  even then it issues a token; the runner never holds a password. Accounts cost seats, MFA
  custody, long-lived PATs, and a bot that looks like a colleague in every log, which breaks the
  loop guard.
- **Per client where the provider enforces it.** GitHub: one App, one installation per client org;
  where several target repos share an org, one installation covers it and the per-run token is
  minted narrowed to `repositories: [<repo>]`. Observability: key per project. Where the
  provider's unit is weaker than the contract, the credential does not enter the runner: Sentry
  (org-scoped tokens; use a per-client org or a read gateway) and shared chat workspaces
  (channel membership is the only boundary and it drifts).
- **Client-visible writes go through the control plane, not the runner.** A chat post is a
  workflow step from Open Mercato with a server-side channel allowlist and an audit line; the
  runner signals, the workflow posts. No workspace-wide post or join scopes, never a user token.
  Chat reads: a per-client app only for run classes that need one, and the dispatcher refuses to
  mint the capability when that app's memberships include channels outside the project's
  allowlist.
- **Tiered by run class.** "Debug last night's data-sync runs, say why they were slow, post it"
  is a `non_code` task: a research agent on the orchestrator side with observability and
  repo-read tools, no runner, no push token, one post through the control plane. Only a run that
  will open a PR gets the coding bundle.
- **Short-lived.** GitHub installation tokens are minted at dispatch and expire in about an hour;
  a leaked bundle is worthless by morning.
- **Model access is an API key per client**, never a personal subscription: subscriptions are
  interactive OAuth with no headless refresh and their quota follows the account. The key per
  client also gives cost attribution. The sidecar and the runner both read provider keys from
  env.
- **One registry.** A per-client credential bundle record in the control plane (installation ids,
  integrations, keys, channel allowlists), keyed by the task's project id: one command to
  provision, one to rotate, one to revoke at offboarding, and the single answer to "what can the
  factory reach for this client".

### Runner image and hosting

Not a fork of the Open Mercato sidecar. Both images derive from the published
`openmercatocom/open-mercato-opencode:<pinned>` base (OpenCode pinned, non-root user); the
upstream thin image layers the propose-only agents on it, ours layers the opposite profile:

| | Open Mercato sidecar | Factory runner |
|---|---|---|
| Purpose | propose-only file agents driven over HTTP | one coding run per process |
| Toolchain | none | node, pnpm, yarn, git, `gh`, docker CLI, `kubectl` |
| OpenCode permissions | write, edit, bash, task denied | edit, bash, webfetch allowed |
| Entrypoint | `opencode serve` on 4096, long-lived | HTTP shim (`POST /runs`, `POST /review-comment`) |
| Config | generated `opencode.jsonc` | per-run config via `OPENCODE_CONFIG_CONTENT` (permissions + MCP servers with `{env:VAR}` creds) |
| Secrets | provider key | provider key + the project's bundle, read-only mount |

The shim is the only stateful process. Per run: worktree → run-scoped config → `opencode run
--format json` with the prompt and limits, as a sibling container with CPU/memory limits, a
timeout and a tmpfs workspace wiped in `finally` → push → PR as the bot → signal to Open Mercato.
OpenCode's permission system is documented as UX, not isolation, so isolation is one process per
container per run, never a shared `serve` session.

| Environment | Where | Notes |
|---|---|---|
| Local | compose service beside the app's infra compose file | docker socket mounted, named volume for worktrees, gitignored env bundle, `OM_WORKFLOWS_ALLOW_PRIVATE_URLS=true` |
| Staging, prod | a dedicated VM with Docker, **not** a Kubernetes cluster (runs need compose; containerd lends no socket) | one IaC module, instantiated twice; instances differ only in the secret-manager bundle pulled at boot, the shared secret accepted, and the GitHub App installation |
| Hackathon | shim on a laptop or one small VM behind a tunnel (e.g. Cloudflare Tunnel) | the Open Mercato app must reach it; code row only |

Operations: image built by CI to a container registry and tagged with the base version; base
bumps are a deliberate PR; egress allowlist on the VM (GitHub, model provider, package registry,
Sentry, observability, the Open Mercato host); OTLP traces and run logs to your observability
backend, cost and status in the orchestrator cockpit; Open Mercato reaches the runner over a
private network or a tunnel, never a public port; the runner reaches Open Mercato's public API
with the bot principal's key. The docker socket makes the shim root-equivalent on the VM, which
is why the VM does nothing else.

### Safety, run lifecycle and scaling

Four layers, each of which holds if the others fail:

- **Credentials bound the blast radius.** Per-run GitHub App installation token (1 h, one repo,
  contents and pull requests only); the bot cannot approve or merge and branch protection
  requires a review it cannot give. Monitoring and infra tokens are read-only. No prod DB, no
  secret manager, no cluster admin. Worst case: a branch and a PR.
- **Isolation per run.** Fresh clone, own Docker network, own Postgres/Redis from the repo's
  compose file, non-root user, CPU/memory/pid limits, wall clock. The run container has **no
  Docker socket**; only the shim talks to Docker.
- **Egress allowlist on the run network.** GitHub, model provider, package registry, Sentry,
  observability, the Open Mercato signals endpoint. Nothing else, including cloud metadata
  addresses.
- **Untrusted text is data.** Sentry titles, task bodies, issue and PR bodies enter the prompt;
  the orchestrator's injection guardrail screens them on the propose side, and on the runner side
  the structural limits above make injection fail loudly rather than exfiltrate. The code-review
  scenario ignores PRs from non-members (the confused-deputy case).

The shim additionally enforces a cost cap read from the agent's JSON event stream (kill on
breach) and flags any diff touching CI config, test config or the lockfile in the PR body, so a
check the agent made green by editing the check is visible to the reviewer.

Run lifecycle:

```
OM workflow                shim (host, has docker.sock)              per-run sandbox
CALL_WEBHOOK ──POST /runs──▶ authenticate, project allowlist, 202
                             mint GitHub App token (1h, 1 repo)
                             git clone --reference /mirror/<repo>  ─▶ /work/<runId>  (tmpfs)
                             docker network create run-<id>
                             compose -p run-<id> up -d  ───────────▶ [postgres] [redis] [meili]
                             wait healthy, seed
                             docker run --network run-<id> --cpus --memory --pids --user agent
                               OPENCODE_CONFIG_CONTENT=<perms+mcp> ─▶ [agent] opencode run --format json
                             read events: tokens, cost, tool calls      tests + code, repo checks
                             kill on cost/time breach                   against run-<id> services
                             on exit: diff scan (ci/test/lockfile) ◀─── commits on factory/<runId>
                             git push as bot, gh pr create, evidence in PR body
WAIT_FOR_SIGNAL ◀──POST /api/workflows/instances/{id}/signal { run: { status, prUrl, costUsd } }
                             finally: token discarded; stack kept as the preview until the review
                             route closes or its TTL expires, then compose down -v, network rm,
                             rm -rf /work/<runId>
```

Clones come from a per-repo git mirror on the VM refreshed by a timer (runs never write it);
dependencies install from a per-project package store, never a shared one.

Trust boundaries:

```
┌─ Open Mercato (control plane): tasks · triggers · propose-only agents · Caseload · traces ┐
│  holds: shared secret for the shim, nothing else                                          │
└──────────────┬───────────────────────────────────────────────▲────────────────────────────┘
  private net  │ POST /runs (bearer)                            │ POST …/signal (bot API key)
┌──────────────▼─ Runner VM ─────────────────────────────────────┴──────────────────────────┐
│  shim (root-equivalent via docker.sock); holds project bundles (RO), GitHub App key       │
│  ┌─ run-<id> network, egress allowlist ────────────────────────────────────────────────┐  │
│  │  [agent] non-root · limits · no socket · 1h repo token   [postgres] [redis] [meili] │  │
│  └─────────────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────────────┘
  allowed egress: github.com · model API · package registry · sentry (RO) · observability (RO)
  never: prod DB · secret manager · cluster · metadata IPs · other runs
```

Horizontal scaling, in stages:

```
  OM CALL_WEBHOOK ──▶ dispatcher (Redis queue) ── 202 / 429 when full; WAIT_FOR_SIGNAL is durable
  (retryPolicy)            │ pull          │ pull           │ pull
                    [runner VM 1]   [runner VM 2]   [runner VM n]   IaC count = n, cloud-init
                     3 slots         3 slots         3 slots        (memory-bound: ~8 GB per Mercato build)
```

1. **One VM.** Shim is dispatcher and worker; slots are memory-bound (32 GB ≈ 3 runs). Enough for
   dozens of runs a day.
2. **Dispatcher plus workers.** Dispatcher owns the queue and the GitHub App key; workers own
   their Docker daemon and pull jobs. Capacity is an IaC count; scale-to-zero overnight is a cron.
3. **VM per run** (snapshot, ~1 min boot) only if hardware-level isolation between clients is
   required. Stripe pre-warms devboxes to reach 10 s; nowhere near needed here.

Not Kubernetes Jobs: runs need a Docker daemon for the repo's compose stack, and containerd will
not lend one without DinD or sysbox. Backpressure needs nothing new: the webhook activity
retries, the signal wait is durable, the board and the Caseload show queued work, and per-project
daily cost caps live in the dispatcher.

### What is ours to build

| Piece | Size | Owner role |
|---|---|---|
| `tasks` module: delegation on the `staff` board (table, guard, card and drawer widgets), `set_status` / `link` / `create_followup` commands, `tasks.*` events, hook routes (Sentry, GitHub: PR opened, checks settled, PR merged) | small–medium | tasks owner |
| Workflow JSON, process definition, milestones and transition conditions, seeded from the module's `setup.ts`; the start subscriber | medium | process owner |
| Eight agents, three WSFF template skills, repo and task read tools | medium | agent author |
| Runner container and its two endpoints | medium | runner engineer |
| A target repo with one feature request and one seeded Sentry-shaped event; the demo script and the demo company's catalog ([SPEC-004](./SPEC-004-2026-09-18-demo-stal-zbiorniki.md)) | small | demo owner |
| Eval assertions on the sizer and slicer; the correction walkthrough | small | evals owner |

Core has no generic inbound-webhook endpoint (only `communication_channels` provider hooks), so
the hook routes are real code, roughly 60 lines each. Event names live under the `tasks.`
prefix; the orchestrator's trigger subscriber excludes `agent_orchestrator.` and `workflows.`
events to prevent recursion, which matters if a later process uses an event trigger directly.

### Known platform constraints (0.8.0)

Paths are relative to `node_modules/@open-mercato/`: `WF` = `core/src/modules/workflows`, `ENT` =
`enterprise/src/modules/agent_orchestrator`. **[upstream]** marks the ones worth an upstream issue.

1. **[upstream]** Event- or process-started runs have no actor; code-shipped workflows have no `createdBy` or
   grant, so `INVOKE_AGENT`/`UPDATE_ENTITY` refuse to run. Seed a DB row with `grantedFeatures`
   (`WF/lib/activity-executor.ts:1457-1465,1039-1042`; `ENT/workers/process-execution-starter.ts:56-59`).
2. Workflow-safe commands are off per tenant until enabled (`WF/lib/workflow-command-enablement.ts:118-124`);
   the shipped demo's `apply` step fails today for this reason.
3. **[upstream]** Process event triggers take no idempotency key, and the `.strict()` trigger config silently
   drops a trigger with unknown fields (`ENT/subscribers/process-event-trigger.ts:179-186`;
   `ENT/data/validators.ts:1144-1171`; `ENT/lib/tasks/triggers.ts:20-30`).
4. The trigger subscriber reads scope only from emit options; `createModuleEvents().emit` copies
   payload scope into options only for `clientBroadcast` events (`ENT/subscribers/process-event-trigger.ts:86-90`;
   `shared/src/modules/events/factory.ts:346-365`).
5. **[upstream]** The human-path resume ignores `outputMapping` and never passes the selected option id; the
   auto path names the proposal id differently (`ENT/lib/disposition/resume.ts:61-73`;
   `WF/lib/activity-worker-handler.ts:571-592`).
6. **[upstream]** `WAIT_FOR_SIGNAL` `timeout` is parsed and logged, never scheduled (`WF/lib/step-handler.ts:1337-1339`).
7. A process-started instance's correlation key is `process_execution:<processInstanceId>`,
   unreadable from the workflow context, so signals go by instance id (`ENT/workers/process-execution-starter.ts:199`).
8. **[upstream]** Scaffold: the app `tsconfig` does not exclude `agents/**/scripts/**` and `agents/**/tools/**`,
   which the file-agent sandbox needs (`ENT/AGENTS.md:186`).
9. **[upstream]** Scaffold: `.mercato/generated/file-agents.generated.ts` uses package-relative imports that
   fail typecheck in a standalone app; runtime resolves them through a fallback
   (`ENT/lib/sdk/defineAgent.ts:434-461`). Worked around with a post-generate script.

### Beyond code: the factory is a process, not a codebase feature

Nothing in the loop is specific to software. **Trigger → research → propose → decide → effect →
verify → learn** is the orchestrator's own model: researcher, decision-maker and action agents;
artifacts and proposals; disposition; effector through the command bus; corrections into evals.
The coding runner is one effector, and the `tasks` module does not know which effector will
close a task. SuperPlane's PRD reached the same generalisation from the other side: a work order
is the generic record and a pull request is one artifact type.

What does **not** transfer is verification. In code, "done" is mechanical and cheap (CI, tests, a
preview environment), which is why the human gate can move earlier and why the throughput claims
in *Prior art* exist. Where there is no CI (law, architecture, most of sales), "done" is a human
judgment, the agent stays propose-only, and the value is hours saved before the decision, not
autonomous throughput. Same machinery, different economic claim.

| Part | Generic (the orchestrator's) | Vertical (the reusable asset per domain) |
|---|---|---|
| Intake | task, trigger, dedup, initiator | which events create tasks |
| Thinking | research / decision agents, Caseload, evals | context sources and templates |
| Acting | disposition, effector, identity, audit | the effectors (coding runner, commands, posts) |
| Done | outcome record, cost | the check that proves done |

A domain is a good second target when three things hold: the system of record is one we run,
tasks originate as events in it, and "done" checks against data rather than opinion.

The persona that makes this concrete is the **business owner**: a manufacturer (in the demo, Marek
of Stal-Zbiorniki, a steel-tank maker; SPEC-004) who runs sales,
catalog and staff in Open Mercato and connects the company website's repo as a project. From one
board they delegate both kinds of work, and the valuable tasks cross the line: a new product in
the catalog becomes a product page; a drop in a product's sales becomes a proposed landing-page
change. Repo-only factories cannot see the trigger. The owner does not review diffs, so review is
routed by change class to the people who can (see *Who reviews*), and low-risk classes merge on
policy.

The trap to avoid: an "everything is a task" board with goals and KPIs on top is a horizontal
project-management tool, the most crowded category of 2026 (Linear and Jira agents, Plane, It's a
Plan). The `tasks` module stays an intake and a view; the orchestrator already provides the
decisions (Caseload, work inbox) and the metrics (outcomes per process plus cost from traces).
Start with one task class whose "done" is verifiable, code, and learn the gates, evals and
identity there; the second domain then shows which parts were generic and which were vertical.

For the hackathon this is one slide: the coding factory is the build, this section is the
roadmap.

### Prior art, and what it changed here

Researched 2026-09-15 to 17, every quoted source opened. The axis that sorts the evidence is
whether the operator owns the target repo's verification stack. Vendors do not, so every hosted
agent gates hard at the PR and forbids merging: GitHub's Copilot cloud agent "cannot approve or
merge a pull request" and "prevents the user who asked Copilot cloud agent to create a pull
request from approving it"; Jules has a plan gate that "will eventually auto-approve the plan,
which is set on a timer". That majority answer is a consequence of not owning the repo and does
not transfer to a team that does. The operator that shares that position and publishes outcomes,
Stripe, runs "over 1,300 pull requests … each week … completely minion-produced, human-reviewed",
one-shot, "at most two rounds of CI", in a "smaller box" of tools, and describes no design gate.
Design-first has one shipped enforcement, Kiro, which also ships a no-gate Quick Spec and
recommends gates only "when the review gates genuinely add value for your team"; HumanLayer still
reads the tests, and Marmelab's critique notes it adds a second review without removing the diff
review and is "mostly unusable" on large existing codebases. Lights-off exists in production only
Renovate-shaped: a declared change class, "will not automerge until it sees passing status
checks", and required reviews defeat it rather than being bypassed. Two public incident reports
show agents merging over a human hold and CI waits passing before the required check registered.
The data WSFF cites is soft (DORA is survey-based, METR walked back its 2025 slowdown, Faros is a
measurement vendor's correlations), so no numbers appear in the pitch.

**Warp Factories** (early access since 2026-08-18; factory-as-code schema published at
`app.warp.dev/api/v1/factory-files/schemas` and exemplified in the AGPL `warpdotdev/warp` repo's
bundled `factory-files` skill) arrived independently at the same shape as this spec: a
**foreman** that "decides and routes; it never executes" (our sizer); triage, spec, implement,
review and verify agents; "by default, the foreman waits for a person to approve the spec before
implementation starts" (our design gates) and "agents never merge; the foreman hands the finished
pull request to a human" (our merge rule); triggers from GitHub, GitLab, Linear, Jira, Slack,
schedules and signed webhooks with `sentry` among the signature schemes (our hook routes);
`credentialStrategy: EXECUTOR | CREATOR` with per-agent secret allowlists and inference
credentials "never injected into the sandbox" (our identity section); LLM-judge **scorers** with
a sampling rate (the orchestrator's `llm_judge`); and **benchmark suites** rebuilt from past runs
pinned to repository SHAs, which they used to cut their own cost per PR from $80 to $30 (the
orchestrator's eval cases plus a repo ref). The differences are ownership, not mechanics: Warp's
control plane is their SaaS and their orchestration logic is proprietary, only the client and
the schema are open, and merge enforcement is delegated to branch protection exactly as here.
Their "Factory MCP", moving a task between a local agent and the factory, is the model for the
`factory_send_task` tool below. Convergence with a well-funded vendor is evidence the shape is
right; it also means the mechanics are not the differentiator. What is: a control plane the
client already runs (Open Mercato), owned data and inference, and the readiness work that makes a
client repo verifiable at all.

Three consequences are folded into the design decisions below: size routing is the thesis and the
design gates are confined to `large` and skippable; automerge, when it comes, is Renovate-shaped;
and the bot cannot approve its own PR nor the initiator be its only approver. Nobody publishes
outcomes for design-gated factories at scale, so the first month on a real target measures
rework per PR, corrections per phase and sizer routing accuracy from the orchestrator's own
traces.

### Alternatives considered

- **Build the control plane as our own Mercato module.** Lost: the orchestrator ships every
  entity such a module would need, with tenancy, audit, evals and a UI we would not build by
  Sunday. The `tasks` module is the only new domain, and it is intake, not orchestration.
- **Use an external tracker (Linear, Jira) as the intake instead of a `tasks` module.** Lost for
  the build: it adds a webhook, an integration identity and a second source of truth for status
  before anything works, and the board would live outside the app that holds the decisions. An
  external tracker can still feed the module later through a hook that creates tasks.
- **Model design phases as proposals** so edits feed the flywheel. Lost for now: it needs a fake
  single-option proposal with a `SET_VARIABLE`-style action, which lies about what the agent
  decided. Revisit if upstream adds dispositions on artifacts.
- **cezar (open-mercato/cezar, 0.11.0 as of 2026-09-15).** A developer's cockpit for parallel
  coding agents: worktree per task, Claude/Codex/OpenCode/pi per step, workflows with shell
  checks, live streaming, per-run cost, a binary review gate on every diff, a GitHub merge box,
  task dispatch with review children, and automations (GitHub poll for four events, schedules).
  No database, no accounts, one unix user behind basic auth; agents run on the host under the
  operator's CLI login with full shell access in the worktree (its README's own words). It is a
  layer below this spec, not a rival: no production-event triggers, no risk-tiered policy, no
  isolation suitable for client repos, no roles or audit, no evals. It stays an interactive
  cockpit, not the runner. Cheapest upstream contribution if asked "why not cezar": an `event`
  automation kind fed by the orchestrator or Sentry, beside its `github` and `schedule` kinds.
- **SuperPlane (superplanehq/superplane, Apache-2.0, Go, by Semaphore).** The closest open-source
  control plane: an "open source factory for one-shot engineering" with **work orders**
  (`draft → open → closed` with an explicit result), **lines** of steps that run canvas apps,
  executions with cost, PR and artifact records, and 400+ integration components including a
  Sentry issue trigger, Daytona sandboxes, cloud servers, and `claude.runCodeAgent`, which runs
  the coding work in Anthropic's managed sandbox and opens the PR. Its stated gate is "one human
  review after the required automated checks pass", with a confidence score deciding which
  backlog items agents may take; commits from 2026-09-17 add `propose_spec` for written plans.
  Factories are still behind an experimental flag, self-hosting is documented only as the
  Docker-based contributor setup, and the domain model is a general automation canvas with a
  factory bolted on, not a process engine with agent principals, dispositions and evals. It is
  the right answer for a team without a platform; here it would be a second control plane beside
  the app the client already runs, with its own auth, tenancy and audit. Its design doc
  (`docs/design/factory.md`) lists work orders from external systems, the approval flow and
  auto-close as not implemented, so the two things this spec needs most, event intake and the
  human gate, are the two it lacks today. Borrowed: the explicit `done | rejected | failed` close
  result for tasks, and its **check handler**, which waits for GitHub checks on one PR revision
  and starts one bounded fix run when they fail. **Entry trigger:** for a team that cannot take
  the enterprise licence, or if the factories layer gains external intake and approvals,
  SuperPlane self-hosted becomes the control plane; the agents, templates and runner contract
  carry over unchanged. Re-check 2026-11-15.
- **It's a Plan (croffasia/itsaplan, AGPL-3.0).** A self-hosted tracker (Linear/Jira/Plane
  alternative) where an issue can be assigned to a hosted or local agent, with cron-scheduled
  agent runs and MCP. It is a work-intake surface, not a factory: no design gates, no runner
  isolation, no policy. What it changed here: **assignment is the trigger**, which is the whole
  shape of the `tasks` module.
- **Warp Factories as the base** (see *Prior art* for the mechanics). Rejected for reasons that
  have nothing to do with quality: it cannot run for a client inside the client's own platform,
  it is invite-only, and self-hosted execution is Enterprise-only. What it changed here: cost per
  PR as a first-month number, replayable runs, harness as a per-run field, inference credentials
  kept at the boundary (open question), the `factory_send_task` seam, and the file layout in
  decision 7, so a port is mechanical if needed.
- **Human reviews code inside Open Mercato.** Rejected: GitHub is the diff UI and CI is the
  verdict. Open Mercato reviews decisions, not diffs.

## Design

The board is the core `staff` task board with two `tasks` widgets, a card badge and a drawer
section (see SPEC-002 *Design*), plus the "Changes" drawer panel and the run view (see SPEC-003
*Design*); no storyboard yet.
Every other screen is the orchestrator's own (process instances, Caseload, traces, Playground).

## Data Models

Tasks, projects and comments are `staff`'s (`staff_time_tasks`, `staff_time_projects`,
`staff_time_task_comments`). The `tasks` module's own tables (`tasks_delegation`,
`tasks_process_write`) are specified in
[SPEC-002](./SPEC-002-2026-09-18-tasks-module.md#data-models). Processes, instances, runs,
proposals, user tasks, traces, corrections and eval cases are the orchestrator's own. The runner
persists nothing. What this spec reads from a task: `reference`, the project id (selects target
repo, base branch and credential bundle), `parentTaskId`, the status column slug, the assignee,
and from the active delegation `delegate_user_id`, `id` (the `delegationId`), `delegated_by`,
`process_instance_id`, `links`, `outcome` and `close_reason`. Intake dedup (`source` +
`source_ref`) arrives with the first hook.

Enablement is configuration: `planner`, `resources` and `staff` from `@open-mercato/core` in
`modules.ts`, `OM_ENABLE_ENTERPRISE_MODULES=true` and
`OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`, then `yarn generate`, `yarn db:migrate`,
`yarn mercato auth sync-role-acls`, `yarn mercato seed:defaults --module tasks`.

Encryption note: with `TENANT_DATA_ENCRYPTION=yes`, `ProcessInstance.input`, agent run input and
output, and proposal payloads are encrypted at rest. Reads through the ORM are fine; raw SQL shows
ciphertext.

## API Contracts

Ours, in the `tasks` module:

- Delegation routes, the guard interceptor on `staff`'s task commands, events and the three
  workflow-safe commands (`tasks.task.set_status`, `tasks.task.link`, `tasks.task.create_followup`,
  `requiredFeatures: ['tasks.process']`, idempotent on (taskId, processInstanceId, stepId)):
  see [SPEC-002](./SPEC-002-2026-09-18-tasks-module.md#api-contracts). Task, project and comment
  CRUD is `staff`'s. ACL features `tasks.view`, `tasks.delegate`, plus `tasks.process`, held only
  by the workflow's execution principal through `grantedFeatures` (with
  `staff.timesheets.tasks.manage`).
- Subscriber `start-factory` on `tasks.task.delegated`: starts `factory.deliver` through
  `startExecution` with the idempotency key (see *The process*); a subscriber on
  `tasks.task.undelegated` cancels the instance.
- `POST /api/tasks/hooks/sentry`: Sentry issue-alert webhook, HMAC verified with the Sentry client
  secret; creates (or dedups on `source_ref`) a `staff` task delegated to the factory agent, with the
  project's default assignee. Drops anything
  below the configured event count.
- `POST /api/tasks/hooks/github`: signature verified. `pull_request.opened` creates a review task
  delegated to the factory agent and **drops PRs authored by the bot** (loop guard).
  `check_suite.completed` and `workflow_run.completed` on a `factory/<runId>` branch resolve the
  task from the branch name, and its linked workflow instance, and send the signal
  `factory.checks.settled { sha,
  conclusion, failing: [{ name, url, summary }] }`; only required checks read from branch
  protection count. `pull_request_review.submitted` with `approved` on a factory branch signals
  `factory.pr.approved`. `pull_request.closed` with `merged` on a factory branch sets the task `done`.
- MCP tool `factory_send_task { projectKey, title, body, links[] }`: the seam between an
  interactive coding session and the factory. A research or brainstorm session ends by handing
  its result to the factory in one call instead of a human copying it into a ticket (Warp's
  `send_task`). It creates a task with `source: mcp`, delegated to the factory agent, with the
  session's user as initiator.

Ours, on the runner: `POST /runs` and `POST /review-comment` as above, bearer-authenticated with a
shared secret held only by the Open Mercato server and the runner.

Consumed unchanged: the `agent_orchestrator.processes.startExecution` command (also
`POST /api/agent_orchestrator/processes/{id}/executions` for a manual start, 202),
`POST /api/workflows/instances/{id}/signal`, `POST /api/workflows/tasks/{id}/complete`,
`POST /api/agent_orchestrator/proposals/{id}/dispose`.

`factory.run.finished`, `factory.checks.settled` and `factory.pr.approved` are signal names, not events.

## Implementation Approach

Ordered for the hackathon; each step is worth having if the next one never lands.

1. **Friday, 18:15 kickoff.** Team formation, roles assigned, the scenario strips written in 45
   minutes, the target repo and feature chosen. Confirm the app boots with the enterprise agents
   module (the OpenCode sidecar is optional until an agent moves to file-defined). Create the
   GitHub App, install it on a throwaway target repo, keep its private key on the runner host
   only. One LLM provider key. In parallel: `staff` enabled and the `tasks` delegation table and events, the OUTCOME schemas and
   WSFF templates (they need no running app), and the runner container skeleton.
2. **Saturday morning: the minimal chain.** `tasks.task.delegated` → `factory.deliver` → queued
   and linked → `factory.sizer` → Caseload approve → in_progress → stub runner → signal →
   in_review. Nothing real inside, everything wired.
   - Module files in `tasks`: `acl.ts` (per SPEC-002); `commands/` for `set_status` and `link`, idempotent on (taskId,
     processInstanceId, stepId); `events.ts`; `workflows.ts` with `registerWorkflowSafeCommands`;
     `subscribers/start-factory.ts`; `ai-agents.ts` plus `data/validators.ts` for the one-option
     sizer; `workflows/factory-deliver.json`; a dev-only, feature-gated
     `api/dev/runner-stub/route.ts` that answers 202 and signals `factory.run.finished` about two
     seconds later with a fake PR URL.
   - Seed, in `setup.ts` `seedDefaults`: the workflow row via `upsertOwnedDefinition` with
     `grantedFeatures: ['tasks.process']`, the `ProcessDefinition` (manual trigger, milestones
     `sized` and `pr_open`), the tenant enablement of the two commands, the `factory` agent
     principal. Then `yarn generate && yarn mercato seed:defaults --module tasks`.
   - Env: `OM_AI_PROVIDER=anthropic`, `OM_AI_MODEL=claude-haiku-4-5-20251001`,
     `ANTHROPIC_API_KEY`, `OM_WORKFLOWS_ALLOW_PRIVATE_URLS=true` (dev), `APP_URL` on the dev
     server's real port.
   - Smoke test: assign a task to the agent; the execution appears under processes and the task
     goes `queued`; the sizer's proposal appears in the Caseload (or auto-approves); approve it;
     the task goes `in_progress`, then `in_review` with the PR link; `milestones_reached`
     contains `sized` and `pr_open`. Check in the same run that the agent-`reject` condition route
     (priority 200) wins over the default approved route.
   The design USER_TASKs and the slicer are added to this chain in the afternoon.
3. **Saturday afternoon.** Real agents in via the Playground first, then the workflow. Runner
   opens a real PR on the target repo. Put the artifact-gate question to the module authors at the
   event. **Runner fallback at 16:00:** if the container is not opening PRs, the `CALL_WEBHOOK`
   targets Anthropic's Claude Managed Agents instead (a hosted sandbox with a scoped GitHub token
   that clones, commits, pushes and opens the PR itself; SuperPlane's code-agent component is
   built on it). Same contract, no infrastructure, and a live test of decision 5's "replaceable".
   Availability and the exact API are unverified as of 2026-09-18; the process owner checks them
   on Friday. If that fails too, the effector's last action opens a GitHub issue carrying the
   approved design.
4. **Saturday evening.** Sentry hook with a replayed payload, the board widgets, follow-up tasks from
   the reviewer, eval assertions, the correction walkthrough, one timed dry run of the five-minute
   demo. Stretch, cheap because the module ships it: run the sizer's eval suite with two models
   and show the `cost` and pass-rate delta in the workbench. Second stretch: the business-data
   scenario (`catalog.product.created` → product page PR with preview on the target repo), which
   reuses the whole chain and needs only the subscriber and a seeded product.
5. **Sunday.** Fix only what the dry run broke. **Freeze at 11:00.**

Fallback demo at every stage: the `factory.status` process (schedule → artifact → USER_TASK →
post) has no runner dependency.

Test strategy: the orchestrator's own Playground for every agent (seconds, no DB); `__tests__` for
the `tasks` commands (legal and illegal transitions, idempotency on replay) and the hook routes
(signature accepted, bot author dropped, dedup on `source_ref`, checks signal resolved from the
branch name); one integration run of the stub chain kept green all weekend as the smoke test.

After the hackathon, in order: lift the `tasks` and `factory` modules into a standalone npm
package; decide the production host and the enterprise licence (Open Questions); wire one real
target's Sentry as the first real trigger with the daily cap and no automerge. Two changes ride
along: the runner consumes a `devcontainer.json` per repo instead of a compose-file convention
(this is also the concrete deliverable of "make this repo agent-ready"); and the first month's
traces feed four numbers, rework per PR, corrections per phase, sizer routing accuracy, and
**cost per PR split into inference and compute**, which decide whether the design gates earn
their place and which harness and model each run class should use. Two more borrowed from Warp
once traces exist: a **benchmark suite rebuilt from past runs** (the orchestrator's eval cases
plus the repo and module SHAs the runner records on every run, rerun against two models with the
`cost` scorer to pick the cost/quality point), and a **local handoff in both directions**:
`factory_send_task` pushes a session's result up, and a person can pull a parked task down into a
local coding agent and push it back. A fifth view, human PRs and factory PRs per week side by
side without framing it as a race (SuperPlane's velocity tab), goes on the board.

## Key Design Decisions

1. **Build on the orchestrator, not beside it.** Every primitive the factory needs exists
   upstream as of PR #5718. Building our own would cost the weekend and diverge from the platform
   the client runs. Warp Factories, Stripe and this spec converge on one shape; the choice here is
   a control plane the client already owns rather than a vendor's.
2. **Everything is a task; the board stays thin.** A `tasks` module is the single intake: human
   delegation, alerts, PR hooks and the MCP seam all become a task delegated to an agent while a
   human stays assignee, and one event triggers the process. Status changes only through workflow-safe commands. No goals, KPI
   or planning layer: that is a crowded horizontal category and the orchestrator already provides
   decisions and metrics.
3. **Route by size; design gates only where a plan line is worth more than a diff line.**
   Single-shot items (alerts, reproducible bugs) go straight to PR plus CI, the Stripe shape. Only
   `large` gets the WSFF gates, each skippable per definition the way Kiro's Quick Spec is. The PR
   is reviewed in every path, in GitHub, by CI and a person; the gates never remove that review,
   and Open Mercato never shows a diff.
4. **Artifact plus USER_TASK, not fake proposals.** Truthful modelling over a flywheel shortcut.
5. **Runner is stateless and replaceable.** One HTTP call in, one signal out, any harness, any
   model provider. The self-hosted shim on a dedicated VM is the default because runs need the
   repo's compose stack and client secrets that should not go to a third party. A rented sandbox
   behind the same contract is allowed: Ramp (Modal), WorkOS (Cloudflare) and SuperPlane (Claude
   Managed Agents, Daytona) all rent the sandbox layer and own the control plane, and the
   hackathon fallback in step 3 is exactly that. What is not allowed is a rented control plane,
   which is where the decisions, the audit trail and the client's data live. The workflow, not
   the effector helper, calls the runner, so the risk ceiling gates the call.
6. **No automerge, and one slice per run.** When merge policy for boring change classes comes, it
   is Renovate-shaped or nothing: a declared change class, required checks read from branch
   protection rather than observed CI, the bot never arms or re-arms automerge, and a human hold on
   a PR is terminal. The review waiver (see *Who reviews*) is that policy: a project-listed change
   class, required checks green, merged by a merge identity separate from the coding bot, never
   on the agent's say-so. Follow-ups get no delegate, so the factory never feeds itself.
7. **Portable from the first commit.** Local modules with `agents/<name>/AGENT.md` plus its
   `skills/`, `workflows/`, `runners/<name>.yaml` (image, setup commands, instance shape) and
   `api/`; the same file shapes Warp and SuperPlane consume, so a port is a directory move.
8. **Author is never reviewer.** The bot cannot approve its own PR and the person who delegated
   the task cannot be its only approver (Copilot's rule). Branch protection enforces it; the
   factory does not rely on prompts.
9. **Machine identity per client, capability per run.** Initiator, actor and capability are three
   records (see *Identity*): provider installation primitives rather than login accounts, bundles
   minted at dispatch and tiered by run class, client-visible writes through the control plane,
   model access by API key per client.
10. **Code first, because verification is cheapest there.** The loop is domain-agnostic, the
    definition of done is not. The second domain is chosen where the system of record is ours,
    tasks originate as events in it, and "done" checks against data (see *Beyond code*).
11. **Reviewers are routed by change class, not fixed.** An engineer, a lawyer, both in parallel,
    or none by waiver; the route takes the maximum of deterministic signals and the agent's
    declared risk, so an agent can raise its risk but never lower it. Engineers review in GitHub,
    everyone else in the Caseload, against a per-run preview.

## Open Questions

- **Enterprise licence for production.** [`@open-mercato/enterprise`](https://github.com/open-mercato/open-mercato/blob/main/packages/enterprise)
  is source-available; non-production use is fine, production use needs an enterprise licence.
  Each team reusing this checks the terms before deploying. Resolves: per adopter.
- **Artifact gate ergonomics.** A `USER_TASK` shows a form, not the artifact; the artifact lands
  in the context as `<stepId>_agent: { artifacts, summary }`. Does the work inbox render it
  inline, or do we link the artifact URL in the task description (and on the board card)?
  Resolves: Saturday morning, first stub run.
- **Choosing among options.** The human-path resume does not pass the selected option id, so the
  sizer and slicer return one option each. Real multi-option choice (the operator picks slice 2
  of 4) needs a `tasks` command that reads `AgentProposal.selectedOptionId` by (instance, step),
  or an upstream fix (constraint 5). Resolves: after the hackathon.
- **Authenticating the call to the runner.** `CALL_WEBHOOK` injects no auth and secrets must not
  come from `{{env.*}}`. The shared secret for `POST /runs` therefore needs an `EXECUTE_FUNCTION`
  registered in the module's `di.ts` that reads it server-side, which has no ACL gate of its own.
  The stub needs neither. Resolves: when the real runner is wired, Saturday afternoon.
- **Signal timeout watchdog.** The runner signals `failed` on its own timeout, but a runner that
  dies silently leaves the instance parked forever. A `tasks` scheduled job that fails instances
  parked past a deadline, or an upstream fix (constraint 6). Resolves: after the hackathon.
- **Definition versioning.** `upsertOwnedDefinition` updates the row in place, so in-flight
  instances pick up graph edits on re-seed. Acceptable for the hackathon; decide on versioned
  workflow ids before the first real target.
- **Inference credentials at the boundary, not in the sandbox.** Today the provider key is in the
  runner's env, so a prompt-injected run could exfiltrate it. Warp never injects inference
  credentials into the sandbox; the equivalent here is an LLM gateway on the runner VM holding the
  key and a per-run token inside the container. Decide before the first real target is wired; the
  hackathon accepts the env key.
- **Runner host after the hackathon.** One persistent VM with a container per run is the default.
  Resolves: when the first real target is wired.
- **Environment contract for the runner.** Compose by convention now; `devcontainer.json` as the
  contract later. Decide before the first client repo is wired.
- **Waiver merge mechanics on GitHub.** The waiver needs a merge identity (a second GitHub App)
  allowed past the required-review rule for waiver classes only, e.g. a ruleset bypass for that
  app, while the coding bot stays unable to merge. Confirm rulesets can express this per PR rather
  than per branch. Resolves: before the first waiver is enabled. The demo site takes the simple
  form, one ruleset on `main` with a bypass for the merge App and a required approval that the
  coding bot cannot give itself ([SPEC-005](./SPEC-005-2026-09-19-stal-zbiorniki-www.md)).
- **Preview hosting and cost.** SPEC-003 keeps previews on the runner VM behind a per-project
  cap. Still open: hand off to the repo's own preview environments where they exist. Resolves:
  when the first real target is wired.
- **Rendered-text diff for non-code reviewers.** What a lawyer sees: a text diff extracted from the
  preview's pages before and after, or the source diff of content files. It would render in
  SPEC-003's change entry for the run. Resolves: with the legal route.

## Changelog

<!-- Record, not state: rows are closed once dated — append, never rewrite. -->

| Date | Change |
|------|--------|
| 2026-09-18 | Ported from an internal draft; `tasks` module added as intake. |
| 2026-09-18 | Hookup mechanics verified against 0.8.0 packages; process wiring, trigger, signal and seeding corrected. |
| 2026-09-18 | Business-owner persona and business-data scenario; review routing by change class (developer, legal, waiver) with per-run previews. |
| 2026-09-18 | Linked the orchestrator architecture brief (`docs/agent-orchestrator.md`). |
| 2026-09-18 | `tasks` module moved to SPEC-002: human assignee plus agent delegate, trigger renamed to `tasks.task.delegated`, projects as records. |
| 2026-09-18 | Tasks, projects, the board and comments now come from the core `staff` module (SPEC-002 rebuilt on it); `tasks` keeps delegation, the guard and the workflow-safe commands; configuration keys on the project id. |
| 2026-09-18 | Non-code effects and run visibility moved to SPEC-003: `factory.operator`, the `non_code` branch through one effector function with compare-and-set, catalog-correction and support-reply scenarios, action rows in the review map, the runner manifest and progress events. |
| 2026-09-18 | Demo storyline and company moved to SPEC-004 (Stal-Zbiorniki, a steel-tank manufacturer); catalog-correction example now ZDP-5000. |
| 2026-09-19 | Demo target site (SPEC-005): waiver merged by a second App via a ruleset bypass; `factory/catalog-match` status as a waiver condition; repo-hosted previews. |
| 2026-09-19 | MCP intake tool `factory_send_task` superseded by `factory_tools.create_task` (SPEC-006): one write tool served by the Open Mercato MCP server, `{ project, title, description, delegate?, agentUserId?, links?, clientRef? }`; source recorded as a task footer until the `tasks_intake` table exists. |
