# SPEC-002: Tasks module: agent delegation on the staff task board

**Status**: Draft
**Owner**: HackOn team · **Date**: 2026-09-18 · **Tracker**: —
**Parent**: [SPEC-001](./SPEC-001-2026-09-18-agentic-software-factory.md), which consumes this
module's `tasks.task.delegated` event and its three workflow-safe commands.

## TLDR

Tasks, projects, the Kanban board, the task drawer and comments come from the core **`staff`**
module (time tracking), enabled as it ships. Our `tasks` module is a thin layer on top that adds
what `staff` doesn't have: an agent **delegate** next to the human assignee, the process-owned
status columns, and the contract with SPEC-001's process.

A staff task has a human **assignee**, who is accountable for it. Setting an agent delegate emits
`tasks.task.delegated`, and that event is SPEC-001's only start path. After that, the process owns
the task's status. A badge on the card shows the linked run's live state, and the drawer shows the
delegate, the run, the PR and the pending decision. References come from `staff` (`WEB-12`), so
"Fixes WEB-12" in a PR is unambiguous.

The MVP is **manual only**: a person creates the task and a person delegates it. Webhooks
(Sentry, GitHub), MCP intake and domain-event intake come later.

## Problem Statement

SPEC-001 needs one event and three commands from `tasks`. People need more than that:

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
  them, in `Backlog`. In the drawer they set the delegate to "Factory agent", and within a second
  the card moves to `Queued` with a delegate badge, then the badge shows the pending Caseload
  decision. They remain the assignee throughout. A user without `tasks.delegate` sees no delegate
  picker.
- **Engineer** opens `WEB-12` from a PR titled "Fixes WEB-12". The drawer shows the delegate, the
  run link, the PR, the Caseload item, the parent task and the comments.
- **Team lead** opens the project board. Each card shows the reference, title, assignee and a
  delegate badge with the live run state.
- **Product owner** removes the delegate before the sizer decides. The run is cancelled and
  the task goes back to `Backlog`. Removing it after the sizer has decided is refused: the drawer
  points to the Caseload, where the decision now sits. When a run fails, the task lands in
  `Closed` with the reason, and the owner can drag it back to `Backlog` and delegate again.
- **Product owner** sees the PR merge in GitHub and drags the `In review` card to `Done`. The MVP
  has no merge hook, so the assignee is allowed to make this one move while the task is still
  delegated. Every other drag of a delegated card is refused.
- **Reviewer agent** (SPEC-001) produces findings. They appear as subtasks with the same
  assignee and no delegate, and wait there until a human delegates them.

Chat intake (next iteration, storyboarded now; see *Chat intake*):

- **Business owner** opens the AI assistant on a product page, attaches the product, and writes
  "the product page on the website still shows last year's price". The intake agent asks one
  question (which project), then proposes `WEB-13` delegated to the Factory agent in OM's
  standard "Review proposed changes" card. They confirm and get a link to the task; everything
  after that happens on the board and in the Caseload, not in the chat.
- **Business owner without `tasks.delegate`** gets the same card without the delegate, and the
  task lands in `Backlog` for someone who can delegate it.
- **Anyone** asks "what's happening with WEB-12?" and gets the column, the run state and the
  pending decision from `tasks_get`, with links. The chat never shows run progress itself.

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

`src/modules/tasks`, an ordinary app module. It has two entities (delegation and
process write), the delegate and un-delegate commands, a command interceptor on `staff`'s task
commands, two injection widgets, events, ACL features, read-only AI tools, and the workflow-safe
commands SPEC-001 calls.

**Status columns.** The factory's lifecycle maps to `staff` columns by slug:

| Lifecycle (SPEC-001) | Column slug | Column |
|---|---|---|
| `open` | `backlog` | staff default |
| `queued` | `queued` | added by us |
| `in_design` | `in-design` | added by us |
| `in_progress` | `in-progress` | staff default |
| `in_review` | `in-review` | staff default |
| `done` | `done` | staff default |
| `rejected`, `failed` | `closed` | added by us, `isDone`; the outcome and reason are on the delegation |

