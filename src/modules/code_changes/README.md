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
Live      ─▶ GET  /api/code_changes/change-requests/:id/activity  the stage the run is at and what
                                                                  its agents did, polled while live
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

## Rights, events and tools

| File | What it adds |
|---|---|
| `acl.ts` | `code_changes.view` and `code_changes.decide`. Deciding is its own right: "may hand work to an agent" (`task_delegation.delegate`) and "may merge it into a production repository" belong to different people. The task-drawer routes require both, because they act on a delegation *and* on a change. |
| `setup.ts` | Grants `code_changes.*` to superadmin/admin and `code_changes.view` to employee, and enables the run commands as workflow steps. **Existing tenants need `yarn mercato auth sync-role-acls`** before anyone can open the Code section. |
| `events.ts` | `code_changes.change_request.{opened,ready,approved,rejected,failed}` plus a client-broadcast `.changed`. Emitted after the write commits and never able to undo it. |
| `workflows.ts` | Registers the three run commands as workflow-safe. `approve`/`reject` are deliberately absent — see below. |
| `notifications.ts` | Two bell types — `change_request.{ready,failed}` — and nothing else: opened is invisible work, and a decision is the consequence of a click the person just made. Neither offers approve/reject as an action, because merging without having seen the diff is the affordance this module refuses everywhere else. |
| `subscribers/` | `ready` notifies whoever holds `code_changes.decide`, `failed` whoever holds `task_delegation.delegate` (a run that produced nothing is work to hand out again, not a decision). Approving or rejecting clears the pending notification from every bell it reached (`deleteBySource`). One subscriber per event: a subscriber declares exactly one, and `change_request.*` would also match the `.changed` broadcast. A notification failure is logged and swallowed — a throwing subscriber fails the queued event and re-runs every other subscriber of it. |
| `ai-tools.ts` | `list_change_requests`, `get_change_request` (the proof the catalog assistant needs before claiming a change shipped) and the two decisions, going through the same commands a click does. |

### Why a workflow cannot approve yet

`resolveDecision` requires the caller to be the task's accountable assignee, and a workflow
principal never is. Offering `approve`/`reject` as workflow steps would advertise a step that
always fails, so they are not registered. Autonomous or human-in-the-loop approval needs that
assignee rule to become a policy first; that is the first thing to design when workflows come back
on the table.

## Runs

- While a run is in flight the detail page shows what the agent is doing (`lib/activity.ts`,
  `components/ChangeRequestActivityCard.tsx`). Two sources, merged by `lib/activityFeed.ts`: the
  persisted trace (`agent_spans` + `agent_tool_calls` of the runs on this run's workflow instance),
  which the OpenCode runtime writes in ONE ingest when a session ends, and the
  `agent_orchestrator.run.progress` broadcast, which arrives per tool call but only in browsers
  that were already open. That broadcast is organization-scoped, so the merge renders a live line
  only once the polled activity confirms its run belongs to this change request.
- `lib/agentSteps.ts` maps a tool name onto what it MEANS (reading, editing, building, …). The
  reader of a change request is the person who will approve it; `bash` is not an answer for them.
  The raw tool and its command or file stay behind the card's "show commands" toggle.

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
