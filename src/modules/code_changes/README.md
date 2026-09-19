# code_changes

A delegated board task becomes a pull request on its project's repository, and the task's
assignee reviews and approves (merges) it from the task drawer. Agent-agnostic: the workflow and
the coding agent belong to the module that owns the kind of work (today `website_publishing`).

```
workflow (owned elsewhere) ─▶ code_changes.prepare_checkout ─▶ task In progress, repo cloned into the run sandbox
                           ─▶ INVOKE_AGENT <coding agent> edits and builds `workDir`
                           ─▶ code_changes.open_pull_request ─▶ diff ─▶ PR ─▶ task link `pr` ─▶ In review
                                                  (any error ─▶ task closed as failed)
Task drawer ─▶ GET  /api/code_changes/tasks/:id/review   the PR's diff, checks and preview
            ─▶ POST /api/code_changes/tasks/:id/approve  squash-merge at the checked head ─▶ Done (assignee only)
```

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
