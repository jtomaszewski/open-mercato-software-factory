# Developer task intake

**Date**: 2026-09-19
**Status**: Implemented

**Renamed since (2026-09-19):** the `factory` module became `code_changes` + `website_publishing`,
so the names below now read: `factory.request_change` → `website_publishing.request_change`,
`factory.deliver` → the `website_publishing.website_change` process, `factory.developer` →
`website_publishing.developer`, the `start-factory` subscriber → `start-delegated-run`, and the
agent principal id `factory` → `developer` (the old id is still accepted). The design is unchanged.

## TLDR

Add one approval-aware `factory.request_change` AI/MCP tool. It creates a scoped staff task in a
the `DEMO` project and delegates that task to the existing Developer principal; the existing
`task_delegation.task.delegated` event and Agent Orchestrator pipeline remain the only execution
path. The first slice targets the demo's configured website repository and keeps repository
selection server-side.

## Problem Statement

The business chat can edit catalog records, but it cannot hand a corresponding website change to
Developer. Users therefore receive misleading explanations about an external website instead of a
trackable coding run and pull request.

## Proposed Solution

Expose a composite domain tool that reuses staff task creation, task delegation, and the existing
`factory.deliver` process. The tool accepts title, instructions and an optional catalog product reference; it never accepts
a project, repository URLs, work directories,
commands, agent IDs, providers, or models.

## Overview and Success Measures

- **Primary outcome:** after one confirmed chat request, a task appears on the `DEMO` board with
  an active Developer delegation and one orchestrator execution.
- **Leading indicators:** the MCP registry exposes the tool; the chat reports the task reference and
  board link instead of claiming the website changed synchronously.
- **Baseline:** the demo chat can mutate catalog records but cannot initiate website work.
- **Market / product reference:** GitHub's coding-agent flow accepts a prompt or issue and produces a
  pull request; its quickstart recommends assigning an issue as the easiest durable start. We adopt
  the durable work-item and reviewable-PR shape, while keeping Open Mercato Tasks authoritative:
  https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task

## Goals

- **REQ-001** — An authorized chat user can request a Developer change for the seeded `DEMO` project
  without supplying an agent, repository, runtime, or shell command.
- **REQ-002** — The request creates one staff task and delegates it through the existing command,
  event, process, and Agent Orchestrator path.
- **REQ-003** — Catalog-backed requests may attach a validated product ID so Developer receives the
  current catalog record as source-of-truth context.

## Non-goals

- Implementing the `repositories` registry or allowing a caller to select an arbitrary repository.
- Starting `factory.developer` directly, bypassing Tasks, or changing the delivery workflow.
- Publishing or merging the resulting pull request automatically.
- Adding a new page, database entity, API route, or migration.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| `factory.request_change` creates and delegates a Task | Reuses audit, ownership, retries, status, links and current process start | Direct `developer.invoke` | Bypasses the durable business lifecycle |
| Server always files on `DEMO`; no project input | The current checkout has one global site repository. A live run showed the model inventing `project: "website"`, so the selector was removed rather than validated | Caller-supplied `repoUrl` or project | Unsafe, error-prone for the model, and incompatible with the repository spec |
| Optional `productId` adds a canonical product link | Existing delivery already turns that link into a scoped catalog snapshot | Arbitrary record payload | Lets the model forge source-of-truth data |
| Typed AI tool, no new HTTP route | Auto-discovery exposes it through MCP and preserves mutation metadata | New custom endpoint | Duplicates the installed AI-tool surface |
| Additive catalog-agent extension | The existing merchandising chat already owns the product lookup/edit journey | A second app-owned chat agent | Would split one user request across two assistants |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Change request | One newly created staff task plus its active Developer delegation | `staff` + `task_delegation` | Return a typed error; never claim execution started |
| Developer | Enabled principal whose frozen definition ID is `factory` | Agent Orchestrator principal registry | Refuse before task creation when unavailable |
| Execution | Existing `factory.deliver` process started by the persistent delegation event | Agent Orchestrator | Existing retry/stalled-run behavior applies |
| Product context | Optional syntactically valid UUID encoded as the canonical backend product link in task instructions | Catalog read during workflow preparation | Missing/invisible record yields `record: null`; instructions remain authoritative |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Staff chat user | Create and delegate a change request | Authenticated tenant + selected organization; accessible project only | `staff.timesheets.tasks.manage`, `staff.timesheets.tasks.view`, `staff.timesheets.projects.view`, `task_delegation.delegate` |

