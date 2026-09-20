# SPEC-003: Task change set: what the factory proposes and does, on the task

**Status**: Draft
**Owner**: HackOn team · **Date**: 2026-09-18 · **Tracker**: —
**Parent**: [SPEC-001](./SPEC-001-2026-09-18-agentic-software-factory.md) (the process and the
runner), built on [SPEC-002](./SPEC-002-2026-09-18-tasks-module.md) (delegation on the `staff`
task board).

## TLDR

A delegated task can end in more than a PR. The factory may propose a correction to a product in
the catalog, a reply to a customer, or a document, and a mix of these with code. Every one of
these effects is a **change** on the task. The task's **change set** is the typed list of them,
each with its own preview, lifecycle and reviewer:

| Kind | What it is | Preview | Applied by | Reversible |
|---|---|---|---|---|
| `code` | one slice run by the coding runner | PR, the preview URL, planned vs touched files | the runner, as the bot | revert the PR |
| `record` | an update to an Open Mercato record through a workflow-safe command | field by field, before → after | the effector, through the command bus | a revert change, compared like any other |
| `message` | a reply to a conversation in `messages` (e.g. a support email) | the rendered message, recipients | **a person**, who sends it under their own name | not after sending |
| `artifact` | a document the agent produced | the file | nothing to apply | not applicable |

Three rules carry the design:

1. **Proposals stay data; one effector applies them.** The orchestrator's invariant is unchanged:
   the agent proposes typed actions, a person or a policy disposes, and then our effector runs the
   approved actions through the command bus. It re-checks the action vocabulary and the three
   gates `UPDATE_ENTITY` checks.
2. **Compare before you write.** A `record` change stores the value it was proposed against. It
   applies only if the record still holds that value. Otherwise it becomes a `conflict`, and
   nothing is overwritten.
3. **The factory never sends.** A `message` change ends as approved text on the task. A person
   sends it with one click, under their own identity. Nothing the factory can do reaches a
   customer on its own.

The change set is shown in a panel in the `staff` task drawer and on a full-page run view. The
run view also shows the runner's live progress and its preview. The Caseload stays where
decisions are made; the panel shows what they are about and what happened.

## Problem Statement

SPEC-001 routes a `non_code` task to "an artifact or command proposal → Caseload → effector" in
one line. Taking it at its word runs into four problems in 0.8.0:

- **The effector can't run a mixed plan.** `UPDATE_ENTITY` runs exactly one command per step
  (`WF/lib/activity-executor.ts:1013-1052`), and the graph has no loop over a proposal's action
  list. A proposal that fixes a product description and updates a deal needs two different
  commands.
- **Nobody sees what a change changes.** The Caseload renders each action as a chip with its type
  and lets an operator edit flat payload fields (`ProposalOptionList.tsx:204`,
  `proposalEdit.ts`). It shows the new value, never the current one. An operator who approves
  "set description to X" doesn't see what they are replacing.
- **Stale approvals overwrite people.** A proposal can wait in the Caseload for a day. The catalog
  module names this hazard as the reason it declares only `catalog.products.update` and keeps
  variants, prices, offers and deletes out of workflows (`catalog/workflows.ts`): a workflow writes
  with context captured before it parked.
- **Sending is irreversible.** A reply to a customer can't be undone, and no auto-approval policy
  should be able to send one.

On the code side, SPEC-001 leaves the runner silent between `POST /runs` and
`factory.run.finished`, and the preview reachable only as "a per-run URL". A person watching a
task sees `running` for twenty minutes and then a link.

## User Stories

