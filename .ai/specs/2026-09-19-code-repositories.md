# Code repositories and the Developer agent

**Date**: 2026-09-19
**Status**: Draft (registry slice implemented, see below)
**Scope**: Specification only. Registry, project links and repository-bound delegation; execution and delivery remain in their companions.
**Companions**: [Agent execution and verified previews](2026-09-19-agent-execution-and-preview.md), [Candidate approval and delivery](2026-09-19-instance-delivery-and-recovery.md)
**Decisions**: D-043..D-047 in [accepted decisions](2026-09-19-instance-development-decisions.md)

## Implemented slice (2026-09-19)

Only the registry ships for now; the Developer agent's run is unchanged (OpenCode sidecar, host checkout, host-opened PR, in-app approve).

- **Built:** GitHub App connect with OAuth consent (only repositories the user can push to), register / change base branch / disable / enable / remove, project links with one default (injected project tab).
- **Task runs:** the repo and GitHub token for a task come from its project's default (or only) linked repository as a short-lived installation token scoped to that repository; without a link, `CODE_CHANGES_REPO` + `CODE_CHANGES_GITHUB_TOKEN` (the pre-rename `FACTORY_*` names still read) as before. A link that cannot be used fails the run rather than falling back.
- **Deviation:** the GitHub App key lives in the app environment (`REPOSITORIES_GITHUB_APP_*`), not a broker. Accepted because the long-lived fallback token already lived there and the agent still runs beside the app; revisit with the isolated execution runtime.
- **Agent id (REQ-006, partial):** `FACTORY_AGENT_ID` → `DEVELOPER_AGENT_ID = 'developer'`; the roster, the delegate command and the start subscriber (renamed `start-delegated-run`) accept `factory` as a legacy id, and `seed-demo` reuses an existing legacy principal instead of provisioning a second one. Still open: the user-visible display name (today "Software Engineer", D-047 asks for "Developer") and disabling an idle legacy principal.
- **Module split (2026-09-19):** the `factory` module became `code_changes` (delegated task → checkout → PR → review/approve) and `website_publishing` (the catalog/sales/chat intakes, the Developer and Researcher agents, and the `website_publishing.website_change` process).
- **Superseded by change requests (2026-09-20):** `code_changes` now owns a persisted `ChangeRequest` and the decision on it, and the registry gained a second, read-only surface — `/backend/code/repositories`, in a new `Code` nav group alongside `/backend/code/changes`, showing each repository's current version and last update. `/backend/repositories` remains the settings screen this spec describes, and the "in-app approve" above is now one of two approval paths (the other is the change-request detail page). See [`2026-09-20-change-requests.md`](./2026-09-20-change-requests.md); the UI contracts and navigation tables below predate it.
- **Deferred:** profile kinds and qualification (REQ-002), repository choice frozen on the delegation (REQ-004), revocation of in-flight work (REQ-005), the rest of REQ-006, the broker.

## TLDR

Administrators connect GitHub repositories to Open Mercato from a **Code repositories** settings page, and project managers link them to staff projects. A task on a project is delegated to the **Developer** agent, which works on one of that project's repositories; the server resolves the repository from the project, never from the caller. Open Mercato is the authority for which repositories exist, which projects use them and who may delegate. GitHub's App installation screen is the per-repository consent, and the credential broker keeps the GitHub App key. The agent never edits the hosting Open Mercato instance (D-043), which is what makes an in-app authority safe.

## Problem Statement

The execution spec registers targets only in external installation policy: config files and CLI, with no in-app view of which repositories exist, whether they are qualified, or who may use them. Adding a repository means an operator editing supervisor config. Targets are not tied to projects, so every delegation needs a target choice even though a project's work lives in a small, known set of codebases. The seeded agent is called `factory` and the specs call it "Open Mercato Developer", although it will never edit Open Mercato itself.

## Overview and Success Measures

- **Primary outcome:** an administrator connects a new repository and a project manager delegates the first task against it without touching supervisor config, in under 10 minutes.
- **Leading indicators:** repositories registered; qualification pass rate; delegations whose repository was auto-resolved (single or default link).
- **Baseline:** zero; one hard-coded website target (D-038) configured outside the app.
- **Market / product reference:** Vercel, Netlify, Linear and Sentry connect repositories through a GitHub App install flow and then pick repositories from what the installation grants; adopted. Linear/Jira link repositories to teams/projects; adopted as project links. Rejected: personal-access-token or deploy-key entry forms (long-lived secrets in the app, no per-repository consent screen).

## Goals

