# Change Requests

**Date**: 2026-09-20
**Status**: Implemented slice — written after the fact

> Written retroactively for work that shipped in commit `a62e739`, to close the spec gate this
> slice went through without. Sections describe what exists, not what is planned; the two things
> that were deliberately left unbuilt are named in **Non-goals** and **Known limits**.

## TLDR

A delegated board task now produces a **change request**: one proposed change to a repository, with
its own record, its own life cycle, and an approve/reject decision that is stored rather than
inferred. Reuses `staff` tasks, `task_delegation` delegations and the `repositories` registry; adds
one entity (`ChangeRequest`), five commands, four API routes and a `Code` navigation section.
Smallest coherent outcome: a business owner can see every change an agent proposed and say yes or
no to it without opening GitHub.

## Problem Statement

Before this slice, a proposed change existed only as the conjunction of three things owned by other
modules: a `staff` task in the In-review column, a `task_delegation` delegation carrying a `pr` link,
and a pull request on GitHub. Consequences observed in the repo:

- **No record of the decision.** Approving merged the PR and moved the task to Done. Who approved,
  when, and why a change was refused existed nowhere — the task's status was the only trace, and it
  says nothing about the change.
- **No list.** The only way to see proposed changes was to open board cards one at a time. There
  was no answer to "what has the Developer produced this week".
- **Rejecting was not a decision, it was a drag.** The only refusal path was moving the card from
  In review back to Backlog, which `transitionPolicy` interprets as `outcome: 'rejected'`. The pull
  request stayed open on GitHub, and no reason was captured.
- **The vocabulary was the implementation's.** Every surface said "pull request" to an audience
  that does not use git.

## Overview and Success Measures

- **Primary outcome:** every proposed change is visible in one list and carries a stored decision
  (`decided_by`, `decided_at`, `status_reason`).
- **Leading indicators:** change requests reach `open` (the agent produced something reviewable)
  rather than `failed`; decisions recorded per change request.
- **Baseline:** zero — no such record existed; decisions were unrecoverable after the fact.
- **Market / product reference:** GitHub/GitLab merge-request review UIs were studied and
  deliberately *not* copied for the primary surface. They are built for the author of the code; the
  reader here is the person who asked for the change. Adopted: the diff, the checks summary, the
  preview link. Rejected: review threads, line comments, reviewer assignment, approval counts —
  none have a meaning for a single business owner deciding on a single agent's work.

## Goals

- **REQ-001** — A change request exists for every delegated run from the moment the run starts, and
  shows what the run is doing (`generating`) rather than appearing only once a PR exists.
- **REQ-002** — Every change request is listed on one page, filterable by status and searchable by
  title, scoped to the projects the reader may open on the board.
- **REQ-003** — A change request can be approved (merged, task Done) or rejected (closed with a
  required reason, task back to Backlog) from the app, and the decision is stored with its actor.
- **REQ-004** — The same transitions are available as commands, so a later workflow can drive them
  without re-implementing the preconditions.
- **REQ-005** — Registered repositories are visible with the version their base branch is on and
  their last update, next to the change requests targeting them.

## Non-goals

- **Reverting a published change.** Undoing a merge is a new commit on the base branch with its own
  review and its own failure modes. Nothing in this slice pretends to support it, under any name.
- **Autonomous or human-in-the-loop approval workflows.** Explicitly deferred by the requester. See
  **Known limits** for the one structural change that will be needed first.
- **Review conversation.** No threads, line comments, or multi-reviewer approval.
- **A second Kanban board.** The list is a list; the board stays `staff`'s.
- **Replacing the task drawer.** The drawer keeps its approve action and now routes it through the
  same command.

## Proposed Solution

A change request is an app-owned record in `code_changes`, created by the agent run and decided by a
person. It is not a mirror of the pull request: it snapshots the provider coordinates (repo, branch,
number, url, head sha) and adds what the provider cannot hold — the decision and its actor, for an
approver who may never have had a GitHub account.