Tenant, organization, and user are read only from `McpToolContext`. Project reads and task creation
use the installed staff API runner, retaining route ACL and project-access checks. Delegation uses
the existing command, which re-checks scope, project access, Developer availability, backlog state,
and human assignment.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Project resolution + task create | reuse | `staff` via `task_tools` client | installed HTTP routes | Retains installed ACL/guards |
| Org-pinned route calls | app-own | `task_tools/lib/scoped-runner.ts` | wraps `createAiApiOperationRunner` routes | The installed runner sends no selected-org cookie, so super-admin calls widen to all orgs and staff routes return nothing |
| Delegation | reuse | `task_delegation` | `task_delegation.task.delegate` | Single authority for delegated tasks |
| Chat/MCP action | app-own | `factory` | `ai-tools.ts` | Factory owns Developer intake semantics |
| Catalog chat access | extend | `catalog` | `aiAgentExtensions` | Lends one tool without replacing the installed assistant |
| Coding run + PR | reuse | `factory` + Agent Orchestrator | persistent delegation event | No parallel runtime |

## Architecture and Data Flow

```text
chat/MCP -> factory.request_change -> staff task API -> task_delegation.task.delegate
                                                        |
                                                        v
                              task_delegation.task.delegated (persistent)
                                                        |
                                                        v
                         Agent Orchestrator factory.deliver -> factory.developer -> PR
```

- **Module boundaries:** `factory` composes public staff/task-delegation surfaces and owns no new
  record. Tasks remain authoritative for intake and tracking.
- **Extension points:** module-root `ai-tools.ts` adds the tool and `ai-agents.ts` additively lends it
  to `catalog.merchandising_assistant`.
- **Alternatives considered:** a raw orchestrator start is smaller in calls but loses task linkage,
  authorization and user-visible status.
- **Compatibility:** the new stable tool ID is additive; existing task, delegation, event and process
  contracts are unchanged.

## User Journeys

### Journey J-001 — Request a website change from chat

1. A staff user asks the Catalog Merchandising Assistant to change catalog data and/or the website,
   then confirms each proposed mutation in the existing approval UI.
2. Chat calls `factory.request_change` with title, instructions and optional product ID.
3. The tool returns a Task reference/link and `queued`; the delegation event starts the existing
   process asynchronously.
4. Invalid scope, project access, missing Developer or unavailable orchestrator returns a truthful
   error. A task created immediately before a delegation failure stays visible for manual recovery.

## UI and Interaction Contracts

No page or component changes. The existing chat mutation confirmation and staff board are reused.
An additive agent extension gives `catalog.merchandising_assistant` the tool and instructs it to
report queued work without describing the website as already published.

### UI architecture

N/A — no navigation, widgets, or new interactive surface.

## Data Models

N/A — no schema or persisted app-owned entity is added.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| AI/MCP tool | `factory.request_change` | four features listed above | `{ title, instructions, productId? }` | `{ taskId, reference, projectId, projectCode, delegationId, state: "queued", href }` then existing delegated event | schema errors; scoped project not found/forbidden; Developer/orchestrator unavailable; partial create is left visible | REQ-001..003 |
| command (reused) | `task_delegation.task.delegate` | command re-checks `task_delegation.delegate` and project access | `{ taskId, agentUserId }` | `{ taskId, delegationId }` + persistent event | 403, 409, 422, 503 per existing contract | REQ-002 |

The tool is `isMutation: true`, `isDestructive: false`, has `loadBeforeRecord`, and carries no scope,
agent, repository, work-directory, provider, model, or command field. Direct MCP clients retain
their own approval UI; in-product agent execution uses the installed pending-action flow.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `task_delegation.task.delegated` | existing delegate command | existing start-factory subscriber | starts `factory.deliver` | persistent delivery; process start key `task:{taskId}:{delegationId}` |

## Security, Privacy, and Compliance

- **Authorization:** tool registry and both underlying write surfaces enforce features; project
  access is evaluated for the authenticated user, and the server always targets the `DEMO` project
  until project-to-repository resolution exists.
- **Tenant isolation:** no scope appears in input; all reads/writes derive tenant/org/user from the
  runtime context and fail closed when any is missing.
- **Sensitive data:** free-text instructions remain task data and are treated as untrusted by the
  Developer; no transcripts, credentials, or repository secrets are returned.