`ensureFactoryColumns(projectId)` creates the three missing columns through
`staff.timesheets.task_statuses.create`, in lifecycle order, when they are absent. It is called
by delegation and by `set_status`, so a column someone deleted comes back before the process
needs it. A renamed column keeps its slug and keeps working.

**Delegation** is the whole trigger contract:

1. Delegating requires `tasks.delegate` and a task in `backlog`. The server checks that the
   delegate is a `kind='agent'` user. If the task has no assignee, the delegating user's staff
   member becomes the assignee in the same command, so a delegated task always has an owner; if
   the delegating user has no staff member, it returns `422 assignee_required`. If the
   `factory.deliver` process definition is missing or disabled, delegation is refused with
   `503 orchestrator_unavailable`, so no task can wait for a run that will never start.
2. The command inserts a `tasks_delegation` row (its id is the `delegationId`), ensures the
   factory columns, moves the task to `queued` through `staff`'s `status_change` command, and
   emits `tasks.task.delegated` after commit.
3. SPEC-001's `start-factory` subscriber starts `factory.deliver` with the idempotency key
   `task:{taskId}:{delegationId}`, passing `delegationId` in the instance input. The process
   calls `tasks.task.link` with the instance. SPEC-001's first `set_status → queued` is a
   no-op, because a transition to the current status is accepted and changes nothing.
4. **Un-delegating** is allowed until the linked instance reaches SPEC-001's `sized`
   milestone. Before an instance is linked, it is always allowed. It releases the delegation,
   emits `tasks.task.undelegated` (SPEC-001 cancels the instance), and returns the task to
   `backlog`. After `sized`, it is refused with `409 decision_pending`, and the response
   carries the instance link, because the decision now sits in the Caseload.
5. **Stale writes are dropped.** Every workflow-safe command carries the `delegationId` from
   the instance input. A write whose `delegationId` is not the task's active delegation (the task
   was un-delegated, or re-delegated since) is a logged no-op. A cancelled run therefore cannot
   move a task someone has since taken back.
6. **The delegate is released at the end.** When the task reaches `done` or `closed`, by the
   process or by the assignee, the delegation gets `released_at`, its `outcome` (`done`,
   `rejected` or `failed`) and `close_reason`, in the same command. The row stays as history. A
   released task is an ordinary staff task again: a person can drag it back to `backlog` and
   delegate it again, which creates a new delegation and therefore a new run.
7. **Safety net.** A subscriber on `workflows.instance.failed` and
   `workflows.instance.cancelled` (for the instance linked to an active delegation) moves the
   task to `closed` with outcome `failed` and the instance's error as `close_reason`. A crash or
   a cancel from the orchestrator's UI therefore cannot leave a task stuck in `in-progress`.

**Who writes status.** The process writes through `tasks.task.set_status`, which validates its
move against the process column of the table below and then runs `staff`'s `status_change`
command as the workflow's execution principal. People move cards on the `staff` board. A command
interceptor `tasks.guard-process-owned` on `staff.timesheets.tasks.{status_change,update,delete}`
applies the people column; it lets through any actor holding `tasks.process`.

| Move | Process (`set_status`) | Person, no active delegation | Person, active delegation |
|---|---|---|---|
| `backlog` → `queued` | ✓ (no-op after delegate) | — (only via delegate) | — |
| `queued` → `backlog` | — | — | only via un-delegate |
| `queued` → `in-design` / `in-progress` / `closed` | ✓ | — | — |
| `in-design` → `in-progress` / `closed` | ✓ | — | — |
| `in-progress` → `in-review` / `closed` | ✓ | ✓ | — |
| `in-review` → `done` / `closed` / `in-progress` (fix round) | ✓ | ✓ | `done` and `closed` only, by the assignee |
| any other move between `backlog`, `in-progress`, `in-review`, `done`, `closed` | — | ✓ (staff as usual) | — |
| any move into `queued` or `in-design` | as above | — | — |
| X → X | no-op | no-op | no-op |

A refused move returns `409 process_owned` (active delegation) or `409 process_only_column`
(`queued`, `in-design`). Deleting a task with an active delegation returns `409 process_owned`.
The interceptor's `beforeUndo` refuses undoing a status change on a task with an active
delegation for anyone without `tasks.process`, since undo would bypass the guard. The assignee's
`in-review` → `done`/`closed` move exists because the MVP has no PR-merged hook; its
`afterExecute` releases the delegation (outcome `done` or `rejected`).