- **REQ-001** — An administrator connects a GitHub App installation and registers repositories it grants, with no secret entered or stored in Open Mercato.
- **REQ-002** — Each repository has a profile kind (`pr_only` or `static_site`), editable commands/settings and a visible qualification result; only qualified, active repositories can receive work.
- **REQ-003** — A project manager links one or more registered repositories to a project and marks at most one as default.
- **REQ-004** — Delegating a task to Developer resolves the repository from the task's project: automatic for one link or a default, a required choice otherwise; the choice is frozen on the delegation.
- **REQ-005** — Disabling a repository, losing GitHub access or unlinking it stops new work immediately and stops in-flight publication at the next broker operation.
- **REQ-006** — The seeded agent is named Developer (`developer`); existing `factory` principals keep working until migrated.

## Non-goals

- Editing the hosting Open Mercato instance (`self_instance` target) — dropped by D-043.
- GitLab, Bitbucket or self-hosted Git; personal access tokens or deploy keys.
- One GitHub account serving several OM organizations. GitHub allows one installation per account per App, and an installation binds to one organization.
- Profile kinds beyond `pr_only` and `static_site` (e.g. dynamic servers, WordPress); each needs its own qualified profile spec.
- Merging or deploying `pr_only` repositories from Open Mercato; humans merge in GitHub.
- One task spanning several repositories; a task needing two repositories is split into subtasks.
- Renaming the `factory.deliver` process definition or other internal identifiers.

## Proposed Solution

A new app module `repositories` owns the registry: GitHub App connections, repositories with their frozen profile and qualification, and project links. It talks to the credential broker (execution spec) over an authenticated server-to-server contract for everything that needs the GitHub App key: verifying an installation, listing granted repositories and branches, and running qualification. `tasks` consumes the registry through an optional DI resolver when delegating. Settings UI uses `DataTable`/`CrudForm`; the project link is an injected tab on the staff project detail page; the task delegate sidebar gains a repository select.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Open Mercato is the registry authority (D-044) | Agent never edits OM (D-043), so app-stored authority cannot be widened by agent code; normal OM features/roles and audit apply | External supervisor policy with OM as a request surface | Needed only while the agent could deploy OM code; adds a second admin UI for no remaining threat |
| GitHub App install as consent | GitHub's own screen selects repositories; installation tokens are short-lived and limited to granted repositories | PAT/deploy-key form | Long-lived secrets in OM, no consent screen, no revocation signal |
| Broker keeps App key; OM stores only installation and repository IDs | OM and the sandbox never hold a credential that can push, merge or read unregistered repositories | `integrations` credential store in OM | Would place the App private key inside the app the agent's candidates run beside |
| New module `repositories`, consumed by `tasks` via optional DI | Registry is meaningful without delegation (and vice versa); keeps `tasks` focused on delegation | Extend `tasks` | Mixes provider connection lifecycle into delegation state |
| Many repositories per project, optional default (D-045) | Projects often span a site and a service | Exactly one per project | Forces duplicate projects |
| Generic `pr_only` kind (D-046) | Any qualified repository can receive PRs; preview/delivery stay limited to vetted kinds | Only `static_site` | Nothing but the demo site could be connected |
| Repository frozen on delegation | Execution spec invariant: changing target invalidates plan/candidate/approval | Resolve at each run step | Target could drift mid-run |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Connection | One GitHub App installation bound to exactly one tenant/organization | `repositories_connection` | Second binding of the same installation ID is refused (409) |
| Repository | A GitHub repository granted by a connection, identified by immutable GitHub repository ID; name is a display snapshot refreshed from the broker | `repositories_repository` | Rename on GitHub updates the snapshot; ID never changes |
| Profile kind | `pr_only`: sandbox checks, branch + PR, human merges in GitHub. `static_site`: execution-spec `external_site` behavior (private preview, approval, publication) | repository row | Unknown kind rejected by validator |
| Config epoch | Integer incremented by every change to base branch, kind or profile | repository row | Qualification of an older epoch is `stale` |
| Qualified | `qualification.status = passed` for the current epoch | repository row | Delegation refused with `repository_not_qualified` |
| Usable | status `active` AND qualified AND connection `active` AND repository still granted | derived | Delegation refused; broker refuses publication |
| Project link | Repository ↔ staff project; at most one `isDefault` per project | `repositories_project_link` | Setting a second default clears the first in the same transaction |
| Frozen binding | `repositoryId` + `configEpoch` + profile digest stored on the delegation at delegate time | `tasks_delegation` | Changed epoch or unusable repository fails the run at its next broker operation, never silently retargets |