- **Business owner** delegates "ZDP-5000 holds 5200 l, not 5000, and its dimensions are empty"
  (the demo company's diesel tank, [SPEC-004](./SPEC-004-2026-09-18-demo-metal-zbiorniki.md)). The
  Caseload asks them to approve one change to *ZDP-5000*.
  The task drawer shows `description` and `dimensions` before and after. They approve, the product
  updates, and the entry shows `applied` with a link to the audit log entry (and, from Phase 2,
  **Revert**).
- **Catalog manager** edited the same product an hour after the proposal was made. On approval
  the entry turns `conflict` and shows three values: proposed against, current, proposed. Nothing
  is written. The task gets a follow-up to re-run with the current record.
- **Support lead** delegates "answer the customer on conversation *Late delivery SO-1042*". The
  agent reads the order and the conversation and proposes a reply. After approval, the task
  drawer shows the text with **Send as me**. The lead edits one sentence and sends it. The reply
  goes out from the lead, not from a bot, and the entry becomes `sent`.
- **Product owner** delegates a feature. While it runs, the run view shows the runner's steps
  ("installing", "tests: 3 failing", "tests green", "PR opened"), the cost so far and the elapsed
  time, then the preview link and the files the slice touched against the files it planned.
  `pnpm-lock.yaml` is flagged.
- **Legal reviewer** opens the preview from their Caseload item without a GitHub or VPN account.
  The link expires with the review route.
- **Team lead** opens any task and sees in one list everything the factory changed for it: PRs,
  records and messages, with their states and who approved each.

## Proposed Solution

### Where each kind comes from

A task's path through SPEC-001's process decides which kinds it can produce:

| Sizer route | Proposing agent | Kinds |
|---|---|---|
| `single_shot`, `medium`, `large` | `factory.slicer`, then the runner | `code` (one per slice run) |
| `non_code` | **`factory.operator`** (new) | `record`, `message`, `artifact` |
| `review_only` | `factory.reviewer` | none (findings become follow-ups) |

**One change set per task, one kind of plan per proposal.** A task that needs both code and data,
such as "add a certificates field to the product page and fill it for ZDP-5000", is
split by the slicer: the code slice runs, and the data slice becomes a follow-up task that the
assignee delegates after the PR merges. This keeps the order explicit: data never lands before the
code that shows it. Ordering inside one process (apply data after the merge signal) comes later
(see *Out of scope*).

`factory.operator` is a native decision-maker (object mode) with read-only tools for the entities
in its vocabulary: core's catalog and customers AI tools, our conversation and order readers
(Phase 2), and the task read tool.
It returns **one option** (SPEC-001's one-option rule) whose actions are the plan:

```
{ type: 'catalog.products.update', payload: { id, description, … }, risk: 'medium' }
{ type: 'tasks.change.stage_message', payload: { messageId, body, bodyFormat, replyAll, sendViaEmail }, risk: 'low' }
```

`type` is the command id, so no mapping table is needed. `allowedActions` on the agent narrows the
vocabulary to exactly the commands below.

### The action vocabulary

The orchestrator bounds what an agent may propose to `(workflow-safe commands ∪ workflow activity
types) ∩ agent.allowedActions`. The kinds map onto it as follows:

| Kind | Commands | Declared by | 0.8.0 status |
|---|---|---|---|
| `record` | `catalog.products.update` | core `catalog` | available, off per tenant until enabled |
| `record` | `customers.{people,companies,deals}.update`, `sales.orders.update` | core | available, off per tenant until enabled |
| `message` | `tasks.change.stage_message` | ours | writes only our change row; see below |
| `artifact` | none (the agent's artifact result) | orchestrator | available |
| `code` | none (the workflow's `CALL_WEBHOOK` to the runner) | SPEC-001 | available |

What is deliberately **not** in the vocabulary, and what happens instead:

- **Creates and deletes.** Core declares updates only, because a workflow acts on context
  captured before it parked. "Add a product" is a follow-up task for a person, or a later
  `tasks`-owned create command with its own review.
- **Prices, variants and offers.** The catalog keeps them behind `salesCalculationService` and
  pricing rules. A proposal that needs them names the change in its rationale and ends as a
  follow-up task.
- **Sending anything.** See `message` below.

The seed enables only the record commands the project uses, per tenant, in Workflow settings.
It never enables them all.

### `record` changes: snapshot, compare, apply, revert

```
factory.operator ──proposal──▶ agent_orchestrator.proposal.created { workflowInstanceId, … }
                                   │ tasks subscriber `snapshot-change-set` (queued, async)
                                   ▼
                     tasks_change rows: kind=record, status=proposed,
                     before = current values of exactly the payload's fields
                                   │
   Caseload: approve | edit | reject          (the drawer panel shows before → after)
                                   │ approved | auto_approved | edited
                                   ▼
EXECUTE_FUNCTION  tasks.apply_change_set   (reads context.proposalPayload.options.0.actions)
   delegation still active?  no ──▶ nothing written, stop
   per action, in order:
     row applied already?       ──▶ keep it, next
     gates: in vocabulary? workflow-safe? enabled for tenant? principal holds requiredFeatures?
     claim row: status=applying
     compare: current == before?  current == after ──▶ applied (replay), next
                                  otherwise differs ──▶ conflict, stop
     commandBus.execute(type, { input: payload })  ──▶ re-read → after, applied, actionLogId
     error ──▶ failed, stop
                                   ▼
result at context.apply_change_set.result { applied, conflict, failed, notRun }
   conflict or failed > 0 → create_followup "re-run against the current record"
```

- **Snapshot at proposal time.** A persistent subscriber on `agent_orchestrator.proposal.created`
  takes the `workflowInstanceId` from the payload and returns unless that instance is linked to
  an **active** delegation. For each action in the leading option whose type is in the **target
  registry**, it reads the current values of the payload's fields and writes a `proposed` row.
  Records are read through the query engine with the organisation's scope, never through ORM
  relations.
- **Target registry.** One entry per record command, in the `tasks` module:
  `{ commandId, entityId: 'catalog:catalog_product', idField: 'id', labelField: 'title', href,
  fields: { description: 'description', dimensions: 'dimensions', … } }`. `fields` maps payload
  keys (camelCase, as the command takes them) to the keys the query engine returns (snake_case,
  `cf_*`). It is also the allowlist: a payload field that isn't in the map makes the action
  `conflict` before anything is written. Phase 1 has a single entry, `catalog.products.update`.
- **Our own effector loop.** `UPDATE_ENTITY` runs one command per step, and the graph has no loop
  over a proposal's actions. The orchestrator's `executeProposal` helper doesn't fit either:
  it keeps going after an error, has no hook between actions for the compare, and drops the
  command's log entry (`lib/runtime/executeProposal.ts:48-77`). So `tasks.apply_change_set` is
  our own loop. It uses the orchestrator's exported `loadActionVocabulary` and
  `isEffectWithinVocabulary` for the vocabulary check, and `commandBus.execute`, which returns
  `{ result, logEntry }`, for the write. It re-applies the three gates `UPDATE_ENTITY` applies
  (`WF/lib/activity-executor.ts:1018-1052`), because `EXECUTE_FUNCTION` has none of its own, and
  builds the command context the same way `UPDATE_ENTITY` does. It is registered as a DI factory,
  because `EXECUTE_FUNCTION` calls `fn(args, context)` without a container. It runs as the
  workflow's execution principal (`context.userId`, which exists because the definition is
  seeded with a grant; SPEC-001 *Starting and seeding*). The orchestrator itself still calls
  `executeProposal` nowhere; the workflow is the effector, as SPEC-001 says.
- **Grants.** The seed adds each enabled record command's `requiredFeatures` to the workflow's
  `grantedFeatures` (Phase 1: `catalog.products.manage`), and enables the command for the tenant.
  Without both, every record write is refused, the same way `UPDATE_ENTITY` would refuse it.
- **Compare-and-set.** Before each command, the effector re-reads the mapped fields and compares
  them with the row's `before`, normalised the way the query engine returns them. On a difference
  it marks the row `conflict`, stores the current values, and stops.
- **Stale delegation.** The effector and the subscriber both check that the task's active
  delegation is the one in the instance input, the same guard SPEC-002 puts on `task_delegation.*`
  commands. If someone takes the task back while its proposal sits in the Caseload, approving the
  proposal writes nothing.
- **Missing snapshot.** The subscriber is queued, so the effector can run first. This happens
  on auto-approval, and on a human approval faster than the queue. The effector then captures
  `before` itself and applies. Compare-and-set protects the window between snapshot and apply;
  with no snapshot, the window is empty and there is nothing to compare.
- **Edited proposals.** An `edited` disposition replaces the whole payload, and the Caseload's
  raw-JSON editor accepts any action list. An edit that changes values is fine: the effector
  writes the approved values, and the entry shows them. An edit that changes an action's target
  id, its field set or the action order no longer matches its snapshot row, and that action
  becomes `conflict`. The effector never writes a field it has no `before` for.
- **Replays and crashes.** Activities retry, and this function is not a workflow-safe command, so
  SPEC-002's idempotency table doesn't cover it. The row state does: `applied` rows are skipped,
  and an `applying` row whose record already holds `after` is completed as `applied`. A crash
  between the write and the row update therefore settles on the retry, not as a false conflict.
- **`after` is what was stored.** Commands normalise their input, so after each write the
  effector re-reads the mapped fields and stores those values as `after`.
- **Stop on the first failure.** Commands have separate transactions, so a plan is not atomic.
  Rows already applied stay applied, and the rest are `not_run`.
- **Revert, not platform undo (Phase 2).** Catalog's undo restores the whole product snapshot,
  including offers, categories, tags and custom fields (`catalog/commands/products.ts:2109-2181`).
  An undo after an unrelated edit would therefore wipe that edit. The platform's undo route also
  refuses anyone but the actor without `audit_logs.undo_tenant`. So **Revert** is a new change of
  the same kind with `before` and `after` swapped. It is run as the person clicking, requires the
  command's `requiredFeatures`, and goes through the same compare against `after`. Phase 1 shows
  `applied` and a link to the action in the audit log.

### `message` changes: the factory drafts, a person sends

A support ticket in Open Mercato is a `messages` conversation, often mirrored to email through
`communication_channels`. Replying goes through `messages.messages.reply`, which sends
immediately; `reply` has no draft mode (`messages/data/validators.ts:287`).

- The operator proposes `tasks.change.stage_message { messageId, body, bodyFormat, replyAll,
  sendViaEmail }`. `sendViaEmail` defaults to false in `reply`, so a staged reply to an
  email-mirrored conversation sets it to true.
  This is our own workflow-safe command, and all it does is write a `tasks_change` row with
  `kind: message` and `status: ready_to_send`. It touches nothing in `messages`, so approving it
  can't reach a customer, and it may be auto-approved by policy.
- The drawer panel renders the text and the recipients. It shows **Send as me** only to people
  who can reply in that conversation anyway: participants (sender or recipient) holding
  `messages.compose`, which is what `reply` itself enforces (`messages/commands/messages.ts:701`,
  `messages/api/[id]/reply/route.ts:16`). Everyone else sees who can send it. Sending runs
  `messages.messages.reply` with the (optionally edited) body **as the logged-in person**, so
  the recipient sees a human and `messages` applies its usual ACL and channel rules. The row
  becomes `sent`, with the message id and the sender.
- `messages` and `sales` ship no AI tools in 0.8.0 (catalog and customers do). The operator
  reads a conversation and an order through two read-only tools in the `tasks` module,
  `tasks_read_conversation` and `tasks_read_order` (Phase 2). They are ACL-gated like any tool,
  and their text is untrusted prompt input.
- **Discard** marks the row `discarded`. The task continues either way. The process doesn't wait
  for a send; it ends at `in_review` as usual, and the assignee closes the task.

The line is deliberate: SPEC-001 already says client-visible writes go through the control
plane, never through the agent. Here they go through a person.

### `code` changes: the runner's manifest and live progress

A code change is written to the change set by the process, not by a subscriber: after
`factory.run.finished`, an `UPDATE_ENTITY` step runs the workflow-safe
`tasks.change.record_run`, which writes the `code` row from the signal payload. SPEC-001's payload
grows a manifest:

```
payload: { run: { status, reason?, prUrl?, previewUrl?, costUsd?, summary,
                  runId, attempt, durationS,
                  changes?: { files: [{ path, status: 'added'|'modified'|'deleted',
                                        planned: boolean, flags: ('ci'|'test'|'lockfile')[] }],
                              screenshots?: [{ artifactId, caption }],
                              checks?: [{ name, conclusion }] } } }
```

`planned` compares each path with the approved slice's `files[]`. An unplanned file is the first
thing a reviewer should look at, and the panel sorts it to the top.

**Progress** comes from the runner while it runs. The shim already reads the agent's JSON event
stream for the cost cap. It forwards a coarse summary, not the transcript:

```
runner → control  POST /api/tasks/runs/{runId}/events   (x-api-key: the bot principal's key)
                  { taskId, attempt, events: [{ seq, at, kind, text?, costUsd?, data? }] }
                  kind: phase | check | cost | note | error
                  → 202; duplicate (runId, seq) ignored
```

- At most one batch every 5 s. `phase` is one of `cloning`, `stack_up`, `seeding`, `agent`,
  `verifying`, `pushing`, `preview_up`; `check` carries a local check's result; `cost` carries
  the running total.
- The route accepts a batch only for a `runId` linked to the task's **active** delegation. Before
  calling `POST /runs`, the process links the run with `task_delegation.task.link { kind: 'run', ref: runId }`
  (a new link kind for SPEC-002). The key belongs to the shim and never enters the run container
  (SPEC-001 *Trust boundaries*).
- The route stores the events, emits `tasks.run.progress` (`clientBroadcast`), and returns. The
  run view refreshes on that event.
- The full transcript is uploaded once at the end as a run artifact (JSONL, through
  `attachments`). It is linked from the run view and is never streamed into Open Mercato.
- Events are data from a sandbox that ran untrusted input: text is rendered as plain text and
  capped at 500 characters per event.

### Previews: how a run's stack becomes a link

SPEC-001 keeps each run's compose stack up after the PR as its preview, until the review route
closes or 72 h pass. This spec defines how that stack is reached:

- **Which service.** The target repo marks its web service in the compose file with the label
  `factory.preview: "<port>"`. A repo without the label gets no preview, and the run records
  `previewUrl: null` rather than failing.
- **Repo-hosted previews.** A target repo whose own host builds a preview per PR (e.g. Vercel)
  needs no label: the runner takes `environment_url` from the GitHub deployment status for the PR
  head, waits up to 5 minutes, and otherwise records `previewUrl: null`. Public repos link to it
  directly, without the signed redirect below. The demo site uses this
  ([SPEC-005](./SPEC-005-2026-09-19-metal-zbiorniki-www.md)).
- **Routing.** A reverse proxy (Caddy) on the runner VM serves a wildcard host
  `*.preview.<factory domain>`. When the stack is healthy, the shim adds the route
  `<runId>.preview.<domain> → run-<id>_web:<port>` through Caddy's admin API, bound to localhost.
  It removes the route on teardown. The proxy joins each run network only for the web service.
- **Auth.** Preview links in Open Mercato point to `GET /api/tasks/changes/{id}/preview`. The
  route checks `task_delegation.view` and redirects to `<runId>.preview.<domain>/__factory/enter?t=…`. The
  token is an HMAC over `{ runId, exp }`, signed with a key shared by Open Mercato and the shim,
  and valid for 60 seconds. The shim's enter handler verifies it, sets a cookie for that host
  only, and immediately redirects to `/` without the token, with `Referrer-Policy: no-referrer`,
  so the token never reaches the app, its logs or a Referer header. The cookie lasts one hour;
  after that the person opens the link from Open Mercato again, which is where revoked access
  takes effect. The proxy checks the cookie through forward auth against the shim. Links in PR
  bodies go through the same route, so a reviewer signs in to Open Mercato once.
- **Local and hackathon.** Locally, the shim returns `http://localhost:<port offset>` and skips
  auth. For the hackathon, one Cloudflare Tunnel with a wildcard hostname points at the proxy, and
  the auth route still applies.
- **Cost.** A kept preview holds a runner slot. The dispatcher counts previews against a separate
  per-project cap (default 3). Beyond it, the oldest preview is torn down first, and its entry shows
  `preview expired`.

### Showing it: the drawer panel and the run view

`staff`'s `detail:staff:staff_time_task:tabs` spot is not a tab strip in the task drawer: it renders
a contributed widget as a panel at the end of the drawer body (`staff/AGENTS.md`, *Tabs*). So:

- **Drawer panel "Changes"** (widget on `detail:staff:staff_time_task:tabs`). One row per change,
  newest first, with its kind icon, target, status and who disposed it. Each row expands inline:
  before → after fields for `record`, text and **Send as me** for `message`, PR, checks, preview
  and top files for `code`, file link for `artifact`. It includes **Revert** (Phase 2) and
  **Discard** where allowed, and a link to the Caseload item while the change is `proposed`. It renders nothing for
  a task that was never delegated.
- **Run view** at `/backend/tasks/{taskId}/runs` (our page): the process milestones, each run
  attempt with its progress timeline, cost and duration, the full file list with flags and the
  planned/unplanned split, screenshots, the preview, and the transcript download. The drawer's run
  link from SPEC-002 points here.
- **Caseload.** The Caseload has no injection spot on proposal cards in 0.8.0. The operator's
  rationale therefore ends with the task reference, and the task's decision link opens the drawer
  panel next to the Caseload item. A before → after view inside the Caseload itself is an
  upstream ask.

Both views read `GET /api/tasks/changes?taskId=…` and refresh on `tasks.change.updated` and
`tasks.run.progress`.

### Who approves which change

SPEC-001's review route takes the maximum of deterministic signals and the agent's declared risk.
This spec adds action rows to the project's review map, next to path rows:

| Change | Matched by (example) | Disposition |
|---|---|---|
| `message` staged | `tasks.change.stage_message` | auto-approve allowed by policy (the send is the human gate) |
| `record`, descriptive fields | `catalog.products.update` touching `title`, `description`, attributes | the product owner in the Caseload |
| `record`, commercial fields | `sales.orders.update`, `customers.deals.update` | the product owner; a data-owner role later |
| anything the review map doesn't match | | the product owner in the Caseload |

A record change is never auto-approved in the MVP. The tenant's auto-approval ceiling stays below
the declared risk of every record command, the same way SPEC-001 treats code.

### Out of scope, with the seam for each

| Later | Seam |
|---|---|
| Code and data in one process, data applied after merge | `factory.pr.merged` signal and a second effector step; today the slicer splits them |
| Routing a proposal to a data-owner role | a `USER_TASK` with `assignedToRoles` after the Caseload approval, as SPEC-001 does for legal |
| Create and delete commands | our own workflow-safe commands with their own snapshot semantics |
| Rendered-text diff for legal and content reviewers | the preview route plus a before/after page fetch; SPEC-001 open question |
| Before → after inside the Caseload | an upstream injection spot on `ProposalCard` |

## Design

No storyboard yet. Screens:

- **Drawer panel**, collapsed rows: `[icon] ZDP-5000 · title, description, dimensions · applied · by Norbert`
  and `[icon] PR #41 · 7 files (1 unplanned, lockfile) · checks green · preview`. States: loading
  skeleton, empty (delegated, nothing proposed yet: "Nothing proposed yet"), orchestrator
  absent (the panel hides), `conflict` (three columns: proposed against, current, proposed),
  `failed` with the command's error, `preview expired`.
- **Run view**: a milestone strip, then one card per attempt (timeline, cost, duration), then the
  change list in full.
- Colours and status badges come from the shared UI tokens, the same as SPEC-002's badge.

## Data Models

Tenant- and organization-scoped tables with standard timestamps. Task, proposal, instance and
record ids are plain ids, never ORM relations.

`tasks_change`: one row per change.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `task_id`, `delegation_id` | uuid | the delegation it belongs to; SPEC-002's stale-write guard applies |
| `process_instance_id` | uuid | |
| `proposal_id` | uuid, nullable | null for `code` |
| `action_index` | int, nullable | position in the option's actions; unique with `proposal_id` |
| `kind` | enum | `code \| record \| message \| artifact` |
| `status` | text | Phase 1: `proposed \| rejected \| applying \| applied \| conflict \| failed \| not_run`; later phases add `reverted`, `ready_to_send`, `sent`, `discarded`, `pr_open`, `merged` |
| `command_id` | text, nullable | the action type |
| `target` | jsonb | `{ entityId, recordId, label, href }` or `{ prUrl, previewUrl, runId, attempt }` or `{ messageId, conversationId }` |
| `before`, `after` | jsonb, nullable | exactly the payload's fields; `after` rewritten from the approved payload |
| `current` | jsonb, nullable | the values found on `conflict` |
| `detail` | jsonb, nullable | the code manifest, or the staged message `{ body, bodyFormat, replyAll }` |
| `risk` | enum | as declared, raised by the review route |
| `action_log_id` | text, nullable | the command's log entry, for the audit link |
| `reverts_change_id` | uuid, nullable | set on a revert change |
| `decided_by`, `applied_by` | uuid, nullable | the disposer; the principal or the person who sent |
| `error` | text, nullable | |

Indexes: `(org, task_id, created_at)`; unique `(org, proposal_id, action_index)`; unique
`(org, process_instance_id, target->>'runId', target->>'attempt')` for `code`.

`before`, `after`, `current` and `detail` hold customer data and message text: they are declared
in the module's `encryption.ts`.

`tasks_run_event`: `id`, `task_id`, `run_id`, `attempt`, `seq`, `at`, `kind`, `text`, `cost_usd`,
`data`, with a unique index on `(org, run_id, seq)`. Rows are deleted 30 days after the task's
delegation is released; the transcript artifact remains.

## API Contracts

ACL: reads need `task_delegation.view`. **Revert** needs the record command's own `requiredFeatures`.
**Send as me** needs what `reply` needs: participation in the conversation and `messages.compose`.
No new features.

Routes (per-method `metadata` and `openApi`):

- `GET /api/tasks/changes?taskId=…`: the change set with run summaries.
- `POST /api/tasks/changes/{id}/send { body? }`: for a `ready_to_send` message, runs
  `messages.messages.reply` (the command behind `POST /api/messages/{id}/reply`) as the caller
  and marks the row `sent`. Returns `409 not_ready` otherwise.
- `POST /api/tasks/changes/{id}/discard`: for a `ready_to_send` message.
- `POST /api/tasks/changes/{id}/revert` (Phase 2): for an `applied` record. It creates the
  reverse change and applies it as the caller through the same compare against `after`. It marks
  the original `reverted`, or returns `409 conflict` when the record has changed since.
- `GET /api/tasks/changes/{id}/preview`: `task_delegation.view`, then a 302 to the signed preview URL.
  Returns `410 preview_expired` after teardown.
- `POST /api/tasks/runs/{runId}/events`: bot principal API key with `task_delegation.process`; the batch
  above.
- `GET /api/tasks/runs?taskId=…` and `GET /api/tasks/runs/{runId}/events?afterSeq=…`: for the
  run view.

Workflow-safe commands (`requiredFeatures: ['task_delegation.process']`, idempotent on
`(taskId, processInstanceId, stepId)` as in SPEC-002):

- `tasks.change.stage_message { taskId, delegationId, messageId, body, bodyFormat, replyAll, sendViaEmail }`
- `tasks.change.record_run { taskId, delegationId, run }`

Workflow function: `tasks.apply_change_set { taskId, delegationId }`, registered for
`EXECUTE_FUNCTION` as a DI factory. It returns `{ applied, conflict, failed, notRun }`, which lands
at `context.<activityName>.result`, and the process routes on `conflict + failed > 0` there.

Subscriber `snapshot-change-set` on `agent_orchestrator.proposal.created` (persistent).

Events (`clientBroadcast`): `tasks.change.updated { taskId, changeId, kind, status }` and
`tasks.run.progress { taskId, runId, attempt, seq }`.

Runner (SPEC-001's contract, extended): the manifest in `factory.run.finished`, the events
batch, the preview label, and a shim endpoint `GET /preview-auth` for Caddy's forward auth.

## Implementation Approach

The hackathon needs only Phase 1. Each phase ends working and tested.

**Phase 1: record changes** (the non-code demo)

1. `tasks_change` entity, migration and encryption declaration; the target registry with
   `catalog.products.update`. *Test:* migration SQL reviewed; the unique index refuses a second
   row per `(proposal_id, action_index)`.
2. `factory.operator` agent (native, one option, `allowedActions: ['catalog.products.update']`) in
   the Playground against a seeded product. *Test:* an eval case asserting the action type and the
   exact fields for the ZDP-5000 brief.
3. `snapshot-change-set` subscriber. *Test:* a proposal for a delegated task writes `proposed`
   rows with `before`; one for an undelegated instance writes nothing.
4. `tasks.apply_change_set` with the vocabulary check, the three gates and compare-and-set; the
   seed grants `catalog.products.manage` and enables the command; the `non_code` branch in
   `factory.deliver` (operator → Caseload → apply → `in_review`, or a follow-up on conflict).
   *Tests:* applied; conflict after a concurrent edit; an edit that changes the target id is a
   conflict; a disabled command refused; a principal without the feature refused; an
   un-delegated task writes nothing; a retry after a crash between write and row update ends
   `applied`, not `conflict`.
5. Drawer panel (record rows with before → after and the audit link) and
   `GET /api/tasks/changes`. *Test:* integration: delegate → approve in the Caseload → the
   product changes and the panel shows the change.

**Phase 2: messages and revert.** `tasks.change.stage_message`, the conversation and order read
tools, the send and discard routes, the message row, and **Revert**. *Tests:* send as a
participant creates a reply authored by them and emails it on an email channel; a
non-participant sees no button; a row can't be sent twice; revert after an unrelated edit to the
product keeps that edit.

**Phase 3: runner visibility.** Manifest in the signal, `tasks.change.record_run`, the events
route and table, the run view. *Test:* the stub runner posts phases and a manifest; the run view
shows them without a reload.

**Phase 4: previews.** Compose label, Caddy routes, the signed redirect, the preview cap. *Test:*
a preview opens through `…/preview` for a user with `task_delegation.view` and returns 401 without the
token.

Validation per phase: `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn
test`; `yarn test:integration:ephemeral` after Phase 1 step 5 and at the end of Phases 2 to 4.

## Key Design Decisions

1. **A change set, not a diff.** What a task changed is a list of typed effects. Code is one kind
   and gets its PR. A record gets field-level before → after, and a message gets its rendered
   text. Open Mercato still never shows a code diff (SPEC-001 decision 3).
2. **One effector function of our own, not a step per command or `executeProposal`.**
   `UPDATE_ENTITY` runs one command per step, so a mixed plan would mean a graph branch per
   command type. `executeProposal` can't stop, compare or return log entries. Our loop reuses the
   orchestrator's vocabulary check and re-applies `UPDATE_ENTITY`'s gates, so it widens
   nothing.
3. **Compare-and-set on every record write.** A proposal can sit in the Caseload for hours.
   Overwriting a person's later edit is worse than asking again. This answers the stale-context
   hazard the catalog module cites, without waiting for upstream.
4. **Drafts are ours; sending is a person's.** No identity the factory holds can reach a customer,
   so no auto-approval policy can either. The recipient sees the person who sent.
5. **Updates only, from core's declared list.** The vocabulary is what core declares
   workflow-safe, per tenant. Creates, deletes and prices stay with people until they have their
   own commands and review.
6. **Coarse progress pushed, transcript uploaded once.** Open Mercato stores what a person watches,
   not every token. The transcript stays an artifact.
7. **Previews behind Open Mercato's ACL.** A preview can show seeded or real data. The one way in
   is a signed link from a route that checks `task_delegation.view`.

## Open Questions

- **Reply as the assignee on an email-mirrored conversation.** Confirm that `messages.messages.reply`
  with `sendViaEmail` uses the sender's channel identity and not a system address, and which
  permission a non-participant needs. Resolves: Phase 2.
- **Synchronous snapshot.** `proposal.created` is emitted before disposition, but its persistent
  subscriber is queued, so a fast approval can beat it (see *Missing snapshot*). A snapshot taken
  in the proposal's own transaction would need an upstream hook, such as a proposal-created
  interceptor. Worth asking for if conflicts on fast approvals ever matter. Resolves: at the event.
- **Caseload rendering.** Ask upstream for an injection spot on `ProposalCard` (or a per-action
  renderer registry), so that before → after renders where the decision is made. Resolves: at the
  event.
- **Preview data.** A preview seeded from fixtures is safe to share; one pointing at a copy of
  production data is not. The compose label should also declare the seed. Decide before the first
  real target.

## Changelog

<!-- Record, not state: rows are closed once dated — append, never rewrite. -->

| Date | Change |
|------|--------|
| 2026-09-18 | Draft: change set with `code`, `record`, `message` and `artifact` kinds; one effector function with compare-and-set; person-sent messages; runner progress events and manifest; previews behind a signed redirect. |
| 2026-09-18 | Fresh-context review applied: own effector loop instead of `executeProposal`; record grants in the seed; revert as a compared reverse change instead of platform undo (moved to Phase 2); edited-proposal, replay, stale-delegation and normalisation rules; send limited to conversation participants with `sendViaEmail`; run-scoped events; preview token stripped on entry. |
| 2026-09-18 | Examples moved from the Oak table to the demo company's ZDP-5000 tank (SPEC-004). |
| 2026-09-19 | Repo-hosted previews (GitHub deployment status) as an alternative to the compose label (SPEC-005). |