**The run state on the card** is derived at read time, never stored. The card-badge widget reads
it from `GET /api/tasks/delegations?taskIds=…`. The injection context carries only ids, so every
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

The widgets refetch on these client-broadcast events: `tasks.task.delegated`,
`tasks.task.undelegated`, `staff.timesheets.time_task.status_changed`,
`workflows.instance.{started,completed,failed,cancelled}` and
`agent_orchestrator.proposal.{created,disposed}`. The `staff` board already refreshes the card's
column on `status_changed`. If the orchestrator is absent or the lookup fails, the badge shows
only "Delegated to Factory agent", and the board still renders.

**Follow-ups** (`tasks.task.create_followup`) create a subtask through `staff`'s `create`
command, in `backlog`, with the parent's assignee and no delegate. `staff` allows one level of
subtasks, so a follow-up of a subtask attaches to the subtask's parent. Delegation is the only
trigger, so the factory can't feed itself.

**Comments** are `staff`'s comments. Agents don't write them: they write to the task through
links and follow-ups only. Comments reach agents through `tasks_get`, so, like the description,
they are **untrusted prompt input**.

### Out of scope (MVP), with the seam left for each

| Later | Seam already in place |
|---|---|
| Sentry and GitHub webhook intake, MCP `tasks_create` / `factory_send_task`, domain-event intake | an intake command that creates a `staff` task and delegates it; a `tasks_intake (source, source_ref)` table with a unique index arrives with the first hook |
| Chat intake (the AI assistant creates and delegates a task) | the same intake command; designed below and storyboarded |
| PR-merged hook setting `done` | the assignee closes `in-review` by hand; the hook will call `set_status` |
| @mention an agent in a comment to trigger it | `staff.timesheets.time_task_comment.created`; the delegate command stays the only trigger |
| "Has delegate" filter, cross-project factory board | our own page reading `tasks_delegation` joined to `staff` tasks by id |
| Upstreaming a delegate field into `staff` | the delegation table maps one-to-one onto a future field |
| Cost per task on the card | `process_instance_id`; traces are queried per instance |

### Chat intake (next iteration)

Open Mercato already has a chat: the topbar **AI** launcher (⌘L) opens `AiChat` in a sheet or
the right dock. Chat intake adds no chat UI; it adds one module agent and one write tool.

- **Agent** `tasks.intake` ("Task intake", *Can write*) in the launcher's picker. Its job is
  to turn a vague request into a good task: ask at most a couple of questions, pick the
  project, write a title and a body with acceptance criteria, and quote the attached records.
- **Tools.** Read: `tasks_search`, `tasks_get`, and `tasks_projects` (the `staff` projects). Write: `tasks_create
  { projectId, title, description, delegate?: boolean }`, a mutation declared through
  `defineAiTool` + `prepareMutation`, so the chat shows OM's standard *Review proposed
  changes* card and nothing is written before **Confirm**. The approved call runs
  the intake command (`staff`'s task `create`, then `tasks.task.delegate`) as the chatting user,
  so ACL is the board's ACL: without `tasks.delegate` the card shows no delegate and says why.
- **Context.** Records and files the user attaches become chips and are quoted in the body.
  0.8's launcher attaches nothing automatically; attaching the current page's record is the
  user's move.
- **Traceability.** Chat intake is the first hook, so it brings the `tasks_intake` table:
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
  (agents from `GET /api/tasks/agents`, visible with `tasks.delegate`), the run state, the links
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

`tasks_delegation`: one row per delegation; the active one has `released_at` null.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | the `delegationId`; part of the idempotency key; stale-write guard |
| `task_id` | uuid | `staff_time_tasks.id` |
| `project_id` | uuid | `staff_time_projects.id`, copied at delegation |
| `delegate_user_id` | uuid | an agent principal's `auth.User` (`kind='agent'`) |
| `delegated_by` | uuid | the initiator; SPEC-001's `triggeredBy` |
| `assignee_user_id` | uuid | the accountable human's `auth.User` at delegation |
| `process_instance_id` | uuid, nullable | set by `tasks.task.link` |
| `links` | jsonb | `[{ kind: 'pr' \| 'caseload' \| 'artifact' \| 'instance' \| 'run', ref, url, addedAt }]`; `run` scopes SPEC-003's runner events |
| `outcome` | enum, nullable | `done \| rejected \| failed`, set on release |
| `close_reason` | text, nullable | required for `rejected` and `failed` |
| `released_at` | timestamptz, nullable | |

Indexes: unique `(org, task_id)` where `released_at is null`; `(org, task_id, created_at)`;
`(org, process_instance_id)`.

`tasks_process_write`: `id`, `task_id`, `process_instance_id`, `step_id`, `command_id`, with a
unique index on `(org, task_id, process_instance_id, step_id)`. A replayed workflow-safe command
finds its row and returns the stored result.

This replaces the earlier draft's `tasks_project`, `tasks_task` and `tasks_comment`.

## API Contracts

ACL features: `tasks.view` (read delegations and run state), `tasks.delegate`, and
`tasks.process`, held only by the workflow's execution principal (SPEC-001 *Starting and
seeding*). Everything else is `staff`'s own ACL (`staff.timesheets.tasks.*`,
`staff.timesheets.projects.*`). The execution principal also gets
`staff.timesheets.tasks.manage` in `grantedFeatures`.

