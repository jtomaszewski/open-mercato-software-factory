# SPEC-006: Factory tools: task management AI tools over MCP

**Status**: Draft
**Owner**: HackOn team · **Date**: 2026-09-19 · **Tracker**: —
**Parent**: [SPEC-001](./SPEC-001-2026-09-18-agentic-software-factory.md) (the factory),
[SPEC-002](./SPEC-002-2026-09-18-tasks-module.md) (the task board and delegation).
**Glossary**: [`CONTEXT.md`](../../CONTEXT.md) · **Decisions**: [ADR-0001](../adr/0001-factory-tools-in-their-own-module.md)

## TLDR

A developer in Claude Code (or Marek in any other MCP client) says "file a task for WEB: ZDP-5000
holds 5 200 l, not 5 000, and the dimensions are missing; hand it to the factory", and a delegated
task is on the board with a link back. The same client can read a task, search tasks, list
projects and comment.

This is one app module, **`factory_tools`**, with five AI tools registered through `defineAiTool`
and served by the Open Mercato MCP server: `create_task`, `get_task`, `search_tasks`,
`list_projects`, `comment_task`. Everything is built on installed capabilities: the core `staff`
task board (0.8.0), the `ai_assistant` MCP server and, when installed, the `tasks` module for
delegation. The tools write nothing but tasks and comments.

## Problem Statement

- **Tasks reach the board only by hand.** The MCP clients the team already works in cannot file,
  read or comment on a task. SPEC-002 designs intake as `tasks_create` inside the `tasks` module,
  but that module is being built by another person and is on no remote branch the day before the
  freeze.
- **Two specs name the same write tool twice** (`factory_send_task` in SPEC-001,
  `tasks_create` in SPEC-002) with different inputs, and SPEC-002's traceability key
  `source_ref = '{conversationId}:{messageId}'` is not obtainable: in 0.8.0 a tool handler
  receives no conversation or message id (verified in `McpToolContext`).

## Overview and Success Measures

- **Primary outcome:** from an MCP client, one request → delegated task on the board in under 60
  seconds, with no manual task creation.
- **Leading indicators:** `yarn mercato ai_assistant mcp:list-tools` lists the five tools; Claude
  Code connected with a task-only API key creates, reads and comments on a task.
- **Baseline:** no intake exists beyond the board UI; the demo's fallback is a hand-made task
  (SPEC-004 fallback table).
- **Market / product reference:** Linear's agent delegation, GitHub's "assign an issue to the
  coding agent", Warp's Factory MCP `send_task`. Adopted: one write ("create the work item,
  optionally hand it to the agent") with a link back. Rejected: a tool that edits records or the
  site; per-user OAuth for the external client.

## Goals

- **REQ-001** — An MCP client whose API key may manage tasks creates a `staff` task; the result
  carries the reference and a link to the board.
- **REQ-002** — With `delegate: true` and the `tasks` module installed, the created task is
  delegated to the factory agent in the same call; without the module or the permission it lands
  in the backlog and the result says why.
- **REQ-003** — An MCP client can read a task by reference or id, search tasks and list projects,
  seeing exactly what the key's user sees on the board.
- **REQ-004** — An MCP client can add a comment to a task under the key's user's name.
- **REQ-005** — The tools are listed by the Open Mercato MCP server to a client whose API key holds
  only the task features; the repository documents how to connect one.
- **REQ-006** — Every task created by these tools records its intake source and the client's
  `clientRef` in a visible footer.

## Non-goals

- Tools write only tasks and comments; no catalog or site mutations (catalog and site changes go
  through the factory, SPEC-001).
- No in-app chat agent and no approval card; the tools are defined with `defineAiTool`, so a chat
  agent can allow-list them later without changing them.
