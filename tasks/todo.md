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

## Open

- The migration is generated but **not applied**. `yarn mercato db migrate` (or the project's usual
  path) is needed before the Code changes tab shows anything.