Routes (per-method `metadata` and `openApi`):

- `POST /api/tasks/delegations { taskId, agentUserId }`: `422` when the target is not an agent
  or `assignee_required`, `409 invalid_transition` when the task is not in `backlog`,
  `503 orchestrator_unavailable`.
- `DELETE /api/tasks/delegations/{taskId}`: `409 decision_pending` after `sized`.
- `GET /api/tasks/delegations?taskIds=…`: the active or last delegation per task with its
  derived `runState`, one batched lookup.
- `GET /api/tasks/agents`: agent principals the caller may delegate to, for the picker.

Commands, audited and carrying the acting principal: `tasks.task.delegate` and
`tasks.task.undelegate`. Undoing a delegation is un-delegation, with the same guard.

Command interceptor `tasks.guard-process-owned` on
`staff.timesheets.tasks.{status_change,update,delete}`: the people column of the transition
table, `beforeUndo` as above, and release on the assignee's close.

Workflow-safe commands (SPEC-001, `requiredFeatures: ['tasks.process']`), idempotent on
`(taskId, processInstanceId, stepId)` through `tasks_process_write`. A mismatched `delegationId`
makes the command a logged no-op. People can't undo them. `status` uses SPEC-001's lifecycle
names and maps to column slugs as above:

- `tasks.task.set_status { taskId, delegationId, status, reason?, processInstanceId, stepId }`
- `tasks.task.link { taskId, delegationId, kind, ref, url?, processInstanceId, stepId }`
- `tasks.task.create_followup { parentId, delegationId, title, body, processInstanceId, stepId }`

Subscriber `fail-on-instance-end` on `workflows.instance.{failed,cancelled}`: see the safety
net under *Delegation*.

Events (after commit; scope in the emit options as well as the payload, per SPEC-001
constraint 4):

- `tasks.task.delegated { taskId, reference, delegationId, delegateUserId, agentId,
  assigneeUserId, delegatedBy, projectId, projectKey, source, title }`: persistent and
  `clientBroadcast`. `agentId` is the agent definition id resolved from the principal.
  `projectKey` is the project's current `code`; `staff` lets it be renamed, so configuration
  keys on `projectId`. `source` is `manual` in the MVP.
- `tasks.task.undelegated { taskId, delegationId, processInstanceId? }`: `clientBroadcast`.

Task creation, edits, moves and comments emit `staff`'s own events
(`staff.timesheets.time_task.*`, `staff.timesheets.time_task_comment.*`).

