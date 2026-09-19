# SPEC-002: Task delegation module (`task_delegation`): agent delegation on the staff task board

**Status**: In progress (P0–P2 code complete; P2's integration exit gate and P3 remain open)
**Owner**: HackOn team · **Date**: 2026-09-18 · **Tracker**: —
**Parent**: [SPEC-001](./SPEC-001-2026-09-18-agentic-software-factory.md), which consumes this
module's `task_delegation.task.delegated` event and its three workflow-safe commands.

## Implementation Status

Source doc: `docs/specs/SPEC-002-2026-09-18-tasks-module.md`.

The approved local slice reuses the staff board and adds delegation, permissions, run state, and retry/stale-write protection. Publishing, provider configuration, catalog price writes, paid inference, VPS deployment and self-deployment are outside this slice.

| Phase | State | Dependencies | Acceptance | Exit gate |
|---|---|---|---|---|
| P0: ordered writes on unpatched staff | done | none | Claim-then-move delegation with compensation; no framework patches | Unit coverage of write order and rollback; ephemeral browser run |
| P1: delegation commands and process start | done | P0 | Phase 1 cases below | Functional commands and restart/stale-write coverage |
| P2: API and staff widgets | code complete, exit gate open | P1 | Phase 2 cases below | Scoped API and board/drawer integration tests — the board/drawer cases are covered at unit level only |

### P0 progress

- [x] Baseline application installation and generation: `corepack yarn install --immutable --mode=skip-build`, `corepack yarn generate`, and `corepack yarn typecheck` passed.
- [x] Source verification: staff 0.8.0 ignores `transactionalEm` and commits each command on its own.
- [x] Dropped the Core/shared Yarn patches (a local Core fork adding managed command transactions). The module runs on the published 0.8.0 packages; see [Write ordering without a shared transaction](#write-ordering-without-a-shared-transaction).
- [x] Application delegation commands, guards, APIs and widgets are implemented and unit-tested (`yarn jest src/modules/task_delegation`: 30 suites, 172 tests). No production workflow run or runtime database migration has been performed.

### Application verification in progress (2026-09-19)

- Migration and snapshot generated with the installed CLI database generator restricted to the tasks module. The normal CLI iterates installed package modules too, so this scoped probe avoids writing shipped migrations.
- `corepack yarn tsx scripts/verify-task-delegation-schema.mjs` verifies the generated DDL on a disposable loopback database with `TASK_DELEGATION_TEST_DATABASE_URL`. It checks active-delegation uniqueness, delegation history after release, receipt uniqueness, organization isolation and distinct executions. The entire test schema is rolled back. No migration has been applied to the developer runtime.
- API/widget tests currently cover scoped admission, guarded-payload validation, batched reads and event refresh. Read-only AI tool tests cover scope, project access and bounded queries. Command composition, app integration and final review remain required.
- The first application correctness/security review identified execution-principal binding, undo admission, stale-version checks, delayed start/cancellation, workflow registration and event privacy defects. All six now have implementations with tests: `lib/processAuthority.ts`, the `beforeUndo` admission guard in `commands/interceptors.ts`, `commands/__tests__/optimistic-lock.test.ts`, `subscribers/cancel-on-undelegated.ts`, `workflows.ts`, and server-only event scoping in `events.ts` (only `task_delegation.task.changed` is `clientBroadcast`).
- Installed orchestrator limitation: `startExecution` persists a process before queue publication, while a retry deduplicates without re-enqueueing. A crash in that interval can leave a persisted execution unqueued. Automatic crash recovery is blocked pending a framework recovery contract/outbox; it is not covered by the approved Staff correction or by the `starting`/`stalled` presentation. This acceptance item must remain open. Durable cancellation before workflow creation and safe process-start claiming also require orchestrator changes. Workflow activity interpolation currently exposes the workflow instance id, while task commands require the separate process execution id; an orchestrator-owned context contract is still required. The delivery process and agent-principal seed and the DEMO project seed now exist (`lib/demoSetup.ts`, and the process seeded from `src/modules/website_publishing/`); a real shared command transaction was dropped by design in favour of ordered writes with compensation, because `staff` 0.8.0 commits each command separately. Full browser acceptance remains incomplete.

### Write ordering without a shared transaction

Staff 0.8.0 commits each of its commands separately, and a Core fork to make them join our transaction was not worth carrying for this feature. Instead every tasks command orders its writes so a failure leaves a state the board can show and a user can clear:

- **Delegate**: validate everything first, then claim the delegation (the active-delegation unique index settles concurrent claims), then move the task to `in-progress` through staff's command. If the move fails, the claim is deleted. A crash between the two leaves a delegation without a run on a Backlog task; the badge shows it as `stalled` after a minute, and "Remove delegate" clears it.
- **Undelegate**: move the task back to `backlog` while the delegation still authorizes it, then release. A retry after a failed release finds the task in Backlog and only releases.
- **Process commands** (`set_status`, `link`, `create_followup`): move the staff task first, then write the delegation change and the step receipt in one flush. A retried step finds the task already moved and only records the outcome. `create_followup` is the exception: a crash before the receipt is written can create a second follow-up on retry.
- **Assignee closes a delegated task**: the guard's `afterExecute` releases the delegation after staff commits the move. It is best effort; if it fails, the task sits in Done/Backlog with a live delegation until "Remove delegate".

Nothing locks staff rows. Stale edits are caught by the optimistic version check staff already applies to status changes. Staff interceptors receive the caller's `auth` object but not the command context, so the single-use column-move authorization is keyed by that object. App code reads staff tasks through the query engine, never staff's private entities. No request-body flag may bypass task guards.

## TLDR

Tasks, projects, the Kanban board, the task drawer and comments come from the core **`staff`**
module (time tracking), enabled as it ships. Our `task_delegation` module is a thin layer on top that adds
what `staff` doesn't have: an agent **delegate** next to the human assignee, the process-owned
status columns, and the contract with SPEC-001's process.

A staff task has a human **assignee**, who is accountable for it. Setting an agent delegate emits
`task_delegation.task.delegated`, and that event is SPEC-001's only start path. After that, the process owns
the task's status. A badge on the card shows the linked run's live state, and the drawer shows the
delegate, the run, the PR and the pending decision. References come from `staff` (`WEB-12`), so
"Fixes WEB-12" in a PR is unambiguous.

The MVP is **manual only**: a person creates the task and a person delegates it. Webhooks
(Sentry, GitHub), MCP intake and domain-event intake come later.

## Problem Statement

SPEC-001 needs one event and three commands from `task_delegation`. People need more than that:

- **Ownership.** When an agent works a task, someone must still answer for it. With a single
  assignee slot that holds either a human or an agent, the owner disappears the moment the
  agent is assigned.
- **Liveness.** After delegation, the card has to show within seconds that something picked
  the task up. Otherwise people delegate twice or assume it's broken. Linear enforces a
  10-second acknowledgement from agents for this reason.
- **Traceability.** A PR, a Caseload decision and a run must all point back to one task by a
  name that humans can type.
- **Discussion.** The Caseload holds decisions. Context for the task ("the customer meant the
  EU site") needs a place on the task itself.

Building a board, a drawer, projects, references and comments for this is a weekend on its own.
`staff` 0.8.0 already ships all of them, so the factory only builds the delegation layer.

## User Stories

- **Product owner** creates a task on the `WEB` project board. It becomes `WEB-12`, assigned to
  them, in `Backlog`. In the drawer they set the delegate to "Software Engineer", and within a second
  the card moves to `In progress` with a delegate badge, then the badge shows the pending Caseload
  decision. They remain the assignee throughout. A user without `task_delegation.delegate` sees no delegate
  picker.
- **Engineer** opens `WEB-12` from a PR titled "Fixes WEB-12". The drawer shows the delegate, the
  run link, the PR, the Caseload item, the parent task and the comments.
- **Team lead** opens the project board. Each card shows the reference, title, assignee and a
  delegate badge with the live run state.
- **Product owner** removes the delegate before the sizer decides. The run is cancelled and
  the task goes back to `Backlog`. Removing it after the sizer has decided is refused: the drawer
  points to the Caseload, where the decision now sits. When a run fails, the task returns to
  `Backlog` with a `Failed` badge carrying the reason, and the owner can delegate it again.
- **Product owner** sees the PR merge in GitHub and drags the `In review` card to `Done`. The MVP
  has no merge hook, so the assignee is allowed to make this one move while the task is still
  delegated. Every other drag of a delegated card is refused.
- **Reviewer agent** (SPEC-001) produces findings. They appear as subtasks with the same
  assignee and no delegate, and wait there until a human delegates them.

Chat intake (next iteration, storyboarded now; see *Chat intake*):

- **Business owner** opens the AI assistant on a product page, attaches the product, and writes
  "the product page on the website still shows last year's price". The intake agent asks one
  question (which project), then proposes `WEB-13` delegated to the Software Engineer in OM's
  standard "Review proposed changes" card. They confirm and get a link to the task; everything
  after that happens on the board and in the Caseload, not in the chat.
- **Business owner without `task_delegation.delegate`** gets the same card without the delegate, and the
  task lands in `Backlog` for someone who can delegate it.
- **Anyone** asks "what's happening with WEB-12?" and gets the column, the run state and the
  pending decision from `task_tools.get_task` and `task_delegation.get_delegation`, with links. The chat never shows run progress itself.

## Proposed Solution

### What the prior art settled

Researched 2026-09-18. Every source below was opened, and the quotes are verbatim; the full
record is in `.context/prior-art/`. The question that sorts the evidence is whether the tracker
runs the agent or only shows an agent that runs elsewhere. Ours only shows it, because
SPEC-001's orchestrator runs it. That makes **Linear** the comparable system. Jira + Rovo,
Plane and It's a Plan run their own agents and serve as contrasts.

- **Assignee plus delegate.** Linear: assigning an issue to an agent "sets it as the
  `delegate`, not the `assignee`—so humans maintain ownership while agents act on their
  behalf." Jira ("An agent shows up as an assignee"), Plane and It's a Plan put the agent in
  the assignee slot, for familiarity. We take Linear's split, because SPEC-001's identity model
  already separates the initiator from the actor.
- **Fixed meanings, named statuses.** Linear keeps statuses within fixed categories ("the
  categories themselves stay in a fixed order"). Plane: "The group is the meaning Plane
  attaches to the state; the name is your label for it." `staff` works the same way: a column's
  slug is frozen and its name is a label. The process addresses columns by slug.
- **Sessions vs derived state.** Linear models agent work as sessions with six states and
  typed activities. We already have the orchestrator's instance, Caseload and traces, so the
  card derives its state from those instead of storing a second copy.
- **PR linking by key.** It's a Plan: "'Fixes KEY-42' links the pull request to the issue".
  `staff` references (`{projectCode}-{n}`, frozen at creation) give us this.

### Built on the core `staff` task board

We enable `planner`, `resources` and `staff` from `@open-mercato/core` 0.8.0 as they ship and
extend them only through their public extension contract: commands, events, command
interceptors, injection spots and the command bus. We never import `staff`'s `lib/` or UI.

What `staff` provides, verified in `core/src/modules/staff`:

- **Projects** (`staff_time_projects`) with a `code`, and **tasks** (`staff_time_tasks`) with a
  race-safe, frozen `reference` (`lib/timesheets-tasks/taskReference.ts`), one level of subtasks
  (`parentTaskId`), one assignee (`assigneeStaffMemberId`, a staff member linked to an
  `auth.User`), tags and comments (`staff_time_task_comments`).
- **Per-project status columns** (`staff_time_task_statuses`): every project is seeded with
  `backlog` (default), `in-progress`, `in-review` and `done` (`isDone`). The slug is derived from
  the name once and then frozen (`statusSlug.ts`), and a column holding tasks cannot be deleted.
- **The board and the drawer** at `/backend/staff/time-tracking/board?projectId=…`, with drag and
  drop, an optimistic lock (409 on a stale version) and filters by assignee, tags and text.
- **Undoable commands** `staff.timesheets.tasks.{create,update,delete,status_change}` and
  `staff.timesheets.task_comments.*`, and the event
  `staff.timesheets.time_task.status_changed` (`clientBroadcast`, carries the old and new status).
- **Injection spots**: `staff.time_task.board:card-badges` and `:card-footer` on the card
  (context `{ taskId, timeProjectId, taskStatusId }`), and
  `detail:staff:staff_time_task:{header,sidebar,tabs,footer}` in the drawer (context `{ taskId,
  timeProjectId }`).

What we accept by reusing it:

- The board lives in the Staff area, next to time tracking, with a timer on the card.
  `planner` and `resources` come along as dependencies.
- The board shows one project at a time; there is no cross-project board.
- Creating a project requires a customer, so the seed creates an "Internal" company.
- Assignees must be staff members. A user holding `staff.timesheets.projects.manage` sees every
  project; anyone else needs a staff member and an active project membership.
- There is no priority field; tags cover it when needed.
- `staff` custom fields are declared but dropped by its API, so the delegation lives in our own
  table, keyed by the task id.
- `staff` doesn't validate status transitions. We guard the ones that matter with a command
  interceptor (see *Who writes status*).

### The module

`src/modules/task_delegation`, an ordinary app module. It has two entities (delegation and
process write), the delegate and un-delegate commands, a command interceptor on `staff`'s task
commands, two injection widgets, events, ACL features, read-only AI tools, and the workflow-safe
commands SPEC-001 calls.

**Status columns.** The board is `staff`'s four default columns; the factory adds none. The
process phases before review share `In progress` (the card badge carries the finer run state),
and a run that ends without shipping returns the task to `Backlog`, where it can be delegated
again:

| Lifecycle (SPEC-001) | Column slug |
|---|---|
| `open` | `backlog` |
| `queued`, `in_design`, `in_progress` | `in-progress` |
| `in_review` | `in-review` |
| `done` | `done` |
| `rejected`, `failed` | `backlog`; the outcome and reason are on the delegation and show on the badge |

A renamed column keeps its slug and keeps working. A project missing a required slug gets
`409 invalid_transition` (`statusMissing`).

**Delegation** is the whole trigger contract:

1. Delegating requires `task_delegation.delegate` and a task in `backlog`. The server checks that the
   delegate is a `kind='agent'` user. If the task has no assignee, the delegating user's staff
   member becomes the assignee in the same command, so a delegated task always has an owner; if
   the delegating user has no staff member, it returns `422 assignee_required`. If the
   `factory.deliver` process definition is missing or disabled, delegation is refused with
   `503 orchestrator_unavailable`, so no task can wait for a run that will never start.
2. The command inserts a `task_delegations` row (its id is the `delegationId`), moves the task
   to `in-progress` through `staff`'s `status_change` command, and
   emits `task_delegation.task.delegated` after commit.
3. SPEC-001's `start-factory` subscriber starts `factory.deliver` with the idempotency key
   `task:{taskId}:{delegationId}`, passing `delegationId` in the instance input. The start subscriber binds the returned process execution id to the exact delegation; process commands validate that persisted binding. SPEC-001's first `set_status → queued` (or `in_progress`) is a
   no-op, because a transition to the current status is accepted and changes nothing.
4. **Un-delegating** is allowed until the linked instance reaches SPEC-001's `sized`
   milestone. Before an instance is linked, it is always allowed. It releases the delegation,
   emits `task_delegation.task.undelegated` (SPEC-001 cancels the instance), and returns the task to
   `backlog`. After `sized`, it is refused with `409 decision_pending`, and the response
   carries the instance link, because the decision now sits in the Caseload.
5. **Stale writes are dropped.** Every workflow-safe command carries the `delegationId` from
   the instance input. A write whose `delegationId` is not the task's active delegation (the task
   was un-delegated, or re-delegated since) is a logged no-op. A cancelled run therefore cannot
   move a task someone has since taken back.
6. **The delegate is released at the end.** When the process sets `done`, `rejected` or `failed`, or the
   assignee moves the task out of review, the delegation gets `released_at`, its `outcome` (`done`,
   `rejected` or `failed`) and `close_reason`, in the same command. The row stays as history. A
   released task is an ordinary staff task again: from `backlog` a person can
   delegate it again, which creates a new delegation and therefore a new run.
7. **Safety net.** A subscriber on `workflows.instance.failed` and
   `workflows.instance.cancelled` (for the instance linked to an active delegation) moves the
   task to `backlog` with outcome `failed` and the instance's error as `close_reason`. A crash or
   a cancel from the orchestrator's UI therefore cannot leave a task stuck in `in-progress`.

**Who writes status.** The process writes through `task_delegation.task.set_status`, which validates its
move against the process column of the table below and then runs `staff`'s `status_change`
command as the workflow's execution principal. People move cards on the `staff` board. A command
interceptor `task_delegation.guard-process-owned` on `staff.timesheets.tasks.{status_change,update,delete}`
applies the people column; it lets through any actor holding `task_delegation.process`.

| Move | Process (`set_status`) | Person, no active delegation | Person, active delegation |
|---|---|---|---|
| `backlog` → `in-progress` | ✓ (no-op after delegate) | ✓ (staff as usual) | — (only via delegate) |
| `in-progress` → `backlog` | ✓ (`failed`/`rejected`) | ✓ | only via un-delegate |
| `in-progress` → `in-review` | ✓ | ✓ | — |
| `in-review` → `done` / `backlog` / `in-progress` (fix round) | ✓ | ✓ | `done` (approve) and `backlog` (reject) only, by the assignee |
| any other move between `backlog`, `in-progress`, `in-review`, `done` | — | ✓ (staff as usual) | — |
| X → X | no-op | no-op | no-op |

A refused move returns `409 process_owned` (active delegation) or `409 process_only_column`
(a target column the project does not have). Deleting a task with an active delegation returns `409 process_owned`.
The interceptor's `beforeUndo` refuses undoing a status change on a task with an active
delegation for all callers, since human undo must not bypass process ownership. Internal process writes use separately validated, single-use transition admission. The assignee's
`in-review` → `done`/`backlog` move exists because the MVP has no PR-merged hook; its
`afterExecute` releases the delegation (outcome `done` or `rejected`) once staff has committed the move; see [Write ordering without a shared transaction](#write-ordering-without-a-shared-transaction). No request-body flag bypasses the guard.

**The run state on the card** is derived at read time, never stored. The card-badge widget reads
it from `GET /api/task_delegation/delegations?taskIds=…`. The injection context carries only ids, so every
badge on a board registers its task id with a shared client loader that sends **one batched
request per render**. The server loads the linked instances and their pending proposals and user
tasks in one lookup through the orchestrator's API or DI service, never through an ORM relation
across modules.

| Derived state | When |
|---|---|
| `starting` | delegation active, no instance linked yet |
| `stalled` | `starting` for more than 60 s: the start subscriber or `startExecution` failed; the drawer offers un-delegate |
| `running` | instance running with nothing pending on a human |
| `awaiting_decision` | the instance has a pending proposal or user task (the Caseload) |
| `failed` | instance failed or cancelled, or delegation outcome `failed` |
| `complete` | instance completed |

The widgets refetch on these client-broadcast events: `task_delegation.task.delegated`,
`task_delegation.task.undelegated`, `staff.timesheets.time_task.status_changed`,
`workflows.instance.{started,completed,failed,cancelled}` and
`agent_orchestrator.proposal.{created,disposed}`. The `staff` board already refreshes the card's
column on `status_changed`. If the orchestrator is absent or the lookup fails, the badge shows
only "Delegated to Software Engineer", and the board still renders.

**Follow-ups** (`task_delegation.task.create_followup`) create a subtask through `staff`'s `create`
command, in `backlog`, with the parent's assignee and no delegate. `staff` allows one level of
subtasks, so a follow-up of a subtask attaches to the subtask's parent. Delegation is the only
trigger, so the factory can't feed itself.

**Comments** are `staff`'s comments. Agents don't write them: they write to the task through
links and follow-ups only. Comments reach agents through `task_tools.get_task`, so, like the description,
they are **untrusted prompt input**.

### Out of scope (MVP), with the seam left for each

| Later | Seam already in place |
|---|---|
| Sentry and GitHub webhook intake, MCP `task_delegation.create_task` / `factory_send_task`, domain-event intake | an intake command that creates a `staff` task and delegates it; a `tasks_intake (source, source_ref)` table with a unique index arrives with the first hook |
| Chat intake (the AI assistant creates and delegates a task) | the same intake command; designed below and storyboarded |
| PR-merged hook setting `done` | the assignee closes `in-review` by hand; the hook will call `set_status` |
| @mention an agent in a comment to trigger it | `staff.timesheets.time_task_comment.created`; the delegate command stays the only trigger |
| "Has delegate" filter, cross-project factory board | our own page reading `task_delegations` joined to `staff` tasks by id |
| Upstreaming a delegate field into `staff` | the delegation table maps one-to-one onto a future field |
| Cost per task on the card | `process_instance_id`; traces are queried per instance |

### Chat intake (next iteration)

Open Mercato already has a chat: the topbar **AI** launcher (⌘L) opens `AiChat` in a sheet or
the right dock. Chat intake adds no chat UI; it adds one module agent and one write tool.

- **Agent** `task_delegation.intake` ("Task intake", *Can write*) in the launcher's picker. Its job is
  to turn a vague request into a good task: ask at most a couple of questions, pick the
  project, write a title and a body with acceptance criteria, and quote the attached records.
- **Tools.** Read: SPEC-007's `task_tools.search_tasks`, `task_tools.get_task` and
  `task_tools.list_projects`, plus `task_delegation.get_delegation`. Write: `task_delegation.create_task
  { projectId, title, description, delegate?: boolean }`, a mutation declared through
  `defineAiTool` + `prepareMutation`, so the chat shows OM's standard *Review proposed
  changes* card and nothing is written before **Confirm**. The approved call runs
  the intake command (`staff`'s task `create`, then `task_delegation.task.delegate`) as the chatting user,
  so ACL is the board's ACL: without `task_delegation.delegate` the card shows no delegate and says why.
- **Context.** Records and files the user attaches become chips and are quoted in the body.
  0.8's launcher attaches nothing automatically; attaching the current page's record is the
  user's move.
- **Traceability.** Chat intake is the first hook, so it brings the `task_delegation_intakes` table:
  `source='chat'`, `source_ref='{conversationId}:{messageId}'`, so a retried confirmation cannot
  create a second task.
- **After confirmation the chat is done.** The result card links the task. Progress, the
  design gate and the PR live on the board, the drawer and the Caseload.

## Design

Every screen is `staff`'s. We add two widgets:

- **Card badge** (`staff.time_task.board:card-badges`): agent icon plus the derived run state,
  with the close reason as a tooltip on a `failed` or `rejected` outcome. Nothing renders for a
  task that was never delegated. Status colours come from the shared UI tokens.
- **Drawer sidebar section** (`detail:staff:staff_time_task:sidebar`): the delegate picker
  (agents from `GET /api/task_delegation/agents`, visible with `task_delegation.delegate`), the run state, the links
  (instance, Caseload item, PR, artifacts), the outcome and close reason, and "Remove delegate"
  with the `decision_pending` explanation when refused.
- What the factory changed (PRs, record updates, staged replies) and the run's progress are
  SPEC-003's "Changes" panel and run view; this section links to them.
- States covered: loading (badge skeleton), a refused move (the board's error toast carries the
  `409` message), `stalled` (un-delegate offered), and orchestrator-absent (plain delegate badge).

Storyboard: [`.ai/prototypes/factory-intake/`](../../.ai/prototypes/factory-intake/index.html),
14 states from the empty board through delegation, the Caseload gate, review and failure, to
chat intake. It was drawn before the rebuild on `staff`: its board, New task dialog and drawer
frames show a custom board (own columns, priority, "has delegate" filter). Read those frames for
the delegation flow and the badge and sidebar content, not for board chrome; the chat and
Caseload frames are unaffected.

## Data Models

All tables are tenant- and organization-scoped, with standard `created_at` and `updated_at`.
Task and project ids reference `staff` records by id only, with no ORM relation.

`task_delegations`: one row per delegation; the active one has `released_at` null.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | the `delegationId`; part of the idempotency key; stale-write guard |
| `task_id` | uuid | `staff_time_tasks.id` |
| `project_id` | uuid | `staff_time_projects.id`, copied at delegation |
| `delegate_user_id` | uuid | an agent principal's `auth.User` (`kind='agent'`) |
| `delegated_by` | uuid | the initiator; SPEC-001's `triggeredBy` |
| `assignee_user_id` | uuid | the accountable human's `auth.User` at delegation |
| `process_instance_id` | uuid, nullable | bound after process start; checked by workflow-safe commands |
| `links` | jsonb | `[{ kind: 'pr' \| 'caseload' \| 'artifact' \| 'instance' \| 'run', ref, url, addedAt }]`; `run` scopes SPEC-003's runner events |
| `outcome` | enum, nullable | `done \| rejected \| failed`, set on release |
| `close_reason` | text, nullable | required for `rejected` and `failed` |
| `released_at` | timestamptz, nullable | |

Indexes: unique `(org, task_id)` where `released_at is null`; `(org, task_id, created_at)`;
`(org, process_instance_id)`.

`task_delegation_process_writes`: `id`, `task_id`, `process_instance_id`, `step_id`, `command_id`, with a
unique index on `(org, task_id, process_instance_id, step_id)`. A replayed workflow-safe command
finds its row and returns the stored result.

This replaces the earlier draft's `tasks_project`, `tasks_task` and `tasks_comment`.

## API Contracts

ACL features: `task_delegation.view` (read delegations and run state), `task_delegation.delegate`, and
`task_delegation.process`, held only by the workflow's execution principal (SPEC-001 *Starting and
seeding*). Everything else is `staff`'s own ACL (`staff.timesheets.tasks.*`,
`staff.timesheets.projects.*`). The execution principal also gets
`staff.timesheets.tasks.manage` in `grantedFeatures`.

Routes (per-method `metadata` and `openApi`):

- `POST /api/task_delegation/delegations { taskId, agentUserId }`: `422` when the target is not an agent
  or `assignee_required`, `409 invalid_transition` when the task is not in `backlog`,
  `503 orchestrator_unavailable`.
- `DELETE /api/task_delegation/delegations/{taskId}`: `409 decision_pending` after `sized`.
- `GET /api/task_delegation/delegations?taskIds=…`: the active or last delegation per task with its
  derived `runState`, one batched lookup.
- `GET /api/task_delegation/agents`: agent principals the caller may delegate to, for the picker.

Commands, audited and carrying the acting principal: `task_delegation.task.delegate` and
`task_delegation.task.undelegate`. Undoing a delegation is un-delegation, with the same guard.

Command interceptor `task_delegation.guard-process-owned` on
`staff.timesheets.tasks.{status_change,update,delete}`: the people column of the transition
table, `beforeUndo` as above, and release on the assignee's close.

Workflow-safe commands (SPEC-001, `requiredFeatures: ['task_delegation.process']`), idempotent on
`(taskId, processInstanceId, stepId)` through `task_delegation_process_writes`. A mismatched `delegationId`
makes the command a logged no-op. People can't undo them. `status` uses SPEC-001's lifecycle
names and maps to column slugs as above:

- `task_delegation.task.set_status { taskId, delegationId, status, reason?, processInstanceId, stepId }`
- `task_delegation.task.link { taskId, delegationId, kind, ref, url?, processInstanceId, stepId }`
- `task_delegation.task.create_followup { parentId, delegationId, title, body, processInstanceId, stepId }`

Subscriber `fail-on-instance-end` on `workflows.instance.{failed,cancelled}`: see the safety
net under *Delegation*.

Events (after commit; scope in the emit options as well as the payload, per SPEC-001
constraint 4):

- `task_delegation.task.delegated { taskId, delegationId, delegateUserId, agentId, delegatedBy }`: persistent, server-only. The process reads authorized task details through `task_tools.get_task` and `task_delegation.get_delegation`; task titles, references and actor identities are not sent on the browser event stream.
- `task_delegation.task.undelegated { taskId, delegationId, processInstanceId? }`: persistent, server-only, consumed for cancellation.
- `task_delegation.task.linked { taskId, delegationId, processInstanceId }`: server-only.
- `task_delegation.task.changed { taskId }`: browser invalidation, scoped to tenant and organization. Widgets re-read the API, which enforces project access before returning task details.

Task creation, edits, moves and comments emit `staff`'s own events
(`staff.timesheets.time_task.*`, `staff.timesheets.time_task_comment.*`).

AI tools (read-only, for SPEC-001's research agent): task reads, search and project lists are
SPEC-007's `task_tools.*`, which go through the `staff` routes. This module adds only
`task_delegation.get_delegation { taskId }` (feature `task_delegation.view`): the task's latest delegation with its
delegate, run state, outcome and links, or `{ found: false }` when the task is missing or outside
the caller's projects.

## Implementation Approach

Each step leaves the app working and ends with its own test. Run `yarn db:generate`, review the
SQL, and ask before applying.

**Phase 1: records, guard and commands** (the SPEC-001 chain can start after this phase)

1. Enable `planner`, `resources` and `staff` in `modules.ts`. Scaffold `task_delegation`: `index.ts`,
   `acl.ts` (three features), `setup.ts` with role defaults and a seed of an "Internal" customer
   company, a staff member for the seeded admin, and a `DEMO` project with the factory columns.
   Then `yarn generate`. *Test:* the `DEMO` board shows the seven columns; the ACL syncs.
2. Entities and migration for `task_delegations` and `task_delegation_process_writes`. *Test:* migration SQL
   reviewed; the partial unique index refuses a second active delegation.
3. `task_delegation.task.{delegate,undelegate}`, the events, and SPEC-001's
   `start-factory` subscriber switched to `task_delegation.task.delegated` with the key
   `task:{taskId}:{delegationId}`. *Tests:* delegate without an assignee makes the actor's staff
   member the assignee; an actor without a staff member gets `assignee_required`; a non-agent
   delegate returns 422; a missing definition returns 503; a missing `in-progress` column
   returns `statusMissing`; un-delegate before `sized` emits `undelegated`, and after it returns
   `decision_pending`.
4. The `task_delegation.guard-process-owned` interceptor. *Tests:* every row of the transition table
   through `staff`'s PATCH status route and `PUT /tasks`; delete refused; undo refused; the
   assignee's close releases the delegation.
5. Workflow-safe `set_status`, `link` and `create_followup` in `workflows.ts`, enabled in the
   seed, plus the `fail-on-instance-end` subscriber. *Tests:* replay idempotency; a stale
   `delegationId` is a no-op; terminal columns release the delegation; reopen and re-delegate
   give a new `delegationId`; a follow-up of a subtask attaches to the root; an instance
   cancelled from the orchestrator moves the task to `backlog` with outcome `failed`.

**Phase 2: API and widgets**

6. Delegation routes and the agents list, with OpenAPI. *Tests:* the ACL matrix; the batched
   GET issues one orchestrator lookup per call.
7. Card badge and drawer sidebar widgets, with the shared batching loader. *Test:* integration:
   delegate from the drawer; the card moves to `In progress` with a `starting` badge; a refused drag
   of a delegated card shows the 409 message and the card stays.
8. Client-broadcast refresh. *Test:* integration: the badge goes `starting` → `running` without a
   reload.
9. Read-only AI tool `task_delegation.get_delegation` (task reads come from SPEC-007's `task_tools`).
   *Test:* Playground call returns scoped data only.

**Phase 3: end to end**

10. The SPEC-001 stub chain on the board: delegate → `Queued` → Caseload approve → `In review`
    with the PR link → the assignee drags to `Done` → the delegation is released. *Test:* one
    integration run, kept green as the smoke test.

Validation per phase: `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn
test`; `yarn test:integration:ephemeral` after steps 7, 8 and 10.

## Key Design Decisions

1. **Reuse the `staff` board; add only delegation.** The board, drawer, projects, references and
   comments already exist and are maintained upstream; what the factory adds is the delegate and
   the process contract. We depend on `staff`'s commands, events, command interceptors and
   injection spots, which are its extension contract, and never on its `lib/` or UI internals.
   The cost is an HR-flavoured home for the board and the customer and staff-member
   prerequisites.
2. **Assignee plus delegate, not one assignee slot.** This keeps the accountable human on the
   task and matches SPEC-001's separation of initiator and actor. The delegate lives in our table
   because `staff`'s custom fields can't be written through its API. Naming note: the
   orchestrator also has *delegation grants* (`agentDelegationGrantService`, OAuth on behalf of a
   user). Task delegation is unrelated, and code and docs say "task delegate" to avoid confusion.
3. **Staff's default columns, addressed by slug.** The board keeps `staff`'s four columns; the
   finer run phase lives on the badge, not in extra columns. Users may rename and recolour them.
4. **Guard only the moves that matter.** `staff` doesn't validate transitions, and we don't add a
   full workflow to human-only tasks. The interceptor protects delegated tasks.
5. **The run state is derived, not stored.** No agent-session table. The orchestrator is the
   single source of what a run is doing.
6. **Manual triggers only.** The only way work starts is a person setting a delegate. Intake
   routes add sources later without changing the trigger.

## Open Questions

- **Does the `staff` board roll back a refused drag?** The board updates optimistically. Confirm
  that a `409` from the interceptor reverts the card and shows the message. If it doesn't, swap
  the card through the `staff.kanban_card` component replacement and disable drag on delegated
  cards. Resolves in Phase 2, step 7.
- **Batch reads from the orchestrator.** Confirm that pending proposals, user tasks and
  milestones can be read for N instances in one call (for `awaiting_decision` and the
  un-delegate guard). If they can't, the guard reads one instance on demand and the badge
  drops `awaiting_decision`. Resolves in Phase 1, step 3.
- **Upstream direction.** Ask the Open Mercato maintainers at the event whether a delegate (or
  agent assignee) on `staff` tasks is planned, and whether the board is meant to leave the Staff
  area. Either would let us drop our table or our widgets.

## Changelog

<!-- Record, not state: rows are closed once dated — append, never rewrite. -->

| Date | Change |
|------|--------|
| 2026-09-18 | Skeleton with Open Questions Q1–Q4. |
| 2026-09-18 | Gate resolved (assignee + delegate; manual triggers only; projects as records; plain comments); full draft. |
| 2026-09-18 | Fresh-context review applied: delegate released at terminal states, reopen and re-delegate, assignee closes `in_review`, stale-write guard on `delegationId`, explicit transition matrix, un-delegate guard on the `sized` milestone, real event names, trigger switch moved into Phase 1. |
| 2026-09-18 | Rebuilt on the core `staff` task board after trying it: `staff` provides projects, tasks, references, the board, the drawer and comments; `tasks` keeps only delegation (`task_delegations`), the process columns, a command-interceptor guard, two widgets and the workflow-safe commands. Priority, the cross-project board and the "has delegate" filter dropped from the MVP. |
| 2026-09-18 | Drawer points to SPEC-003's change set panel and run view. |
| 2026-09-18 | Chat intake designed (agent `tasks.intake`, write tool `tasks_create` behind OM's mutation approval); storyboard linked from Design. |
| 2026-09-18 | Chat intake aligned with the `staff` rebuild: creates through the intake command, lands in `Backlog`, brings the `tasks_intake` table; storyboard board frames flagged as pre-rebuild. |
| 2026-09-19 | AI tools deduplicated with SPEC-007: `tasks_get` and `tasks_search` removed in favour of `task_tools.get_task` / `search_tasks`; chat intake reads through `task_tools.*`; the module keeps only `task_delegation.get_delegation`. |
| 2026-09-19 | Module renamed `tasks` → `task_delegation`: it holds no tasks, only delegation on top of `staff`. Tables `task_delegations` / `task_delegation_process_writes`, ACL, event, command, API (`/api/task_delegation/*`) and CLI ids follow; the initial migration was regenerated. |
| 2026-09-19 | Board simplified to `staff`'s four default columns: `queued`/`in_design` map to `In progress`, `rejected`/`failed` return the task to `Backlog` (badge shows `Failed`/`Rejected`); the assignee rejects a review by moving it to `Backlog`. `Queued`, `In design` and `Closed` columns and `ensureFactoryColumns` removed. |
| 2026-09-20 | Phase states corrected against the code: P1 `in_progress` → `done` (every step 1–5 deliverable exists and is unit-tested) and P2 `in_progress` → `code complete, exit gate open` (steps 6–9 shipped; the board/drawer integration cases the exit gate names are covered at unit level only). The stale P0 checkbox and the "corrections in progress" note from the first security review were closed — all six of its defects now have implementations with tests. P3's end-to-end chain remains unstarted. |