Qualification checks (run by the broker, recorded as a report of named checks): App has the required repository permissions; base branch exists and is protected; every workflow reachable from `push`/`pull_request`/`pull_request_target`/`workflow_run` runs agent-authored code without secrets, writable tokens or privileged runners (execution spec "Before the first push"); declared commands are present in the profile. `static_site` adds the Vercel checks of D-042 and the execution spec (protection, disabled Git builds, prebuilt upload).

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Repository administrator | Connect installations; register, edit, qualify, disable, remove repositories | organization | `repositories.view`, `repositories.manage` |
| Project manager | Link/unlink registered repositories, set default | organization + project access (`staff.timesheets.projects.manage` or project membership) | `repositories.link` |
| Delegator | Delegate a task to Developer on one of its project's usable repositories | task project access | `tasks.delegate` (unchanged) |
| Viewer | See repositories and their qualification | organization | `repositories.view` |
| Agent principal | None on this module; reads its frozen binding through the run envelope only | — | none; `repositories.*` commands refuse `kind = agent` users |
| Broker (service) | Report installation/repository changes; check usability before publication | installation-level service credential | internal routes, not user features |

Trusted `tenantId`/`organizationId` come from the authenticated session (or, for broker callbacks, from the stored connection row matched by installation ID). A connection, repository or link is never readable across organizations; foreign IDs return 404. Developer enrollment and "external instance administrator" from the execution/delivery specs are replaced by these features plus project access (D-044). Delivery approvals for `static_site` keep `tasks.deployments.approve` (+ legal/commercial features) from the delivery spec.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Projects, tasks, board, drawer | reuse | core `staff` | project/task IDs | Source of truth for work |
| Delegation | extend | app `tasks` | `tasks.task.delegate` input + two nullable columns; optional DI `repositoryTargetResolver` | Delegation already owns target freezing |
| Registry, connections, links, qualification state | app-own | new `repositories` | commands, events | No installed equivalent |
| GitHub App key, installation tokens, qualification runs | reuse (planned) | broker (execution spec) | authenticated HTTP contract below | Credentials stay outside the app |
| Project tab | UMES injection | `detail:staff:staff_time_project:tabs` | widget | No edit of staff pages |
| Delegate sidebar repository select | extend | `tasks.injection.task-delegate-sidebar` | existing widget | Already renders the delegate control |
| Audit | reuse | `audit_logs` via command bus | commands | Every registry change is a command |
| Agent principal | reuse | `agent_orchestrator` `agentPrincipalService` | seed | Rename only |

## Architecture and Data Flow

```text
Admin ─► /backend/repositories ─► repositories.connection.start ─► GitHub install page (state nonce)
GitHub ─► /backend/repositories/connect?installation_id&state ─► repositories.connection.complete
                                   └─► broker GET /installations/{id} (verify account + granted repos)
Admin ─► register repos ─► repositories.repository.register ─► broker POST /qualifications ─► callback ─► qualification stored
PM ─► project tab ─► repositories.project_link.set
Delegator ─► task sidebar ─► tasks.task.delegate {agentUserId, repositoryId?}
                                   └─► repositoryTargetResolver.resolve(projectId, repositoryId?) ─► freeze {repositoryId, configEpoch}
Run ─► broker push/PR ─► broker GET OM /api/repositories/internal/usability?repositoryId&epoch ─► allow / refuse
GitHub installation webhooks ─► broker ─► OM /api/repositories/internal/installation-events
```

- **Module boundaries:** `repositories` owns connection/profile/link invariants; `tasks` owns delegation and stores only IDs and the epoch. No ORM relations across modules or to `staff`.
- **Extension points:** injected project tab; existing delegate sidebar widget; settings navigation entry.
- **Alternatives considered:** a custom field on staff project holding repository IDs — rejected: no default flag, no uniqueness, no link audit.
- **Compatibility:** `tasks.task.delegate` gains an optional `repositoryId` (additive). Delegations created before this spec have a null binding: their existing (non-target-aware) process keeps running to completion exactly as today, but they can never publish through the broker, because `usability` requires a binding. `/api/tasks/targets` from the execution spec is replaced by `GET /api/repositories/for-project`.

## User Journeys

### Journey J-001 — Connect and register

1. Administrator opens Settings → Code repositories and clicks **Connect GitHub**.
2. OM stores a single-use state nonce (10 min, bound to user + org) and redirects to the GitHub App install page.
3. On GitHub the administrator selects repositories and approves. The App has "Request user authorization (OAuth) during installation" enabled, so GitHub redirects back with `installation_id`, `setup_action`, `code` and `state`.
4. OM validates the nonce and sends `installationId` + `code` to the broker. The broker exchanges the code for a user token, confirms the installation appears in that user's `GET /user/installations`, discards the user token, and returns the account and granted repositories. `installation_id` alone is never trusted: it is a forgeable query parameter. OM stores the connection and shows the granted repositories not yet registered.
5. `setup_action=update` (repositories added/removed on an existing installation) refreshes the grant for the already-bound connection. `setup_action=request` (a non-owner asked their GitHub org owner to install) shows "Waiting for your GitHub organization owner to approve"; nothing is stored until an owner completes the flow.
6. Administrator ticks repositories, picks kind and base branch per repository, and registers them. Qualification starts; rows show `Qualifying…`, then `Qualified` or `Failed` with the failing checks.
7. Failures: expired/used nonce → "Connection link expired, start again"; installation already bound to another organization → 409 with no detail about that organization; broker unavailable → connection not stored, retry.