AI tools (read-only, for SPEC-001's research agent): `tasks_get { reference | taskId }`, which
returns the task, its parent, its comments and its delegation with links, and
`tasks_search { projectId, query?, status? }`. Both read `staff` records through the query
engine with the caller's scope.

## Implementation Approach

Each step leaves the app working and ends with its own test. Run `yarn db:generate`, review the
SQL, and ask before applying.

**Phase 1: records, guard and commands** (the SPEC-001 chain can start after this phase)

1. Enable `planner`, `resources` and `staff` in `modules.ts`. Scaffold `tasks`: `index.ts`,
   `acl.ts` (three features), `setup.ts` with role defaults and a seed of an "Internal" customer
   company, a staff member for the seeded admin, and a `DEMO` project with the factory columns.
   Then `yarn generate`. *Test:* the `DEMO` board shows the seven columns; the ACL syncs.
2. Entities and migration for `tasks_delegation` and `tasks_process_write`. *Test:* migration SQL
   reviewed; the partial unique index refuses a second active delegation.
3. `ensureFactoryColumns`, `tasks.task.{delegate,undelegate}`, the events, and SPEC-001's
   `start-factory` subscriber switched to `tasks.task.delegated` with the key
   `task:{taskId}:{delegationId}`. *Tests:* delegate without an assignee makes the actor's staff
   member the assignee; an actor without a staff member gets `assignee_required`; a non-agent
   delegate returns 422; a missing definition returns 503; a deleted `queued` column is
   recreated; un-delegate before `sized` emits `undelegated`, and after it returns
   `decision_pending`.
4. The `tasks.guard-process-owned` interceptor. *Tests:* every row of the transition table
   through `staff`'s PATCH status route and `PUT /tasks`; delete refused; undo refused; the
   assignee's close releases the delegation.
5. Workflow-safe `set_status`, `link` and `create_followup` in `workflows.ts`, enabled in the
   seed, plus the `fail-on-instance-end` subscriber. *Tests:* replay idempotency; a stale
   `delegationId` is a no-op; terminal columns release the delegation; reopen and re-delegate
   give a new `delegationId`; a follow-up of a subtask attaches to the root; an instance
   cancelled from the orchestrator moves the task to `closed` with outcome `failed`.

**Phase 2: API and widgets**

6. Delegation routes and the agents list, with OpenAPI. *Tests:* the ACL matrix; the batched
   GET issues one orchestrator lookup per call.
7. Card badge and drawer sidebar widgets, with the shared batching loader. *Test:* integration:
   delegate from the drawer; the card moves to `Queued` with a `starting` badge; a refused drag
   of a delegated card shows the 409 message and the card stays.
8. Client-broadcast refresh. *Test:* integration: the badge goes `starting` → `running` without a
   reload.
9. Read-only AI tools `tasks_get` and `tasks_search`. *Test:* Playground call returns scoped
   data only.

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
3. **Process columns by frozen slug, self-healing.** The process addresses columns by slug, and
   `ensureFactoryColumns` recreates a missing one. Users may still rename and recolour them.
4. **Guard only the moves that matter.** `staff` doesn't validate transitions, and we don't add a
   full workflow to human-only tasks. The interceptor protects delegated tasks and the two
   process-only columns.
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
| 2026-09-18 | Rebuilt on the core `staff` task board after trying it: `staff` provides projects, tasks, references, the board, the drawer and comments; `tasks` keeps only delegation (`tasks_delegation`), the process columns, a command-interceptor guard, two widgets and the workflow-safe commands. Priority, the cross-project board and the "has delegate" filter dropped from the MVP. |
| 2026-09-18 | Drawer points to SPEC-003's change set panel and run view. |
| 2026-09-18 | Chat intake designed (agent `tasks.intake`, write tool `tasks_create` behind OM's mutation approval); storyboard linked from Design. |
| 2026-09-18 | Chat intake aligned with the `staff` rebuild: creates through the intake command, lands in `Backlog`, brings the `tasks_intake` table; storyboard board frames flagged as pre-rebuild. |
| 2026-09-19 | Chat intake moved to SPEC-006 as the `factory_tools` module (agent `factory_tools.intake`, tool `factory_tools.create_task` replacing `tasks_create`); it creates through `staff`'s task route and delegates through this module's `GET /api/tasks/agents` + `POST /api/tasks/delegations` when installed. `source_ref = '{conversationId}:{messageId}'` is not obtainable in 0.8.0 (handlers get only `approvedPendingActionId`), so the chat records the pending action id; the `tasks_intake` table stays this module's roadmap. |