The life cycle is expressed as commands rather than route bodies, split by who is allowed to move
it:

- **Run commands** (`start`, `record_pull_request`, `mark_failed`) are authorized by
  `requireProcessAuthority` — the workflow process bound to the task, the same authority the task
  writes beside them use. They are idempotent per change request because workflow steps replay.
- **Decision commands** (`approve`, `reject`) are authorized as a person: `code_changes.decide`
  plus the task-assignee check, and they carry the GitHub effect and the board transition.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Own a `ChangeRequest` entity | The decision (who/when/why) has no home in `staff`, `task_delegation`, or GitHub | Derive everything from the delegation's `pr` link at read time | That is what existed; it cannot store a decision, cannot be listed cheaply, and loses the record when the delegation is released |
| Name it "change request" | The reader is the person who asked for the change, not its author | "Pull request" / "merge request" | Provider vocabulary that the audience does not share; the number is still shown as a link for whoever wants it |
| Create it at `prepare_checkout`, not at PR open | A run that dies mid-way is still a change someone asked for and did not get | Create on PR open | A failed run would leave no record at all — the most useful row to see is the one that failed |
| Life cycle as commands | A later workflow drives the same transitions | Route handlers calling libs directly | Would force re-implementing every precondition in the workflow path |
| `employee` gets `code_changes.view` only | Merging into a production repository is not an ordinary board right | Reuse `task_delegation.delegate` for deciding | Conflates "may hand work to an agent" with "may ship it"; they belong to different people |
| Reject requires a reason | A refusal the asker cannot act on wastes the next run too | Optional reason | 422 on empty reason |
| Reject leaves the branch | A rejected change stays inspectable | Delete the branch | Deleting a branch is not something a "no" should silently do |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Change request | One proposed change to one repository, produced by one agent run | `code_changes.ChangeRequest` | — |
| `generating` | The run started; there is nothing to look at yet | `status` | — |
| `open` | A pull request exists and a decision is awaited | `status` | — |
| `approved` | Merged, task closed Done | `status` + `decided_by`/`decided_at` | Merge refused by GitHub → 409, status unchanged |
| `rejected` | PR closed unmerged with a reason, task returned to Backlog | `status` + `status_reason` | Already merged → 409 `pr_merged` |
| `failed` | The run ended without a reviewable change | `status` + `status_reason` | — |
| Decision authority | Only the task's accountable assignee may approve or reject | `staff` assignee ↔ caller | 403 `assignee_required` |
| Decidability | Only a change request in `open` may be decided | `status` | 409 `change_request_not_open` |
| Replay safety | A replayed run step never starts a second change request and never rewrites a decision | command guards | returns the existing record unchanged |
| Provider fields | `repo_full_name`, `base_branch`, `branch`, `number`, `url`, `head_sha` are a snapshot at proposal time | `ChangeRequest` | never resolved through a relation |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Business owner / assignee | View, approve, reject | Projects they may open on the board, and only tasks they are assignee of, for decisions | `code_changes.view`, `code_changes.decide` |
| Employee | View | Projects they may open | `code_changes.view` |
| Admin / superadmin | View, decide | Organization | `code_changes.*` |
| Agent run principal | Open/fill/fail its own change request | The process bound to its task | `task_delegation.process` (via `requireProcessAuthority`) |

`tenantId` and `organizationId` come from `requireTaskScope` / `withTaskRoute`, never from a payload.
Project access is `staff`'s own `timeTrackingAccessResolver`, so the list cannot show a change to a
project the reader cannot open. A change request outside the caller's access answers **404, not
403**, so the endpoint never confirms one exists.

