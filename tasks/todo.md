# Code section: change requests + repositories

## What was built

A **Code** section in the backend nav with two tabs:

- **Code changes** (`/backend/code/changes`) — every change request, newest first; detail at
  `/backend/code/changes/:id` with approve / reject.
- **Repositories** (`/backend/code/repositories`) — one card per registered repository: the version
  its base branch is on, its last update (what, when, by whom), its linked projects, and a link to
  the existing repository settings screen.

And the concept behind the list: a **change request** — one proposed change to a repository, named
so a non-technical owner can act on it. GitHub calls it a pull request; the record is ours.

## Done

- [x] `code_changes/data/entities.ts` — `ChangeRequest` (+ migration `Migration20260920033819`)
- [x] `code_changes/commands/changeRequests.ts` — start / record_pull_request / mark_failed
      (run-authorized) and approve / reject (person-authorized)
- [x] `code_changes/lib/approve.ts` — shared precondition resolver; `rejectTaskPullRequest` added
- [x] `code_changes/lib/github.ts` — `closePullRequest`, merge returns the merge commit
- [x] `code_changes/lib/changeRequests.ts` — list / read / find-for-task
- [x] `code_changes/lib/functions.ts`, `lib/run.ts` — the run opens, fills and fails its change request
- [x] API — `GET /api/code_changes/change-requests`, `GET .../:id`, `POST .../:id/approve`,
      `POST .../:id/reject`; the task-drawer approve now routes through the same command
- [x] `repositories/lib/github-app.ts` — `headCommit`; `GET /api/repositories/overview`
- [x] UI — `ChangeRequestsTable`, `ChangeRequestDetail`, `RepositoriesOverview`,
      `src/components/CodeSectionTabs.tsx`
- [x] `task_delegation/lib/runsQuery.ts` — the run behind a change request (milestones + task writes)
- [x] i18n en + pl; `backend.nav.code`
- [x] Tests for the new units; `code_changes` suite updated
- [x] `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`

## Not done, deliberately

- **Revert** — the user marked it with a "?", and reverting a published change is a different
  decision with different consequences (a new commit on the base branch). Nothing pretends to
  support it.
- **Workflows over the actions** (autonomous approve, human-in-the-loop routing) — explicitly out
  of scope for now. The transitions are commands precisely so those can be added without touching
  any of the preconditions.

## Follow-up audit (2026-09-20)

Reviewed the module against its siblings' conventions, the specs, and the i18n set.

- [x] `acl.ts` — the module now owns `code_changes.view` / `code_changes.decide`; every surface was
      gated on another module's features. The task-drawer pair requires both, because it acts on a
      delegation as well as on a change.
- [x] `setup.ts` — grants + workflow-command enablement; `__tests__/setup.test.ts` guards them.
- [x] `events.ts` — `change_request.{opened,ready,approved,rejected,failed,changed}`. There was no
      way to notice a change request move; our own drawer widget listened to another module's stream.
- [x] `workflows.ts` — the three run commands registered as workflow-safe.
- [x] `ai-tools.ts` — list / get / approve / reject. The catalog assistant is told never to claim a
      change shipped without proof, and until now no tool could supply that proof.
- [x] `api/openapi.ts` — one tag + error schema instead of six copies; response schemas added.
- [x] `index.ts` — description rewritten, `staff` added to `requires`, `features` re-exported.
- [x] **Bug:** `head_sha` and `repository_id` were columns nothing ever wrote. Threaded through.
- [x] **Bug:** the Code tab bar pointed at `code_changes.runs.nav.title`, a key deleted in the
      rename — a Polish user saw an English tab beside a Polish sidebar entry, silently.
- [x] `.ai/specs/2026-09-20-change-requests.md` — the missing spec, written after the fact.
- [x] Term collision resolved: `developer-task-intake.md` used "change request" for a task +
      delegation. Supersession notes added there and on three other specs.
- [x] Root `README.md` — module inventory named two renamed modules; `factory ensure-process` was
      already `website_publishing ensure-process` in the script.

## Open

- **AC-006: no integration coverage** for the list / approve / reject paths. Unit tests cover the
  decision preconditions; the API and UI paths are not exercised.
- **A workflow still cannot approve** — the assignee rule is hardcoded, so `approve`/`reject` are
  deliberately not workflow-safe. Making autonomous approval possible means turning that rule into
  a policy first.
- `yarn mercato auth sync-role-acls` ends with an unrelated `Metadata for entity CustomerRole not
  found` error *after* writing the role features. The grants land; the failure is in a later stage
  and involves a module untouched here.