### Journey J-002 — Link to a project

1. Project manager opens a project → **Repositories** tab, adds one or more registered repositories and optionally marks one default.
2. Unqualified repositories can be linked but show a warning badge; they are not offered at delegation.

### Journey J-003 — Delegate

1. Delegator opens a backlog task and chooses **Developer**.
2. If the project has one usable repository or a usable default, the sidebar shows it preselected and changeable; with several and no default it requires a choice; with none it shows "No usable repository is linked to this project" with a link to the project tab (if the user has `repositories.link`).
3. Delegate freezes repository + epoch; the run envelope carries them.
4. Conflicts: repository disabled or re-qualified between opening and submitting → 409 `repository_changed`, sidebar reloads options.

### Journey J-004 — Revoke

1. Administrator disables a repository, removes it, or removes it from the App installation on GitHub.
2. New delegations stop immediately; in-flight runs fail at their next broker publication check with `repository_unavailable`, visible on the task.

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/repositories` | List; Connect GitHub; row actions: edit, re-qualify, disable/enable, remove | `GET /api/repositories`, commands below | `staff/backend/staff/teams` list | `Page`, `PageBody`, `DataTable` | loading, empty, error, permission denied | REQ-001, REQ-002 |
| `/backend/repositories/connect` | GitHub return: validate, then pick repositories to register | `repositories.connection.complete`, `repositories.repository.register` | same list page + dialog | `Page`, `DataTable` (selectable), `CrudForm` | loading, expired link, already bound, broker error, empty grant | REQ-001 |
| `/backend/repositories/[id]` | Edit base branch, kind, profile; qualification report; linked projects | `GET/PUT /api/repositories/{id}`, re-qualify | `staff/backend/staff/teams/[id]` | `CrudForm`, `DataTable` for report | loading, error, 409 conflict, stale qualification | REQ-002 |
| Project tab (`detail:staff:staff_time_project:tabs`) | Add/remove repositories, set default | `GET/POST/DELETE /api/repositories/project-links` | tasks sidebar widget | `DataTable`, picker from `GET /api/repositories/options` | loading, empty with guidance, conflict | REQ-003 |
| Delegate sidebar (`detail:staff:staff_time_task:sidebar`) | Repository select next to delegate | `GET /api/repositories/for-project?projectId` | existing widget | shared `Select` | none linked, single (preselected), many, stale | REQ-004 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Repository administrator | Settings → Code repositories | — | Settings → Code repositories → Connect GitHub (3 clicks + GitHub) |
| Project manager | Staff → Projects → project → Repositories tab | project tab | 3 clicks |
| Delegator | Staff → Board → task | delegate sidebar | unchanged + one select when needed |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Repository list | "No repositories yet. Connect a GitHub account to choose repositories." + Connect GitHub | table collapses to name + status | primary action first in tab order |
| Project tab | "Link a repository so tasks here can be delegated to Developer." + Add | single column | add dialog traps focus, Esc cancels |
| Delegate sidebar | "No usable repository is linked to this project." | inline | select labelled "Repository"; errors announced via live region |

### `/backend/repositories` — Code repositories

```text
┌──────────────────────────────────────────────────────────────┐
│ Code repositories                             [Connect GitHub]│
│ Search… | Kind ▾ | Status ▾                                   │
├──────────────────────────────────────────────────────────────┤
│ Repository          Kind        Branch  Qualification  Projects│
│ acme/landing        Static site main    ● Qualified    2      │
│ acme/api            PR only     main    ● Failed (2)   1      │
│ acme/docs           PR only     main    ○ Stale        0      │
├──────────────────────────────────────────────────────────────┤
│ ‹ 1 2 ›                                                       │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** status badges use shared status tokens; remove is a destructive confirmation that lists linked projects and active delegations; edit uses optimistic locking with 409 reload.
- **Responsive and accessibility:** badges carry text, not colour alone.
- **Localization:** `repositories.*` namespace; `tasks.delegate.repository.*` for sidebar strings.
- **Design-system and theming:** shared primitives and semantic tokens only.

## Data Models