No system-scope operation. Nothing here writes with `organizationId: null`.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Tasks, board, drawer, statuses | reuse | core `staff` | task IDs + `staff.timesheets.tasks.status_change` | Source of truth for work |
| Delegation, run state, PR links | reuse | `task_delegation` | delegation ID + its commands | Owns who the agent is and what the run did |
| Repository + short-lived token | reuse (optional) | `repositories` | guarded `hasRegistration('repositoryAccess')` DI, falls back to env | Works without the registry |
| Process narrative, task writes | reuse | `task_delegation.runsQuery` | read-only lib call | The run story belongs to the module that owns the run |
| The proposed change and its decision | **app-own** | `code_changes` | new entity + commands | Nothing installed holds a decision |

## Architecture and Data Flow

```text
workflow  -> code_changes.prepare_checkout   -> change_request.start          (generating)
          -> INVOKE_AGENT <coding agent>
          -> code_changes.open_pull_request  -> change_request.record_pull_request (open)
          (any failure)                      -> change_request.mark_failed    (failed)

person    -> /backend/code/changes[/:id]     -> change_request.approve|reject
                                             -> GitHub merge|close + staff status change
                                             -> code_changes.change_request.{approved,rejected,changed}
```

- **Module boundaries:** `code_changes` owns the proposal and its decision; `task_delegation` owns
  the run; `website_publishing` owns asking for a change; `repositories` owns the credential.
- **Extension points:** the `Code` nav group via page metadata; the task-drawer injection widget;
  `code_changes.change_request.*` events for later subscribers.
- **Alternatives considered:** keeping everything on the delegation (see Design Decisions).
- **Compatibility:** `POST /api/code_changes/tasks/:id/approve` keeps working and now routes
  through the change-request command when the task has one, falling back to the direct merge for
  tasks that predate the entity.

## User Journeys

### Journey J-001 — Deciding a proposed change

1. Owner opens **Code → Code changes**.
2. Sees every change request, newest first, with its status chip.
3. Opens one: summary, preview link, checks, changed files, and how the agent got there.
4. **Approve and publish** → PR squash-merged at the head that was checked, task Done, status
   `approved` with actor and timestamp. Or **Reject** → reason required, PR closed unmerged, task
   back to Backlog, status `rejected` with the reason.
5. Failure: not the assignee → 403; not in review or already decided → 409; GitHub refuses the
   merge (red checks, head moved) → 409 `merge_blocked` and nothing changes.

### Journey J-002 — Knowing what the repositories are on

1. Owner opens **Code → Code repositories**.
2. One card per registered repository: base branch, current version (head commit), last update
   (subject, when, author), linked projects.
