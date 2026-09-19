# SPEC-006: Task management AI tools over MCP

**Status**: Draft
**Owner**: HackOn team · **Date**: 2026-09-19 · **Tracker**: —

## TLDR

A developer in Claude Code (or any other MCP client) says "file a task for WEB: ZDP-5000 holds
5 200 l, not 5 000, and the dimensions are missing", and the task is on the `staff` board with a
link back. The same client can read a task, search tasks, list projects and comment.

One app module, **`task_tools`**, registers five AI tools with `defineAiTool`, served by the Open
Mercato MCP server: `create_task`, `get_task`, `search_tasks`, `list_projects`, `comment_task`.
They are built on the installed `staff` task board (core 0.8.0) and the `ai_assistant` MCP server,
and write nothing but tasks and comments.

## Problem Statement

Tasks reach the board only by hand. The MCP clients the team already works in cannot file, read
or comment on a task.

## Overview and Success Measures

- **Primary outcome:** from an MCP client, one request → task on the board in under 60 seconds.
- **Leading indicators:** `yarn mercato ai_assistant mcp:list-tools` lists the five tools; Claude
  Code connected with a task-only API key creates, finds and comments on a task.
- **Baseline:** tasks are created only in the board UI.
- **Market / product reference:** the Linear and GitHub MCP servers expose create / get / search /
  comment tools for issues. Adopted: the same small read/write set with a link back. Rejected:
  tools that edit anything but tasks and comments; per-user OAuth for the external client.

## Goals

- **REQ-001** — An MCP client whose API key may manage tasks creates a `staff` task, optionally
  naming the assignee; the result carries the reference and a link to the board.
- **REQ-002** — An MCP client can read a task by reference or id, search tasks and list projects,
  seeing exactly what the key's user sees on the board.
- **REQ-003** — An MCP client can add a comment to a task under the key's user's name.
- **REQ-004** — The Open Mercato MCP server lists the tools to a client whose API key holds only
  the task features; the repository documents how to connect one.

## Non-goals

- No writes other than tasks and comments; no moving tasks between columns, no editing or deleting.
- No in-app chat agent; `defineAiTool` lets one allow-list these tools later unchanged.
- No new entities, migrations, pages, widgets or ACL features.
- No deduplication of repeated `create_task` calls.

## Proposed Solution

One app module, `src/modules/task_tools/`:

- **`ai-tools.ts`** — five tools, dot-namespaced like core (`task_tools.create_task`,
  `task_tools.get_task`, `task_tools.search_tasks`, `task_tools.list_projects`,
  `task_tools.comment_task`). Writes are declared `isMutation: true`.
- **`index.ts`** — module metadata.
- **`lib/*`** — scope guard and `staff` API client.