### `repositories_connection`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID | PK | no | immutable |
| `tenant_id` / `organization_id` | UUID | scope index | no | trusted context |
| `provider` | varchar, `github` | — | no | immutable |
| `installation_id` | varchar(32) | **global unique** (`provider`, `installation_id`) where not deleted | no | immutable |
| `account_login` | varchar(100) | — | no | snapshot from broker |
| `status` | `active` \| `suspended` \| `removed` | — | no | from broker events |
| `connected_by` | UUID | — | no | user ID |
| `created_at` / `updated_at` / `deleted_at` | timestamps | — | no | soft delete |

### `repositories_connect_state`

`id`, scope, `user_id`, `nonce_hash` (SHA-256 of a 32-byte random nonce, unique), `expires_at`, `used_at`. Single use; expired rows are purged lazily by `connection.start`/`complete` (the `scheduler` module is not enabled in this app).

### `repositories_repository`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id`, scope | UUID | PK; scope index | no | — |
| `connection_id` | UUID | index | no | same module FK |
| `github_repository_id` | varchar(32) | unique (`organization_id`, `github_repository_id`) where not deleted | no | immutable |
| `full_name` | varchar(200) | search | no | snapshot, refreshed |
| `base_branch` | varchar(255) | — | no | must exist (broker) |
| `kind` | `pr_only` \| `static_site` | — | no | — |
| `profile` | jsonb | — | no | zod per kind; commands are strings run only in the sandbox; `static_site` holds Vercel account/project IDs, never tokens |
| `config_epoch` | int ≥ 1 | — | no | +1 on branch/kind/profile change |
| `qualification_status` | `pending` \| `running` \| `passed` \| `failed` \| `stale` | — | no | — |
| `qualification_epoch` | int, nullable | — | no | epoch the report belongs to |
| `qualification_report` | jsonb, nullable | — | no | `{checks: [{id, status, message}]}` from broker |
| `status` | `active` \| `disabled` \| `unavailable` | — | no | `unavailable` on revoke/suspend events; back to `active` on re-grant/unsuspend (qualification re-queued) |
| `created_at` / `updated_at` / `deleted_at` | timestamps | optimistic lock on `updated_at` | no | soft delete |

### `repositories_project_link`

`id`, scope, `project_id` (staff project ID, no ORM relation), `repository_id`, `is_default` bool, `created_by`, `created_at`, `updated_at`. Unique (`organization_id`, `project_id`, `repository_id`); partial unique (`organization_id`, `project_id`) where `is_default`.

### `tasks_delegation` (extended)

Add nullable `repository_id` UUID, `repository_config_epoch` int and `repository_profile_digest` varchar(64) (SHA-256 of the canonical profile JSON). Set once at delegate; never updated.

Migrations are generated with `yarn db:generate`, reviewed, and applied only after approval.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `POST` | `/api/repositories/connections/start` → `repositories.connection.start` | `repositories.manage` | — | `{ redirectUrl }` | 503 broker not configured | REQ-001 |
| `POST` | `/api/repositories/connections/complete` → `repositories.connection.complete` | `repositories.manage`, nonce owner | `{ installationId, setupAction, code?, state }` | `{ connectionId, grantedRepositories[] }`; `repositories.connection.connected` | 400 bad/expired state, 409 bound elsewhere, 502 broker | REQ-001 |
| `GET` | `/api/repositories` (`makeCrudRoute` list) | `repositories.view` | search, kind, status, page | `{ items, totalCount }` | — | REQ-002 |
| `POST` | `/api/repositories` → `repositories.repository.register` | `repositories.manage` | `{ connectionId, githubRepositoryIds[], kind, baseBranch? }` | created rows; qualification queued; `repositories.repository.registered` | 422 not granted, 409 already registered | REQ-001 |
| `PUT` | `/api/repositories/{id}` → `repositories.repository.update` | `repositories.manage` | `{ baseBranch?, kind?, profile?, updatedAt }` | epoch+1 if changed; qualification `stale`, re-queued | 409 version | REQ-002 |
| `POST` | `/api/repositories/{id}/qualify` → `repositories.repository.qualify` | `repositories.manage` | `{ updatedAt }` | 202 | 409 already running | REQ-002 |
| `POST` | `/api/repositories/{id}/disable` / `enable` | `repositories.manage` | `{ updatedAt }` | `repositories.repository.status_changed` | 409 | REQ-005 |
| `DELETE` | `/api/repositories/{id}` → `repositories.repository.remove` | `repositories.manage` | `updatedAt` | soft delete; links removed | 409 active delegations (must disable first) | REQ-005 |
| `GET` | `/api/repositories/options?search` | `repositories.link` or `repositories.view` | search, page ≤50 | `{ items: [{id, fullName, kind, qualificationStatus}] }` | — | REQ-003 |
| `GET` | `/api/repositories/for-project?projectId` | `tasks.delegate` + project access | projectId | `{ items: [{id, fullName, kind, isDefault, usable, reason?}] }` | 404 project | REQ-004 |
| `GET/POST/DELETE` | `/api/repositories/project-links` → `repositories.project_link.set` / `.remove` | `repositories.link` + project access | `{ projectId, repositoryId, isDefault, updatedAt? }` (required when changing an existing link) | `repositories.project_link.changed` | 404; 409 stale version or concurrent default flip | REQ-003 |
| command | `tasks.task.delegate` (extended) | `tasks.delegate` | `+ repositoryId?` | delegation with frozen binding | 422 `repository_required`, `repository_not_linked`, `repository_not_qualified`; 409 `repository_changed` | REQ-004 |
| `POST` | `/api/repositories/internal/qualification-results` | broker service credential | `{ repositoryId, epoch, status, report }` | stored if epoch current, else ignored | 401 | REQ-002 |
| `POST` | `/api/repositories/internal/installation-events` | broker service credential | `{ installationId, event, repositoryIds? }` | status updates | 401; unknown installation ignored | REQ-005 |
| `GET` | `/api/repositories/internal/usability` | broker service credential | `delegationId, repositoryId, epoch, profileDigest` | `{ usable, reason? }` — false unless the repository is usable at that epoch/digest, the delegation is active with that frozen binding, and the repository is still linked to the delegation's project | 401 | REQ-005 |