3. A repository whose GitHub read fails still renders, with the reason.
4. **Repository settings** links to the existing `/backend/repositories` screen.

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/code/changes` | List; filter by status; search by title; open one | `GET /api/code_changes/change-requests` | `repositories/components/RepositoriesTable.tsx` | `Page`, `PageBody`, `DataTable`, `RowActions`, `StatusBadge`, `ListEmptyState` | loading, empty, error, permission denied | REQ-002 |
| `/backend/code/changes/[id]` | Read one; approve; reject with reason | `GET .../:id`, `POST .../:id/approve`, `POST .../:id/reject` | `code_changes` task-approve widget | `Page`, `PageHeader`, `PageBody`, `Card`, `SectionHeader`, `Dialog`, `Textarea`, `Alert`, `StatusBadge` | loading, not found, error, conflict, success, permission denied | REQ-003 |
| `/backend/code/repositories` | Repository cards; link to settings | `GET /api/repositories/overview` | `repositories/components/RepositoriesTable.tsx` | `Page`, `PageHeader`, `Card`, `StatusBadge`, `ListEmptyState` | loading, empty, error, degraded (per-card `headError`) | REQ-005 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Business owner | Code → Code changes; Code → Code repositories | Task-drawer approve panel on the staff board | Code → Code changes → open row → Approve (3 clicks) |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Change requests list | "A change request appears here once a board task is handed to the Software Engineer." | `DataTable` responsive behavior | Table/row-action defaults |
| Repository cards | "Connect a repository in settings before handing a code change to an agent." | 1 / 2 / 3 column grid | Link and button defaults |
| Reject dialog | — | `sm:max-w-md` | Cmd/Ctrl+Enter submits, Escape cancels, submit disabled while the reason is empty |

Localization: `code_changes.changeRequests.*` and `code_changes.runs.*` (timeline vocabulary),
`repositories.overview.*`, nav group `backend.nav.code`. en + pl at parity.

## Data Models

### `ChangeRequest` — `code_changes_change_requests`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID, required | primary key | no | immutable |
| `tenant_id` / `organization_id` | UUID, required | `..._scope_idx` | no | trusted context only |
| `task_id` | UUID, required | `..._task_idx` (org, task) | no | scalar FK by value |
| `delegation_id` | UUID, nullable | partial unique (org, delegation) where not null and not deleted | no | one change request per run |
| `project_id` | UUID, required | — | no | the access scope |
| `repository_id` | UUID, nullable | — | no | null when the env answered instead of the registry |
| `title` | text, required | — | no | task title snapshotted at proposal time |
| `summary` | text, nullable | — | no | the agent's own words; untrusted display data |
| `provider` | varchar(20), default `github` | — | no | — |
| `repo_full_name` / `base_branch` / `branch` | varchar, required/required/nullable | — | no | snapshot, never a relation |
| `number` / `url` / `head_sha` / `merge_commit_sha` | int / text / varchar(64) ×2, all nullable | — | no | filled when the PR opens and when it merges |
| `status` | varchar(20), default `generating` | — | no | `generating\|open\|approved\|rejected\|failed` |
| `status_reason` | text, nullable | — | no | the sentence a person reads; ≤8000 chars |
| `opened_by` / `decided_by` | UUID required / nullable | — | no | actors |
| `decided_at` | timestamp, nullable | — | no | set with the decision |
| `created_at` / `updated_at` / `deleted_at` | timestamps | — | no | soft delete supported, never used yet |

No cross-module ORM relations; every foreign reference is a scalar id plus a display snapshot.
Migration `Migration20260920033819_code_changes` creates the table and its three indexes only.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/code_changes/change-requests` | auth + `code_changes.view` | `changeRequestListSchema` | `{ items, total, page, pageSize, totalPages }` | 400/401/403 | REQ-002 |
| `GET` | `/api/code_changes/change-requests/:id` | auth + `code_changes.view` | — | `{ changeRequest, run }` | 403/404 | REQ-002 |
| `POST` | `/api/code_changes/change-requests/:id/approve` | auth + `code_changes.decide` + assignee | — | `{ id, status }` + `…approved`, `…changed` | 403/404/409 | REQ-003 |
| `POST` | `/api/code_changes/change-requests/:id/reject` | auth + `code_changes.decide` + assignee | `changeRequestRejectSchema` | `{ id, status }` + `…rejected`, `…changed` | 403/404/409/422 | REQ-003 |
| `POST` | `/api/code_changes/tasks/:taskId/approve` | auth + `task_delegation.delegate` + `code_changes.decide` | — | `{ taskId, changeRequestId, merged }` | as above | REQ-003 |
| `GET` | `/api/code_changes/tasks/:taskId/review` | auth + `task_delegation.view` + `code_changes.view` | — | `{ review }` | 403/404 | REQ-003 |
| `GET` | `/api/repositories/overview` | auth + `repositories.view` | — | `{ items }` | 403 | REQ-005 |
| command | `code_changes.change_request.start` | process authority | run identity + repo snapshot | `{ id, status }` + `…opened` | idempotent per delegation | REQ-001 |
| command | `code_changes.change_request.record_pull_request` | process authority | PR coordinates | `{ id, status }` + `…ready` | never reopens a decided record | REQ-001 |
| command | `code_changes.change_request.mark_failed` | process authority | reason | `{ id, status }` + `…failed` | never overwrites a decision | REQ-001 |
| command | `code_changes.change_request.approve` | `code_changes.decide` + assignee | `{ id }` | `{ id, status }` + `…approved` | 409 on not-open / merge refused | REQ-003, REQ-004 |
| command | `code_changes.change_request.reject` | `code_changes.decide` + assignee | `{ id, reason }` | `{ id, status }` + `…rejected` | 409 on not-open / already merged | REQ-003, REQ-004 |

