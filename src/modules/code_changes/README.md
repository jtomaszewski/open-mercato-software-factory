# code_changes

A delegated board task becomes a **change request** — one proposed change to a repository, in words
a business owner can act on — and the task's assignee approves (merges) or rejects (closes) it.
Agent-agnostic: the workflow and the coding agent belong to the module that owns the kind of work
(today `website_publishing`).

```
workflow (owned elsewhere) ─▶ code_changes.prepare_checkout ─▶ task In progress, repo cloned,
                                                               change request opened (generating)
                           ─▶ INVOKE_AGENT <coding agent> edits and builds `workDir`
                           ─▶ code_changes.open_pull_request ─▶ diff ─▶ PR ─▶ task link `pr`,
                                                               change request open ─▶ task In review
                                                  (any error ─▶ task closed as failed, CR failed)

Code section  ─▶ /backend/code/changes            every change request, newest first
              ─▶ /backend/code/changes/:id        one change request: summary, preview, checks,
                                                  diff, and how the agent got there
              ─▶ /backend/code/repositories       the repositories, the version each is on and
                                                  its last update (settings stay at /backend/repositories)

Decisions ─▶ POST /api/code_changes/change-requests/:id/approve   squash-merge ─▶ task Done
          ─▶ POST /api/code_changes/change-requests/:id/reject    close, with a reason ─▶ task Backlog
Task drawer ─▶ GET  /api/code_changes/tasks/:id/review   the PR's diff, checks and preview
            ─▶ POST /api/code_changes/tasks/:id/approve  routes to the change request's approve
```

## Change requests

`data/entities.ts` owns `ChangeRequest`: a record of ours, not a mirror of GitHub. It carries the
provider snapshot (repo, branch, number, url, head) *and* the decision — who decided, when, and
why — because that is the part an audit asks about and the part GitHub cannot answer for a person
who never had a GitHub account.

`commands/changeRequests.ts` is the whole life cycle, as commands:

| Command | Actor | Authorized by |
|---|---|---|
| `code_changes.change_request.start` | the run | the workflow process bound to the task |
| `code_changes.change_request.record_pull_request` | the run | as above |
| `code_changes.change_request.mark_failed` | the run | as above |
| `code_changes.change_request.approve` | a person | `task_delegation.delegate` + task assignee |
| `code_changes.change_request.reject` | a person | `task_delegation.delegate` + task assignee |

They are commands rather than route bodies on purpose: a later workflow — an autonomous approver,
a review gate, human-in-the-loop routing — drives the same transitions without re-implementing any
of the preconditions. Reverting a published change is **not** implemented; it is a different
decision with different consequences and does not exist yet under any name.

The run commands are idempotent per change request, because a workflow step may be replayed: a
replay never starts a second change request and never rewrites a decision that has since been made.

## Runs

- The functions read the task from the engine's workflow instance (`lib/run.ts`: process →
  `{ taskId, delegationId }`), act as the workflow definition's execution principal and write the
  task only through the task_delegation commands. Give their activities one engine attempt: the
  0.8.0 engine emits no `workflows.instance.failed` when an async activity fails, so the functions
  close the task as failed themselves (`closeOnFailure`).
- `prepare_checkout` returns `{ taskId, title, description, workDir, baseSha }`;
  `open_pull_request` takes `args.summary` (the agent's outcome) and `args.agentLabel` (PR body).
- Repository and token: the project's repository in Code repositories (`repositoryAccess`, a
  short-lived GitHub App token), else `CODE_CHANGES_GITHUB_TOKEN` + `CODE_CHANGES_REPO`
  (`CODE_CHANGES_BASE_BRANCH`, `CODE_CHANGES_GITHUB_API_URL`; the old `FACTORY_*` names still work).
- The checkout lives at `$OM_OPENCODE_WORKSPACE_ROOT/tasks/<taskId>`, bind-mounted into the OpenCode
  sidecar; `.git` stays outside the sandbox (`CODE_CHANGES_CHECKOUT_GIT_ROOT`, default
  `./.mercato/code-changes-git`), so nothing the agent writes can become a hook or config the host's
  git would run. Protected paths (`.github/`, `vercel.json`, `.env*`), links and build output are
  refused or dropped; the agent never holds the token.