- **Abuse and failure modes:** input lengths are bounded; repository/runtime selectors are absent;
  a delegation failure after task creation is surfaced and leaves a recoverable board record.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit/contract | fake scoped staff API + Developer principal + command bus | call tool with generic instructions | one scoped task create, one delegate command, queued response | REQ-001, REQ-002 |
| TEST-002 | unit/security | missing scope, missing principal, invalid product ID | call tool | refuse before unsafe write; schema bounds hold | REQ-001, REQ-003 |
| TEST-003 | integration/browser | reseeded demo and authenticated chat | request the first demo website change and confirm | task visible, delegation/run starts, chat reports queue truthfully; capture screenshots | REQ-001..003 |

## Implementation Phases

### Phase 1 — Demo intake vertical slice

- **Depends on:** existing task tools, delegation, factory process and Developer agent.
- **Outcome:** business chat can create one trackable Developer run for the demo website.
- **Why this order / value delivered:** closes the broken demo intake without pre-implementing the
  repository registry.
- **Deliverables:** `factory/ai-tools.ts`, focused tests, OpenCode prompt recipe, generated registry,
  documentation.
- **Independent slices / estimated commits:** one implementation commit.
- **Requirements closed:** REQ-001..003.
- **Tests:** TEST-001..003.
- **Validation:** `yarn generate`, focused Jest, typecheck, lint, build, and live browser scenario.
- **Exit gate:** the tool is registered and a confirmed demo chat creates/delegates a task that
  starts the existing orchestrator process.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Reference capability | Mechanism | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|---|---|
| REQ-001 | J-001, chat/MCP | `factory.request_change` + catalog-agent extension | `src/modules/example/ai-tools.ts`, `src/modules/example/ai-agents.ts` | emitted-example + additive extension | Phase 1 | TEST-001..003 | AC-001 |
| REQ-002 | J-001, staff board | delegate command + delegated event | `src/modules/example/ai-tools.ts` | emitted-example | Phase 1 | TEST-001, TEST-003 | AC-001 |
| REQ-003 | J-001, task instructions | optional product link | `src/modules/example/ai-tools.ts` | emitted-example | Phase 1 | TEST-001..003 | AC-002 |

## Rollout, Migration, and Rollback

No migration. Generate the AI-tool registry, restart the MCP/OpenCode services, and use the tool
only where `factory` is enabled. Rollback removes the additive tool and prompt recipe; existing
tasks, delegations, runs and PRs remain valid. The future `repositories` module replaces only the
server-side target resolver, not this tool's contract.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Task creation commits before delegation | Failed delegation can leave an undelegated task | Preflight Developer; return error; task remains visible/recoverable | Manual cleanup may be needed |
| Assistant ignores the specialized tool | Demo repeats the current misleading response | Explicit prompt recipe plus live browser proof | Model behavior is probabilistic |
| Current repository is environment-configured | Tool is not multi-repository yet | Never expose repo input; later resolver is internal | Demo remains single-target |

## Acceptance Criteria

- [ ] **AC-001** — An authorized user confirms one chat request and receives a Task reference whose
  active delegation starts exactly one `factory.deliver` execution.
- [ ] **AC-002** — Tool input cannot select tenant, organization, agent, repository, work directory,
  model, provider, or command; a supplied product ID becomes only a canonical catalog link.
- [ ] **AC-003** — Missing scope, inaccessible project, missing Developer, or unavailable
  orchestrator fails truthfully without claiming a website or PR change.
- [ ] Generated discovery, focused tests, typecheck, lint, build, and the browser scenario pass.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root rules; AI workflow, framework contract, testing and spec guides |
| Data models, APIs, events, UI, and tests are internally consistent | pass | no schema/UI; REQ-001..003 trace to the tool, command/event and TEST-001..003 |
| Every workflow completes end to end without a catch-all integration phase | pass | one Phase 1 vertical slice reuses the running pipeline |
| Platform-native reuse and extension points were chosen before custom code | pass | `defineAiTool`, staff routes, command bus, persistent event, Agent Orchestrator |
| UI contracts identify references, canonical components, and theme/state coverage | pass | N/A — no UI authored; existing chat and board reused |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phase 1 contract above |

**Verdict: Ready for implementation**

## Open Questions

N/A — the user selected task-backed invocation; repository selection remains server-side and the
scope is limited to the demo intake bridge.

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Initial ready specification after choosing task-backed Developer invocation. |
| 2026-09-19 | Route calls go through the org-pinned runner after the live chat got `project_not_found` for `DEMO` as super admin. |
| 2026-09-19 | Dropped the `project` input after the live chat passed a non-existent `website` project. |