All public routes declare per-method `metadata` and OpenAPI, zod validation, scope from session. Both directions (OM → broker and broker → OM) use HMAC-SHA256 over `method\npath\nsorted-query\ntimestamp\nrequestId\nsha256(body)` with a key ID header for rotation, a 5-minute window and a replay cache of request IDs. Each direction has its own secret from the environment. Internal routes are excluded from public OpenAPI and AI tools. Commands are undoable where state allows (link/unlink, enable/disable); register/remove are audited, not undoable.

### Broker contract (implemented on the broker side)

| Operation | Purpose |
|---|---|
| `POST /installations/verify` `{installationId, code}` | Exchange the OAuth code, require the installation in the user's `/user/installations`, then via App JWT return account login and granted repositories (ID, full name, default branch); discard the user token |
| `GET /installations/{id}` | Refresh grant for an already-bound installation (App JWT) |
| `GET /repositories/{githubId}/branches` | Branch picker source |
| `POST /qualifications` `{repositoryId, githubRepositoryId, epoch, kind, profile}` | Run checks; post result to OM |
| Before every push/PR/publication | Call OM `usability` with the run's delegation and frozen binding; refuse when not usable |
| Before the first push of a run | Re-inspect workflows and branch protection at the run's base SHA; refuse if they no longer pass qualification (GitHub-side changes do not bump the epoch) |

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `repositories.connection.connected` / `status_changed` | `repositories` | audit, list cache | — | — |
| `repositories.repository.registered` / `updated` | `repositories` | outbox → broker | queue qualification | idempotent on (repositoryId, epoch) |
| `repositories.repository.qualified` (from qualification-results) | `repositories` | notifications | notify the connecting admin on failure | once per epoch |
| `repositories.repository.status_changed` | `repositories` | `tasks` subscriber | comment on tasks with active delegations on that repository | idempotent per delegation + status |
| `repositories.project_link.changed` | `repositories` (also emitted per link when a repository is removed) | cache | invalidate `for-project` | — |
| installation removed/suspended (webhook via broker) | broker | `repositories` | connection + repositories `unavailable` | replay-safe on request ID |

Qualification runs time out after 15 minutes; a missing callback leaves `running` and the page offers re-qualify after the timeout.

## Security, Privacy, and Compliance