All routes are custom guarded command routes with per-method `metadata` and `openApi`; none uses
`makeCrudRoute`. Mutations pass through `runRouteMutationGuards`. The merge is pinned to the head
sha the precondition check saw, so a commit pushed after the review is never merged unseen.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `code_changes.change_request.opened` | run | — (available) | — | persistent; emitted after commit |
| `code_changes.change_request.ready` | run | — (available) | — | only on the `generating → open` edge |
| `code_changes.change_request.approved` / `.rejected` / `.failed` | decision / run | — (available) | — | persistent; never decides the outcome |
| `code_changes.change_request.changed` | all of the above | open surfaces (`clientBroadcast`) | refresh | emitted alongside every specific event |

Emission is deliberately after the write commits and never rolls it back: a listener that is down
must not turn an approved change back into an open one. Every command carries `buildLog` metadata,
so decisions land in the audit log independently of events.

## Security, Privacy, and Compliance

- **Authorization:** feature gates (`code_changes.view` / `.decide`) plus a record-level assignee
  check for decisions and `staff` project access for reads. No role-name checks.
- **Tenant isolation:** every query filters on `tenantId` + `organizationId` derived from the
  request scope; `scopeFilter` strips the actor out of scope objects so a `TaskScope` can never leak
  a `userId` into a `FilterQuery`.
- **Sensitive data:** none encrypted — the entity holds no secrets. The GitHub token is never
  persisted and never reaches the agent. `summary` / `title` are agent-authored and treated as
  untrusted display data (also flagged in the AI tool descriptions).
- **Abuse and failure modes:** enumeration answered with 404 rather than 403; replayed workflow
  steps idempotent; double-approve lands on GitHub's already-merged branch; merge pinned to a
  reviewed head sha; reject refuses an already-merged PR rather than pretending to undo it.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit | mocked GitHub + delegation service | approve at head | merges at the checked head, closes the task Done, returns the merge commit | REQ-003 |
| TEST-002 | unit | as above, non-assignee / not-in-review / released delegation | approve | 403 `assignee_required`, 409 `not_in_review`, 409 `not_delegated` | REQ-003 |
| TEST-003 | unit | mocked workflow context | prepare + open PR | the run opens, fills and fails its change request with the right identity and step ids | REQ-001 |
| TEST-004 | unit | — | `changeRequestChip`, `pullRequestLink` | one phrase per status; PR number read off the URL, ref as fallback | REQ-002 |
| TEST-005 | unit | — | `acl` + `setup` + `workflows` | every feature granted to a role; decide depends on view; approve/reject not offered as workflow steps | REQ-004 |
| **Gap** | integration | — | list/approve/reject over real API fixtures; UI states | **not written** — see Known limits | REQ-002, REQ-003 |

## Implementation Phases

Shipped as one slice in `a62e739`, with a follow-up commit adding the module conventions
(`acl.ts`, `setup.ts`, `events.ts`, `workflows.ts`, `ai-tools.ts`, shared `api/openapi.ts`).

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | run | `ChangeRequest`, three run commands, `…opened/ready/failed` | shipped | TEST-003 | AC-001 |
| REQ-002 | J-001, `/backend/code/changes` | `GET /api/code_changes/change-requests` | shipped | TEST-004 | AC-002 |
| REQ-003 | J-001, `/backend/code/changes/[id]` | approve/reject routes + commands | shipped | TEST-001, TEST-002 | AC-003 |
| REQ-004 | commands | five registered commands, three workflow-safe | shipped | TEST-005 | AC-004 |
| REQ-005 | J-002, `/backend/code/repositories` | `GET /api/repositories/overview` | shipped | — (gap) | AC-005 |