- No moving tasks between columns and no un-delegation (SPEC-002 guard; user decision).
- No `tasks_intake` dedupe table and no migration of our own; it stays with the `tasks` owner.
- No two-way handoff (pull a task into a session, push a session's result) — SPEC-001 roadmap.
- No new pages, widgets or ACL features.

## Proposed Solution

One app module, `src/modules/factory_tools/`, with:

- **`ai-tools.ts`** — five tools, dot-namespaced like core (`factory_tools.create_task`,
  `factory_tools.get_task`, `factory_tools.search_tasks`, `factory_tools.list_projects`,
  `factory_tools.comment_task`). Writes are declared `isMutation: true`, so the runtime classifies
  them as writes; over MCP they execute on call.
- **`index.ts`** — module metadata.
- **`lib/*`** — scope guard, `staff` client, `tasks` client, footer.

No `acl.ts`: the tools require the board's own features, `staff.timesheets.tasks.view` and
`staff.timesheets.tasks.manage`, so the tools' ACL is the board's ACL (SPEC-002 principle).

Task creation goes through the installed `staff` API (`POST /api/staff/timesheets/tasks`) via
`createAiApiOperationRunner`, the pattern core's own mutation tools use, so route ACL, validation
and `staff`'s events apply unchanged. Delegation calls the `tasks` module's HTTP contract from
SPEC-002 (`GET /api/tasks/agents`, `POST /api/tasks/delegations`) only when that module is
installed; the dependency is optional and detected at call time.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Own module `factory_tools`, not `tasks` (ADR-0001) | `tasks` is on another person's local branch; zero shared files; testable today against core `staff` | Files inside `src/modules/tasks/` as SPEC-002 sketches | Nothing runs until the other branch lands; merge into the same directory hours before the freeze |
| MCP server as the only surface | Scope decision of the repo owner; the team already works in MCP clients | In-app chat agent with an approval card | Deferred: `defineAiTool` lets a chat agent reuse the tools unchanged |
| One write tool, one input shape | SPEC-001 (`factory_send_task`) and SPEC-002 (`tasks_create`) named the same thing twice | Two tools | Two names for one action confuse the model and the MCP client; SPEC-001 gets a changelog row |
| Dot-namespaced names (`factory_tools.create_task`) | Core convention; the MCP server passes names through verbatim (verified 0.8.0) | Underscores as in SPEC-002 | Would be the only pack breaking the convention |
| Task ACL = `staff` features | No new roles or features | An own feature set | Duplicates what the board already gates |
| Delegate resolved from `GET /api/tasks/agents` **before the write** | Exactly one agent on the demo → zero configuration; several and none named → the call fails with the list before any task exists | Env var or module setting; resolving after creation | Configuration the board already knows; failing after creation would leave a task behind |
| `project` is required, no default | User decision: no hidden default | Env var with the site project key | A wrong default silently files tasks in the wrong project |
| Source recorded as a description footer | `staff` tasks carry no source field; the `tasks_intake` table is the `tasks` owner's | Custom fields on the `staff` task | Extra field installation now; noted as roadmap |
| Informational `clientRef`, no dedupe | MCP has no per-call id, and a field called "idempotency key" that does not deduplicate would be a false contract | Own dedupe table; an `idempotencyKey` input | Migration hours before the freeze; a no-op key becomes a compatibility trap when it later starts deduplicating |

## Domain Vocabulary and Business Rules

Terms are defined in [`CONTEXT.md`](../../CONTEXT.md); the rules below are the ones this spec adds.

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| **Intake footer** | `— Intake: mcp · ref {clientRef}` (`—` when no `clientRef`), appended after the description, separated by a blank line | Tool handler | Never omitted |
| **Delegation from intake** | Decided **before** the task is written: allowed when the key's user could delegate on the board (`tasks.delegate`) and `GET /api/tasks/agents` returns exactly one agent, or the input names `agentUserId` | `tasks` module (SPEC-002) | Several agents and no `agentUserId` → `ambiguous_agent` with the list, nothing written; missing module, no permission or zero agents → task created in the backlog with `reason`; delegation call fails after the task was created → `delegated: false, reason: 'delegation_failed'`, task stays in backlog, no automatic retry |
| **Task body** | Markdown, ≤ 8 000 chars including the footer: title (≤ 255), context, acceptance criteria. `links[]` are appended before the footer as a Markdown list "Links:" | `staff` validators | Over length → validation error to the client, which shortens and retries |
| **Untrusted text** | Task comments and descriptions read from the board are untrusted prompt input for the client's model | SPEC-002 | Returned only as data fields; tool descriptions say so |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| MCP client with a task-manager key (developer's Claude Code, Marek's Claude Desktop) | create task, delegate, comment, read tasks and projects | tenant + organisation of the API key; the key's user must **have a staff member** (otherwise `staff` answers `assignee_required`); task visibility = projects the user is a member of, or all with `staff.timesheets.manage_all` | `staff.timesheets.tasks.view`, `staff.timesheets.tasks.manage`, `tasks.delegate` (for delegation); **never** `catalog.products.manage` |
| MCP client with a read-only key | read tasks and projects | same | `staff.timesheets.tasks.view`, `staff.timesheets.projects.view` |
| Factory agent (workflow principal) | none of these tools | — | — |

`tenantId` and `organizationId` come only from `McpToolContext` (the API key); both must be
present or the handler throws before any read (`requireToolScope`, the `example` pattern). No
input field carries scope. There is no system-scope operation in this module. The `staff` list
route already narrows tasks to the caller's project memberships, so `search_tasks` and
`get_task` cannot show a task the caller could not open on the board.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Tasks, projects, references, comments, board | reuse | `staff` (core 0.8.0) | HTTP routes via `createAiApiOperationRunner`; ids only | The board is the source of truth (SPEC-002) |
| Delegation, agents list, run state | reuse, optional | `tasks` (SPEC-002, in progress) | its HTTP routes called in-process through `createAiApiOperationRunner` (no raw fetch), 5 s per call; route absent (404) → degraded | Owned by another person; must not block us |
| MCP server, API-key auth, tool registry | reuse | `ai_assistant` | module-root `ai-tools.ts` read by `yarn generate` | Standard surface |
| Tool pack | app-own | `factory_tools` (new) | `ai-tools.ts`, `index.ts` | The only new surface |

## Architecture and Data Flow

```text
MCP client ──▶ POST /mcp (x-api-key) ──▶ ai_assistant MCP server (ACL from the key's user)
   ├─▶ factory_tools.create_task (isMutation)
   │     ├─▶ [delegate && tasks installed?] GET /api/tasks/agents → one agent, or ambiguous_agent (nothing written)
   │     ├─▶ POST /api/staff/timesheets/tasks  (staff, existing)  → task {id, reference}
   │     └─▶ POST /api/tasks/delegations → tasks.task.delegated → SPEC-001 start-factory
   └─▶ get_task / search_tasks / list_projects / comment_task ──▶ staff routes [+ GET /api/tasks/delegations]
```

- **Module boundaries:** `factory_tools` owns no records. It owns the tool definitions. Tasks
  stay in `staff`; delegation stays in `tasks`.
- **Extension points:** module-root `ai-tools.ts`. No ACL, setup, widget, interceptor or
  subscriber.
- **Alternatives considered:** a `tasks`-module-only design (SPEC-002 as written) — rejected in
  ADR-0001; a Code Mode script instead of five tools — rejected because typed, individually
  gated tools are what an MCP client lists and a user can approve one by one.
- **Compatibility:** no installed contract changes. SPEC-001's `factory_send_task` name is retired
  in favour of `factory_tools.create_task` (changelog row in SPEC-001). SPEC-002's intake tool
  `tasks_create` is superseded by this spec (changelog row in SPEC-002); its `tasks_intake` table
  remains that module's roadmap. Tool names and input shapes below become a contract for MCP
  clients once shipped (`BACKWARD_COMPATIBILITY.md` applies to renames).

## User Journeys

### Journey J-001 — A request becomes a delegated task

1. A developer creates an API key (Settings → API Keys, or `mcp:ensure-api-key`) for a user whose
   role holds `staff.timesheets.tasks.view`, `.manage` and `tasks.delegate` **and who has a staff
   member** (the README says so; without one `staff` refuses with `assignee_required`).
2. Claude Code is configured with `{"mcpServers":{"open-mercato":{"type":"http","url":"http://localhost:3001/mcp","headers":{"x-api-key":"omk_…"}}}}`.
3. The developer types: "file a task: ZDP-5000 holds 5 200 l, not 5 000, and the dimensions are
   missing; hand it to the factory". The client calls `factory_tools.list_projects` and asks which
   project if more than one exists.
4. It calls `factory_tools.create_task { project: 'WEB', title, description, delegate: true, clientRef }`.
   The handler resolves the single agent, creates the task (`WEB-13`, assignee = the key user's
   staff member), appends the footer and delegates it. The result is
   `{ reference: 'WEB-13', statusSlug: 'queued', delegated: true, href }`; the board shows the card
   with the delegate badge (SPEC-002 widget).
5. Failures: no `tasks.delegate` or `tasks` absent → task in backlog, `reason` returned; several
   agents and none named → `ambiguous_agent` with the list, nothing written, the client asks and
   retries with `agentUserId`; delegation call fails after the task exists → task in backlog,
   `delegation_failed`; description over 8 000 chars → validation error, the client shortens.
   `clientRef` does **not** deduplicate; the README tells the client to call once.

### Journey J-002 — "What is happening with WEB-13?"

1. Anyone whose key holds `staff.timesheets.tasks.view` asks the client about `WEB-13`.
2. `factory_tools.get_task { reference: 'WEB-13' }` returns the task, its column, parent,
   comments, and, when `tasks` is installed, the delegation (agent, run state, links to the
   instance, Caseload item, PR, preview) from `GET /api/tasks/delegations?taskIds=`.
3. The user adds "customer confirmed 5 200 l" → `factory_tools.comment_task { task: 'WEB-13', body }`;
   the comment appears in the board drawer under the key user's name.
4. A caller who is not a member of the task's project gets `{ found: false }` — the `staff` route
   returns no row, not a redacted one.

## UI and Interaction Contracts

N/A — no new page, route, menu entry or widget. The consumer is an MCP client; tasks and comments
appear in the installed `staff` board and drawer. `href` in results is the task's project board
(`/backend/staff/time-tracking/projects/{projectId}/board`) with the drawer deep link the `staff`
board exposes (Q-002).

### UI architecture

N/A. Localization: no user-facing strings; tool `displayName`s and descriptions in English
(runtime convention); errors and reasons are machine-readable codes.

## Data Models

N/A — no new entity, table, migration or configuration. The module persists nothing of its own.

Description footer (persisted inside `staff_time_tasks.description`, ≤ 8 000 chars total):
`\n\n— Intake: mcp · ref <clientRef>`.

## API, Command, and Error Contracts

No new HTTP route or command. The contracts are the five tools and the installed routes they
call. All tools: scope from `McpToolContext` only; handlers parse `unknown` input again with the
declared Zod schema.

| Tool | Gate | Input | Success result | Errors / concurrency | REQ |
|---|---|---|---|---|---|
| `factory_tools.create_task` (`isMutation`) | `staff.timesheets.tasks.manage` | `{ project: string (project id or code), title: 1..255, description?: ≤ 7 800 md, delegate?: boolean, agentUserId?: uuid, links?: [{ kind: 'record'\|'url'\|'pr', label, href }] ≤ 10, clientRef?: 1..128 (informational) }` | `{ taskId, reference, projectId, statusSlug, delegated: boolean, delegationId?, reason?: 'tasks_module_absent'\|'no_permission'\|'no_agent'\|'delegation_failed', href }` | `project_not_found` (also for another tenant's code); `ambiguous_agent` with the agent list (nothing written); `staff` 422 `assignee_required`; delegation failure after creation → task kept, `delegated: false` | 001, 002, 006 |
| `factory_tools.get_task` | `staff.timesheets.tasks.view` | `{ reference?: string, taskId?: uuid }` (one required) | `{ task: { id, reference, title, description, statusSlug, projectId, projectCode, assignee, parent?, updatedAt }, comments: [{ id, authorName, body, createdAt }] ≤ 50, delegation?: { agentId, agentLabel, runState, outcome?, links: [{ kind, url }] } }` | not found or not visible → `{ found: false }` | 003 |
| `factory_tools.search_tasks` | `staff.timesheets.tasks.view` | `{ query?: string, project?: string, status?: string (slug), limit?: 1..50 = 20 }` | `{ items: [{ id, reference, title, statusSlug, projectCode, hasDelegate }], totalCount }` | none beyond ACL | 003 |
| `factory_tools.list_projects` | `staff.timesheets.projects.view` | `{}` | `{ items: [{ id, code, name, isMember }] }` | none | 001, 003 |
| `factory_tools.comment_task` (`isMutation`) | `staff.timesheets.tasks.manage` | `{ task: reference or id, body: 1..5000 }` | `{ commentId, taskId, reference }` | task not visible → `task_not_found` | 004 |

Installed routes consumed (unchanged): `POST/GET /api/staff/timesheets/tasks` (query: `q`,
`reference`, `id`, `timeProjectId`, `taskStatusId`, `pageSize` ≤ 100), `GET/POST
/api/staff/timesheets/tasks/{id}/comments`, `GET /api/staff/timesheets/time-projects`; from
`tasks` when installed: `GET /api/tasks/agents`, `POST /api/tasks/delegations { taskId, agentUserId }`,
`GET /api/tasks/delegations?taskIds=`. `project` accepts a project **code** (`WEB`) or id; codes
are unique per organisation (`staff_time_projects_code_unique_idx`).

MCP surface: the five names appear in `mcp:list-tools`; calls execute immediately (no approval
step on the server; most clients ask the user before a tool call). The README section "Connect an
MCP client" documents the key, the role recommendation above and the no-dedupe rule.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `tasks.task.delegated` | `tasks` (via our `POST /api/tasks/delegations`) | SPEC-001 `start-factory` | run starts | `task:{taskId}:{delegationId}` key (SPEC-002) |

This module emits no event of its own; `staff` emits its usual task and comment events for the
writes we make. No scheduled job.

## Security, Privacy, and Compliance

- **Authorization:** tool `requiredFeatures` are checked by the MCP server in ListTools and
  CallTool; every write also passes the `staff` route's own `requireFeatures`. No role-name
  checks. The pack contains no catalog or site write tool.
- **Tenant isolation:** scope from context only; `requireToolScope` fails closed. `staff` list
  routes narrow to project membership.
- **Sensitive data:** task titles and bodies may quote customer names typed by the user; they are
  stored where `staff` stores every task description (no new store). API keys are never echoed;
  the README shows a placeholder.
- **Abuse and failure modes:** prompt injection — comments and descriptions are returned as data
  and labelled untrusted in the tool descriptions. Replay — MCP writes are not deduplicated
  (documented). Enumeration — `get_task` answers `found: false` identically for missing and
  invisible tasks; `project` codes resolve inside the caller's organisation only.

## Integration Coverage

Tests are self-contained: they seed a tenant, a user with a staff member, and a project with the
default status.

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | tenant, user with `staff.timesheets.tasks.manage`, project `WEB` | `create_task { clientRef }` via the tool test runner | task exists with reference `WEB-n`, default status, assignee = caller's staff member, footer `Intake: mcp · ref <clientRef>`; `delegated: false, reason: 'tasks_module_absent'` | REQ-001, REQ-006 |
| TEST-002 | security | user without `staff.timesheets.tasks.manage` | `create_task`, `comment_task` | ACL denial before the handler; no row written | REQ-001, REQ-004 |
| TEST-003 | integration | `tasks` HTTP contract stubbed: one agent | `create_task { delegate: true }` | handler calls `POST /api/tasks/delegations` with the task id and that agent; `delegated: true` | REQ-002 |
| TEST-004 | integration | stub returns two agents | `create_task { delegate: true }` | `ambiguous_agent` with both agents; no task row; retry with `agentUserId` succeeds | REQ-002 |
| TEST-005 | integration | project membership: caller not a member of `OPS` | `search_tasks`, `get_task` for an `OPS` task | `found: false`; `OPS` task absent from results | REQ-003 |
| TEST-006 | integration | task `WEB-1` | `comment_task` | comment row with `authorUserId` = caller; body verbatim | REQ-004 |
| TEST-007 | contract | generated registries | `mcp:list-tools` output | five tool names with the `factory_tools.` prefix; `create_task` and `comment_task` marked `isMutation` | REQ-005 |
| TEST-008 | manual (demo rehearsal) | seeded demo tenant, Claude Code with a task-manager key | J-001 and J-002 | `WEB-n` on the board with the delegate badge; comment in the drawer | REQ-001, REQ-002, REQ-004 |
| TEST-009 | integration (MCP) | HTTP MCP server with an API key whose user holds only the two task features and has a staff member | `tools/list`, then `tools/call factory_tools.create_task { clientRef }` twice | list contains the five tools and no `catalog.*` mutation tool; task created with footer `Intake: mcp · ref <clientRef>`; second identical call creates a second task (documented) | REQ-005, REQ-006 |
| TEST-010 | integration | `tasks` stub: delegation with run state `in_design` and links | `get_task { reference }` | `delegation` present with agent label, run state and links; absent when the stub returns 404 | REQ-003 |
| TEST-011 | security | tenant A and tenant B both with a project coded `WEB` | tenant B caller: `create_task { project: 'WEB' }`, `search_tasks { project: 'WEB' }` | resolves only B's project; A's tasks never appear; A's id as `project` → `project_not_found` | REQ-001, REQ-003 |

## Implementation Phases

### Phase 1 — Task tools on the `staff` board (works without `tasks`)

- **Depends on:** `staff`, `planner`, `resources` enabled in `src/modules.ts` (the same edit the
  `tasks` owner makes); `yarn generate`.
- **Outcome:** an MCP client creates, reads, searches and comments on tasks and lists projects.
- **Why this order / value delivered:** intake works even if `tasks` never lands (task in
  backlog, delegated by hand as today's fallback).
- **Deliverables:** `src/modules/factory_tools/{index.ts, ai-tools.ts, lib/scope.ts,
  lib/staff-api.ts, lib/intake-footer.ts, __tests__/*}`; `modules.ts` entry; README section
  "Connect an MCP client".
- **Independent slices / estimated commits:** (a) scaffold + read tools; (b) `create_task` +
  footer; (c) `comment_task`; (d) README + `mcp:list-tools` check. ~4 commits.
- **Requirements closed:** REQ-001, REQ-003 (board part), REQ-004, REQ-005, REQ-006.
- **Tests:** TEST-001, TEST-002, TEST-005, TEST-006, TEST-007, TEST-009, TEST-011.
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn test src/modules/factory_tools`;
  `yarn mercato ai_assistant mcp:list-tools | grep factory_tools.`.
- **Exit gate:** J-001 without delegation from Claude Code; a key without
  `staff.timesheets.tasks.manage` does not see the write tools.

### Phase 2 — Delegation through the `tasks` module

- **Depends on:** Phase 1 exit gate; `tasks` module installed with `GET /api/tasks/agents`,
  `POST /api/tasks/delegations`, `GET /api/tasks/delegations` as in SPEC-002 (Q-001).
- **Outcome:** `delegate: true` delegates in the same call; `get_task` shows delegation and run
  state.
- **Why this order / value delivered:** the full "appears, delegated" flow and J-002 with run
  state; last because it is the only external dependency.
- **Deliverables:** `lib/tasks-api.ts` (feature-detected client), delegation branch in
  `create_task`, enrichment in `get_task`.
- **Independent slices / estimated commits:** (a) client + detection; (b) create branch; (c)
  get enrichment. ~3 commits.
- **Requirements closed:** REQ-002, REQ-003 (delegation part).
- **Tests:** TEST-003, TEST-004, TEST-010, TEST-008.
- **Validation:** as Phase 1; rehearsal with the `tasks` branch merged.
- **Exit gate:** J-001 step 4 shows the delegate badge on the board within seconds of the call;
  with `tasks` disabled the same call lands in backlog with the reason.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001 | `factory_tools.create_task`, `POST /api/staff/timesheets/tasks` | Phase 1 | TEST-001, TEST-002, TEST-011, TEST-008 | AC-001 |
| REQ-002 | J-001 steps 4–5 | `GET /api/tasks/agents`, `POST /api/tasks/delegations`, `tasks.task.delegated` | Phase 2 | TEST-003, TEST-004, TEST-008 | AC-002 |
| REQ-003 | J-002 | `get_task`, `search_tasks`, `list_projects`, `GET /api/tasks/delegations` | Phase 1, 2 | TEST-005, TEST-010, TEST-011 | AC-003 |
| REQ-004 | J-002 step 3 | `comment_task`, `POST …/tasks/{id}/comments` | Phase 1 | TEST-002, TEST-006 | AC-004 |
| REQ-005 | J-001 steps 1–2 | MCP server ListTools/CallTool, README | Phase 1 | TEST-007, TEST-009 | AC-005 |
| REQ-006 | footer | `clientRef` | Phase 1 | TEST-001, TEST-009 | AC-006 |

Extension-surface traceability (per `.ai/guides/spec-delivery.md`; reference files from
`src/modules/example/references/surface-inventory.json`, all `readable`):

| Surface | Requirement | Reference capability / exact file | Phase | Self-contained test | Mechanism |
|---|---|---|---|---|---|
| Module metadata | REQ-005 | `module.metadata` / `src/modules/example/index.ts` | 1 | TEST-007 (registry lists the module's tools) | `emitted-example` |
| AI tool pack (five tools) | REQ-001…006 | `ai.tool-pack` / `src/modules/example/ai-tools.ts` | 1–2 | TEST-001…007, TEST-009…011 | `emitted-example` |

Not used: `ai.agent`, `ai.agent-extension`, `ai.tool-override`, `ai.agent-override`, ACL
features, setup, i18n, entities, routes, widgets, subscribers.

## Rollout, Migration, and Rollback

- **Migration:** none. `yarn db:generate` must report no change for this module.
- **Enable:** add `{ id: 'staff' }`, `{ id: 'planner' }`, `{ id: 'resources' }` (core) and
  `{ id: 'factory_tools', from: '@app' }` to `src/modules.ts`; `yarn generate`. Restart the MCP
  process so ListTools includes the pack.
- **Rollback:** remove the `modules.ts` entry and re-run `yarn generate`; tasks already created
  remain ordinary `staff` tasks with a footer. Revoke any API key issued for a client.
- **Observability:** tool calls are logged by `ai_assistant`.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| `tasks` module lands with a different HTTP contract than SPEC-002 | Phase 2 breaks; delegation unavailable | Client isolated in `lib/tasks-api.ts`; detection returns `tasks_module_absent`; agreed today with the owner (Q-001) | Falls back to manual delegation |
| The key's user has no staff member | `staff` returns `assignee_required` (422) | README says so; demo tenant seeds the user as a staff member | None on the demo |
| Description with footer exceeds 8 000 chars | Validation error | Tool caps `description` at 7 800 and tells the client | None |
| MCP writes execute immediately and are not deduplicated | A client can file tasks freely or twice | Narrow role, no catalog features; client-side tool approval; README says so | Accepted |
| Dotted tool names rejected by a specific MCP client | External client cannot call | Core tools already carry dots; one verification call from Claude Code in Phase 1 | Client-specific |
| Client model invents a project | Wrong task | `project` required, no default; `project_not_found` error | Model behaviour |

## Acceptance Criteria

- [ ] **AC-001** — A client whose key holds `staff.timesheets.tasks.manage` creates a task with a
  `staff` reference, default status, the key's user as assignee and the intake footer; the result
  links it.
- [ ] **AC-002** — With `tasks` installed and one agent, `delegate: true` results in
  `tasks.task.delegated` for the new task within the same call; several agents and none named
  write nothing; without the module or the permission the task is in backlog and the result names
  the reason.
- [ ] **AC-003** — `get_task`/`search_tasks` return only tasks the caller can open on the board;
  invisible and missing tasks are indistinguishable.
- [ ] **AC-004** — A comment posted through `comment_task` appears in the drawer under the key
  user's name.
- [ ] **AC-005** — `mcp:list-tools` lists the five tools; a client with a task-only API key
  creates a task and cannot list any `catalog.*` mutation tool.
- [ ] **AC-006** — Every task created by the tools carries `— Intake: mcp · ref …`.
- [ ] Every tool has self-contained integration coverage (TEST-001…007, 009…011); the journeys
  are additionally rehearsed by hand (TEST-008); the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`, `.ai/guides/spec-delivery.md`, `.ai/guides/ai-workflows.md`, `src/modules/example/README.md`, `example/ai-tools.ts`; 0.8.0 sources of `ai_assistant` and `staff` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | traceability table; every REQ has tests and an AC |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001 in Phase 1 (+2), J-002 in Phases 1/2 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse map: `staff`, `ai_assistant`, `tasks`; no entity, route or widget |
| UI contracts identify references, canonical components, and theme/state coverage | pass | N/A: no UI; results link to the installed board |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 1–2 |

Verdict: `Blocked — user approval of the spec`. Q-001 gates Phase 2 only; Phase 1 has no external
dependency.

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Does the `tasks` module ship `GET /api/tasks/agents`, `POST /api/tasks/delegations { taskId, agentUserId }` and `GET /api/tasks/delegations?taskIds=` exactly as SPEC-002 states, and the feature `tasks.delegate`? | `tasks` owner | Phase 2 only | pending, to confirm 2026-09-19 |
| Q-002 | Exact deep-link parameter of the `staff` board drawer for the result `href` | implementer | no | read from the installed board page in Phase 1 |
| Q-003 | `.ai/agentic.config.json` points `paths.specs` at `.ai/specs` while SPEC-001…006 live in `docs/specs/`; align the config with the ledger? | repo maintainers | no | housekeeping; this spec follows the team's `docs/specs` ledger by the author's decision of 2026-09-19 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Initial draft after a two-round design interview; scope limited to task management tools over the Open Mercato MCP server by the repo owner's decision. Own module `factory_tools` (ADR-0001); one write tool replacing SPEC-001's `factory_send_task` and SPEC-002's `tasks_create`; dot-namespaced names; ACL reuses `staff` features; delegate resolved from the `tasks` agents list before the write, ambiguous agent writes nothing; project always required; intake footer instead of a dedupe table; informational `clientRef`; `source_ref` not obtainable because 0.8.0 exposes no conversation id to handlers. |