- **Authorization:** feature gates above; delegation checks project access plus usability; agent-kind users are refused by every `repositories.*` command, and no repositories commands are registered as AI tools.
- **Tenant isolation:** an installation binds to one organization (global unique); all reads filtered by scope; foreign IDs 404; `for-project` validates project scope before listing.
- **Sensitive data:** no tokens, keys or Vercel secrets stored; profile validators reject fields named like secrets; broker HMAC secret only in environment.
- **Abuse and failure modes:** the state nonce stops CSRF and replays; the install-time OAuth `code` proves the returning GitHub user can access the installation, so a pasted foreign `installation_id` is refused (the redirect's `installation_id` is attacker-controllable); profile commands are untrusted and run only in the credential-free sandbox; host policy caps from the execution spec still apply on top of the profile.
- **Residual trust:** anyone holding `repositories.manage` can point Developer at any repository their GitHub installation grants. GitHub's install screen bounds that set.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | admin, fake broker | start → complete → register | connection + repos stored; qualification queued | REQ-001 |
| TEST-002 | security | nonce from another user/org, expired, reused | complete | 400; nothing stored | REQ-001 |
| TEST-003 | security | installation bound in org A; foreign installation ID with attacker's own valid state + code | complete in org B | 409 / 403 respectively; nothing stored; no org A data in response | REQ-001 |
| TEST-004 | integration | registered repo | update profile | epoch+1, status stale; old-epoch result ignored | REQ-002 |
| TEST-005 | integration | project, 0/1/many/default links | `for-project` + delegate with and without `repositoryId` | auto-resolve, `repository_required`, `repository_not_linked`, frozen binding | REQ-003, REQ-004 |
| TEST-006 | security | second tenant, agent user | read/link/delegate across scope; agent calls manage | 404/403 | REQ-003, REQ-004 |
| TEST-007 | integration | active delegation | disable repo; installation-removed event | `usability` false with reason; new delegate 422 | REQ-005 |
| TEST-008 | integration | internal routes | bad signature, replay, stale timestamp, tampered query/path, unknown key ID | 401 | REQ-005 |
| TEST-009 | UI | admin + PM + delegator | list empty/populated, connect errors, project tab, sidebar none/one/many, keyboard, dark mode | observable states | REQ-001..004 |
| TEST-011 | integration | stale qualification; qualification with no callback; broker 502 during complete | delegate; wait past timeout; complete | 422 `repository_not_qualified`; re-qualify offered after 15 min; nothing stored | REQ-002, REQ-001 |
| TEST-012 | integration | active delegation; link removed | usability check | false with `repository_unlinked` | REQ-005 |
| TEST-010 | integration | DB with `factory` principal | run setup | `developer` provisioned; `factory` still accepted by start subscriber | REQ-006 |

## Implementation Phases

### Phase 1 — Developer rename

- **Depends on:** none
- **Outcome:** board offers "Developer"; existing `factory` delegations keep working.
- **Why this order / value delivered:** tiny and independent of the registry; ships as its own PR. Removes the misleading name everywhere users see it.
- **Deliverables:** `FACTORY_AGENT_ID` → `DEVELOPER_AGENT_ID = 'developer'`, display name "Developer"; seed provisions `developer`; start subscriber and delegation accept both IDs; setup disables the old `factory` principal only when it has no active delegation.
- **Independent slices / estimated commits:** 1–2
- **Requirements closed:** REQ-006
- **Tests:** TEST-010
- **Validation:** `yarn generate && yarn typecheck && yarn test`
- **Exit gate:** fresh seed shows Developer; existing DEMO delegation still starts.

### Phase 2 — Registry and connect flow

- **Depends on:** Phase 1; broker installation/qualification endpoints (execution spec EX-P1) or the fake broker adapter for local work
- **Outcome:** administrators connect GitHub and register qualified repositories in the UI.
- **Why this order / value delivered:** replaces supervisor config for targets.
- **Deliverables:** `repositories` module (entities, migrations, commands, ACL, events, list/detail/connect pages, internal routes), DI `repositoryBroker` with fake + HTTP adapters, `pr_only` and `static_site` profile validators.
- **Independent slices / estimated commits:** entities+commands; connect flow; pages; internal routes — 4–6
- **Requirements closed:** REQ-001, REQ-002, REQ-005 (registry side)
- **Tests:** TEST-001..004, TEST-007, TEST-008, TEST-009 (list/connect/detail)
- **Validation:** `yarn db:generate` (review, ask before applying), `yarn generate`, typecheck, tests, integration
- **Exit gate:** with the fake broker, a repository goes connect → register → qualified in the browser, light/dark and narrow widths.

### Phase 3 — Project links and repository-bound delegation

- **Depends on:** Phase 2
- **Outcome:** tasks delegate to Developer against a project repository, frozen on the delegation.
- **Why this order / value delivered:** closes the user journey end to end.
- **Deliverables:** project tab widget, link commands, `for-project` route, `repositoryTargetResolver` DI, `tasks.task.delegate` extension and migration, sidebar select, run envelope fields, status-change subscriber.
- **Independent slices / estimated commits:** links; delegation; sidebar — 3–4
- **Requirements closed:** REQ-003, REQ-004, REQ-005 (delegation side)
- **Tests:** TEST-005, TEST-006, TEST-009 (tab/sidebar)
- **Validation:** full gate + integration
- **Exit gate:** DEMO project with two linked repositories: auto-select with default, required choice without, refusal when disabled.

### Phase 4 — Move the Stal-Zbiorniki target into the registry

- **Depends on:** Phase 3 and a qualified broker
- **Outcome:** the D-038 website is a `static_site` repository row linked to its project; the config-file target is removed.
- **Deliverables:** setup/CLI to register it idempotently by GitHub repository ID; docs update.
- **Requirements closed:** REQ-002 (static site)
- **Tests:** TEST-001 variant with `static_site`
- **Exit gate:** a website task delegates and previews using the registry binding.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, list/connect | connection, connect state, `connections/*`, register | 2 | TEST-001..003, 009 | AC-001, AC-004 |
| REQ-002 | J-001, detail | repository, update/qualify, qualification-results | 2, 4 | TEST-004, 009 | AC-002 |
| REQ-003 | J-002, project tab | project link, `project-links` | 3 | TEST-005, 006, 009 | AC-003 |
| REQ-004 | J-003, sidebar | `for-project`, `tasks.task.delegate` | 3 | TEST-005, 006 | AC-003 |
| REQ-005 | J-004 | status, installation-events, usability | 2, 3 | TEST-007, 008 | AC-005 |
| REQ-006 | board | seed, subscriber | 1 | TEST-010 | AC-006 |

## Backward Compatibility

Reviewed against `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`.

| Surface | Change | Treatment |
|---|---|---|
| `tasks.task.delegate` input / route | adds optional `repositoryId` | additive |
| `tasks.task.delegated` event payload | adds optional `repositoryId`, `repositoryConfigEpoch` | additive (§5 allows new optional fields) |
| Agent definition ID `factory` | new ID `developer` | deprecation bridge: subscriber and delegation accept both for one minor release; `factory` principal disabled by setup once it has no active delegation; removal noted in the changelog |
| `tasks_delegation` table | three nullable columns | additive-only (§8) |
| `/api/tasks/targets`, external enrollment | replaced | spec-only, never shipped; no bridge needed |
| New `repositories.*` routes, events, DI `repositoryTargetResolver`, `repositoryBroker` | new | become stable on first release |

## Rollout, Migration, and Rollback

Additive tables and two nullable columns; no data backfill except Phase 4's idempotent website registration. The module can be disabled in `src/modules.ts`; delegation then refuses target-aware runs with `repositories_unavailable` while ordinary staff work continues. Rollback: disable module; the columns stay null-tolerant. The `factory` agent ID remains accepted for one release after Phase 1.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| OM admin account compromise | Agent pointed at any granted repository | GitHub grant bounds the set; audit log; all repos still require qualification and PR review | Accepted (D-044) |
| Broker unavailable | Cannot connect or qualify | Explicit 502/503 states; registry reads work | Delays only |
| Stale usability during a run | Publication after disable | Per-operation usability check | One in-flight broker op may complete |
| Installation bound to wrong org | Cross-tenant access | Nonce bound to user+org; global unique installation | None known |
| Profile commands malicious | Sandbox abuse | Run only in credential-free sandbox under host caps | Execution-spec residuals |

## Acceptance Criteria

- [ ] **AC-001** — An administrator connects a GitHub installation and registers two repositories without entering any secret.
- [ ] **AC-002** — Editing a profile makes qualification stale; delegation is refused until the new epoch passes.
- [ ] **AC-003** — A project with one default among two linked repositories auto-selects the default; without a default, delegation without a choice returns `repository_required`.
- [ ] **AC-004** — An installation cannot be bound to a second organization, and a forged or reused state is refused.
- [ ] **AC-005** — Disabling a repository blocks new delegations at once and makes the broker usability check return false.
- [ ] **AC-006** — The board offers "Developer"; pre-existing `factory` delegations complete normally.
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root `AGENTS.md`; `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`; tasks module source; staff injection spots verified in installed `@open-mercato/core` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | traceability table |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001..J-004 across Phases 2–3 |
| Platform-native reuse and extension points were chosen before custom code | pass | reuse map |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI table |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | fail | Phase 2–4 exit gates against a real GitHub App need broker endpoints owned by the execution spec (EX-P1); only fake-broker gates are achievable now |

Verdict: `Blocked — broker installation/qualification endpoints are specified here but owned by the execution spec (EX-P1); Phase 2 can proceed against the fake broker adapter.`

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Cardinality | Jacek | — | Many per project, optional default (D-045), 2026-09-19 |
| Q-002 | Authority | Jacek | — | OM (D-044), 2026-09-19 |
| Q-003 | Profile kinds | Jacek | — | `pr_only` + `static_site` (D-046), 2026-09-19 |
| Q-004 | Agent name | Jacek | — | Developer (D-047), 2026-09-19 |
| Q-005 | Who links | Jacek | — | `repositories.link` + project access, 2026-09-19 |
| Q-006 | Split | — | — | One spec, phased, 2026-09-19 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Initial draft after D-043..D-047. |