## Rollout, Migration, and Rollback

- Migration `Migration20260920033819_code_changes` is additive (one new table). Applied locally;
  each environment applies it through the usual `yarn db:migrate`.
- **Operator step, required:** this slice introduces `code_changes.view` / `code_changes.decide`.
  Existing tenants have no grant for them, so `yarn mercato auth sync-role-acls` must run before
  anyone can open the Code section or approve. Without it, existing users get 403 on surfaces they
  could use before — the one genuinely breaking edge of this change.
- Rollback: the surfaces can be removed without touching data; the table is additive and orphaned
  rather than destructive if the module is disabled.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| New features not granted on an existing tenant | Everyone 403s on the Code section | `setup.ts` grants + documented `sync-role-acls` step | Operator must run it; nothing detects it automatically |
| Decision recorded after the GitHub effect | Merge succeeds, record write fails → change request stuck `open` while the PR is merged | Re-approving is safe (already-merged path), status corrects itself | A stuck `open` row until someone retries |
| Two approvers race | Second merge attempt hits an already-merged PR | GitHub is the serialization point; `alreadyMerged` handled | Two audit entries for one merge |
| Agent-authored `summary`/`title` rendered to a person | Misleading text | Treated as untrusted; flagged in AI tool descriptions; no HTML rendering | Social-engineering text in a summary |
| Integration coverage missing | Regressions in the list/decision paths ship unnoticed | Unit coverage on the decision preconditions | Real gap — see below |

## Known limits

1. **A workflow cannot approve.** `resolveDecision` requires the caller to be the task's accountable
   assignee, and a workflow principal never is. `approve` / `reject` are therefore deliberately
   **not** registered as workflow-safe commands — offering them would advertise a step that always
   fails. Autonomous or human-in-the-loop approval needs the assignee rule to become a *policy*
   (e.g. "assignee, or a principal holding an explicit auto-approve grant, under stated conditions")
   before it can be built. That is the first thing to design when workflows come back on the table.
2. **No integration tests.** The decision preconditions are unit-covered; the API and UI paths are
   not. `docs/development/task-delegation-verification.md` has no procedure for change requests.
3. **Revert does not exist** (Non-goals).
4. **Timeline vocabulary is partial.** Only the `pr_open` milestone and the task-status writes have
   translations; any other milestone or command renders its raw key.

## Acceptance Criteria

- [x] **AC-001** — A delegated run creates exactly one change request and moves it through
      `generating → open`, or to `failed` with a reason, with replayed steps changing nothing.
- [x] **AC-002** — Every change request the caller may see is listed newest-first, filterable by
      status and searchable by title, scoped by project access.
- [x] **AC-003** — The task assignee can approve (merge + Done) or reject (close + reason +
      Backlog), and the decision is stored with actor and timestamp.
- [x] **AC-004** — All five transitions exist as commands with their preconditions inside them.
- [x] **AC-005** — Registered repositories show their current version and last update, degrading to
      a stated reason when GitHub cannot be read.
- [ ] **AC-006** — Self-contained integration coverage for the list, approve and reject paths.
      **Open** — see Known limits 2.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Validation gate | pass | `yarn generate && typecheck && lint && ds:check && test && build` |
| Module conventions | pass | `acl.ts`, `setup.ts`, `events.ts`, `workflows.ts`, `ai-tools.ts`, `api/openapi.ts` present and generator-registered |
| Tenant isolation | pass | scope-derived filters; 404 for out-of-scope records |
| Backward compatibility | conditional | additive except the new feature gates; `sync-role-acls` required (Rollout) |
| Integration coverage | **fail** | AC-006 open |