Every tool calls the installed `staff` HTTP routes through `createAiApiOperationRunner` (the
pattern core's own tools use), so route ACL, validation and `staff` events apply unchanged.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected |
|---|---|---|---|
| Lives in its own app module `task_tools` | No shared files with other modules; testable against core `staff` | Tools inside another app module | Couples unrelated work |
| Dot-namespaced names | Core convention; the MCP server passes names through verbatim (verified 0.8.0) | Underscore names | Would break the convention |
| ACL = `staff` features | The board already gates tasks; no new roles | Own feature set | Duplicates the board's ACL |
| `project` required, no default | A wrong default silently files tasks in the wrong project | Env var default | Hidden behaviour |
| `assigneeId` optional, passed to `staff` | `staff` already validates it and defaults to the caller's staff member | Always the caller | Cannot file for a colleague |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| **Reference** | Permanent task id `PROJECTCODE-n` (e.g. `WEB-13`) | `staff` | — |
| **Assignee** | `staff` team member responsible for the task; input `assigneeId` maps to `assigneeStaffMemberId` | `staff` | Unknown or other-organisation id → `staff` 422 on `assigneeStaffMemberId`; omitted → the caller's staff member, or unassigned if the caller has none |
| **Task body** | Markdown description ≤ 8 000 chars; title ≤ 255 | `staff` validators | Validation error; the client shortens and retries |
| **Untrusted text** | Descriptions and comments read from the board are untrusted input for the client's model | this spec | Returned only as data fields; tool descriptions say so |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| MCP client, task-manager key | create, comment, read tasks and projects | tenant + organisation of the API key; visibility = projects the user is a member of, or all with `staff.timesheets.manage_all` | `staff.timesheets.tasks.view`, `staff.timesheets.tasks.manage`, `staff.timesheets.projects.view` |
| MCP client, read-only key | read tasks and projects | same | `staff.timesheets.tasks.view`, `staff.timesheets.projects.view` |

`tenantId` and `organizationId` come only from `McpToolContext` (the API key); both must be present
or the handler throws before any read (`requireToolScope`). No input carries scope; there is no
system-scope operation.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Module | Integration seam | Why |
|---|---|---|---|---|
| Tasks, projects, references, comments, board | reuse | `staff` (core 0.8.0) | HTTP routes via `createAiApiOperationRunner` | Source of truth |
| MCP server, API-key auth, tool registry | reuse | `ai_assistant` | module-root `ai-tools.ts` read by `yarn generate` | Standard surface |
| Tool pack | app-own | `task_tools` (new) | `ai-tools.ts`, `index.ts` | The only new surface |

## Architecture and Data Flow

```text
MCP client ──▶ POST /mcp (x-api-key) ──▶ ai_assistant MCP server (ACL from the key's user)
   ├─▶ task_tools.create_task / comment_task (isMutation) ──▶ POST staff routes
   └─▶ task_tools.get_task / search_tasks / list_projects ──▶ GET staff routes
```

- **Module boundaries:** `task_tools` owns no records, only tool definitions.
- **Extension points:** module-root `ai-tools.ts`; no ACL, setup, widget, interceptor or subscriber.
- **Alternatives considered:** a Code Mode script instead of five tools — rejected: typed,
  individually gated tools are what an MCP client lists and a user approves one by one.
- **Compatibility:** no installed contract changes. Tool names and inputs become a contract for MCP
  clients once shipped (`BACKWARD_COMPATIBILITY.md` applies to renames).

## User Journeys

### Journey J-001 — Create, find and comment from Claude Code

1. A developer creates an API key (Settings → API Keys, or `mcp:ensure-api-key`) for a user whose
   role holds the task-manager features above.
2. Claude Code is configured with
   `{"mcpServers":{"open-mercato":{"type":"http","url":"http://localhost:3001/mcp","headers":{"x-api-key":"omk_…"}}}}`.
3. "File a task: ZDP-5000 holds 5 200 l, not 5 000, dimensions missing." The client calls
   `list_projects` and asks which project if several exist, then
   `create_task { project: 'WEB', title, description }` → `{ reference: 'WEB-13', href }`.
4. "What's open about ZDP-5000?" → `search_tasks { query: 'ZDP-5000' }` → `WEB-13`;
   `get_task { reference: 'WEB-13' }` returns the task and its comments.
5. "Customer confirmed 5 200 l" → `comment_task { task: 'WEB-13', body }`; the comment appears in
   the board drawer under the key user's name.
6. Failures: unknown project → `project_not_found`; invalid `assigneeId` → `staff` 422; a task in
   a project the caller is not a member of → `{ found: false }`, same as a missing one.

## UI and Interaction Contracts

N/A — no new page or widget. `href` in results is the project board
(`/backend/staff/time-tracking/projects/{projectId}/board`) with the `staff` drawer deep link
(Q-001). Tool descriptions are English; errors are machine-readable codes.

## Data Models

N/A — no entity, table, migration or configuration.

## API, Command, and Error Contracts

No new HTTP route or command. Handlers re-parse `unknown` input with the declared Zod schema.

| Tool | Gate | Input | Success result | Errors | REQ |
|---|---|---|---|---|---|
| `task_tools.create_task` (`isMutation`) | `staff.timesheets.tasks.manage` | `{ project: string (id or code), title: 1..255, description?: ≤ 8 000 md, assigneeId?: uuid (staff member) }` | `{ taskId, reference, projectId, statusSlug, assigneeId, href }` | `project_not_found` (also another organisation's code); `staff` 422 on invalid assignee or validation | 001 |
| `task_tools.get_task` | `staff.timesheets.tasks.view` | `{ reference?: string, taskId?: uuid }` (one required) | `{ found: true, task: { id, reference, title, description, statusSlug, projectId, projectCode, assignee, parent?, updatedAt }, comments: [{ id, authorName, body, createdAt }] ≤ 50 }` | not found or not visible → `{ found: false }` | 002 |
| `task_tools.search_tasks` | `staff.timesheets.tasks.view` | `{ query?: string, project?: string, status?: slug, limit?: 1..50 = 20 }` | `{ items: [{ id, reference, title, statusSlug, projectCode }], totalCount }` | none beyond ACL | 002 |
| `task_tools.list_projects` | `staff.timesheets.projects.view` | `{}` | `{ items: [{ id, code, name, isMember }] }` | none | 001, 002 |
| `task_tools.comment_task` (`isMutation`) | `staff.timesheets.tasks.manage` | `{ task: reference or id, body: 1..5000 }` | `{ commentId, taskId, reference }` | not visible → `task_not_found` | 003 |

Installed routes consumed (unchanged): `POST/GET /api/staff/timesheets/tasks` (`q`, `reference`,
`id`, `timeProjectId`, `taskStatusId`, `pageSize` ≤ 100; body `assigneeStaffMemberId`),
`GET/POST /api/staff/timesheets/tasks/{id}/comments`, `GET /api/staff/timesheets/time-projects`.
Project codes are unique per organisation (`staff_time_projects_code_unique_idx`).

MCP calls execute on call (clients usually ask the user first). README section "Connect an MCP
client" documents the key, the role and that repeated `create_task` calls create repeated tasks.

## Events, Jobs, Notifications, and Cross-Module Flows

None of our own; `staff` emits its usual task and comment events for our writes. No jobs.

## Security, Privacy, and Compliance

- **Authorization:** `requiredFeatures` checked by the MCP server in ListTools and CallTool; each
  write also passes the `staff` route's `requireFeatures`. No role-name checks.
- **Tenant isolation:** scope from context only; `requireToolScope` fails closed; `staff` list
  routes narrow to project membership.
- **Sensitive data:** stored only where `staff` stores tasks; API keys never echoed (README uses a
  placeholder).
- **Abuse:** prompt injection — board text returned as data and labelled untrusted; enumeration —
  `found: false` is identical for missing and invisible tasks; project codes resolve inside the
  caller's organisation only.

## Integration Coverage

Tests seed their own tenant, a user with a staff member, and a project `WEB` with a default status.

| Test ID | Level | Setup | Actions | Assertions | REQ |
|---|---|---|---|---|---|
| TEST-001 | integration | user with `tasks.manage` | `create_task` without `assigneeId` | reference `WEB-n`, default status, assignee = caller's staff member, `href` set | REQ-001 |
| TEST-002 | integration | second staff member; one in another organisation | `create_task { assigneeId }` for each | first assigned; second → 422, no row | REQ-001 |
| TEST-003 | security | user without `tasks.manage` | `create_task`, `comment_task` | ACL denial before the handler; no row | REQ-001, REQ-003 |
| TEST-004 | integration | caller not a member of project `OPS` | `search_tasks`, `get_task` on an `OPS` task | `found: false`; absent from results | REQ-002 |
| TEST-005 | security | tenants A and B each with project `WEB` | B: `create_task { project: 'WEB' }`, `search_tasks`; A's project id as `project` | only B's project and tasks; `project_not_found` | REQ-001, REQ-002 |
| TEST-006 | integration | task `WEB-1` | `comment_task` | comment row authored by the caller, body verbatim | REQ-003 |
| TEST-007 | contract | generated registries | `mcp:list-tools` | five `task_tools.` names; `create_task` and `comment_task` are `isMutation` | REQ-004 |
| TEST-008 | integration (MCP) | HTTP MCP server, API key with only the task features | `tools/list`; `tools/call` create → search → get → comment | five tools listed, no `catalog.*` mutation tool; the task and comment exist | REQ-001…004 |
| TEST-009 | manual | Claude Code with a task-manager key | J-001 | task and comment visible on the board | REQ-001…004 |

## Implementation Phases

### Phase 1 — Task tools on the `staff` board

- **Depends on:** `staff`, `planner`, `resources` enabled in `src/modules.ts`; `yarn generate`.
- **Outcome:** an MCP client creates, reads, searches and comments on tasks and lists projects.
- **Deliverables:** `src/modules/task_tools/{index.ts, ai-tools.ts, lib/scope.ts,
  lib/staff-api.ts, __tests__/*}`; `modules.ts` entry; README "Connect an MCP client".
- **Slices:** (a) scaffold + read tools; (b) `create_task`; (c) `comment_task`; (d) README +
  MCP test. ~4 commits.
- **Requirements / tests:** REQ-001…004; TEST-001…009.
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn test src/modules/task_tools`;
  `yarn mercato ai_assistant mcp:list-tools | grep task_tools.`.
- **Exit gate:** J-001 from Claude Code; a key without `staff.timesheets.tasks.manage` does not see
  the write tools.

## Requirement Traceability

| Requirement | Journey | Contracts | Phase | Tests | AC |
|---|---|---|---|---|---|
| REQ-001 | J-001 step 3 | `create_task`, `list_projects`, `POST /api/staff/timesheets/tasks` | 1 | TEST-001, 002, 003, 005, 008, 009 | AC-001 |
| REQ-002 | J-001 step 4 | `get_task`, `search_tasks`, `list_projects` | 1 | TEST-004, 005, 008, 009 | AC-002 |
| REQ-003 | J-001 step 5 | `comment_task`, `POST …/tasks/{id}/comments` | 1 | TEST-003, 006, 008, 009 | AC-003 |
| REQ-004 | J-001 steps 1–2 | MCP ListTools/CallTool, README | 1 | TEST-007, 008 | AC-004 |

Extension surfaces (reference files from `src/modules/example/references/surface-inventory.json`):
module metadata (`src/modules/example/index.ts`) and AI tool pack
(`src/modules/example/ai-tools.ts`), both `emitted-example`, covered by TEST-001…008.

## Rollout, Migration, and Rollback

- **Migration:** none; `yarn db:generate` reports no change.
- **Enable:** add `{ id: 'staff' }`, `{ id: 'planner' }`, `{ id: 'resources' }` and
  `{ id: 'task_tools', from: '@app' }` to `src/modules.ts`; `yarn generate`; restart the MCP process.
- **Rollback:** remove the entry and re-run `yarn generate`; created tasks remain ordinary `staff`
  tasks. Revoke issued API keys.

## Risks and Tradeoffs

| Risk | Impact | Mitigation | Residual |
|---|---|---|---|
| MCP writes run immediately and are not deduplicated | Duplicate tasks | Narrow role; client-side tool approval; README | Accepted |
| Dotted tool names rejected by a client | Client cannot call | Core tools already use dots; verified from Claude Code in Phase 1 | Client-specific |
| Client model invents a project | Wrong task | `project` required; `project_not_found` | Model behaviour |

## Acceptance Criteria

- [ ] **AC-001** — A key with `staff.timesheets.tasks.manage` creates a task with a `staff`
  reference, default status and the chosen or default assignee; the result links it.
- [ ] **AC-002** — `get_task`/`search_tasks` return only tasks the caller can open on the board;
  invisible and missing tasks are indistinguishable.
- [ ] **AC-003** — A comment posted through `comment_task` appears in the drawer under the key
  user's name.
- [ ] **AC-004** — `mcp:list-tools` lists the five tools; a task-only key cannot list any
  `catalog.*` mutation tool.
- [ ] TEST-001…008 pass; J-001 rehearsed by hand (TEST-009); the validation gate passes.

## Final Compliance Report

| Check | Status | Evidence |
|---|---|---|
| `AGENTS.md` and routed guides reviewed | pass | `AGENTS.md`, `.ai/guides/spec-delivery.md`, `.ai/guides/ai-workflows.md`, `src/modules/example/`; 0.8.0 `ai_assistant` and `staff` sources |
| Contracts, tests and ACs consistent | pass | traceability table |
| Platform reuse before custom code | pass | `staff`, `ai_assistant`; no entity, route or widget |
| Phase has dependencies, slices, tests, exit gate | pass | Phase 1 |

Verdict: `Blocked — user approval of the spec`.

## Open Questions

| ID | Question | Owner | Blocking? | Resolution |
|---|---|---|---|---|
| Q-001 | Exact deep-link parameter of the `staff` board drawer for `href` | implementer | no | read from the installed board page in Phase 1 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Initial draft: module `task_tools` with five `defineAiTool` tools over the Open Mercato MCP server for `staff` tasks; ACL reuses `staff` features; project required; optional assignee. |
