# Spike: the Developer agent runs inside the orchestrator's OpenCode sidecar

Goal: the coding run is an orchestrator agent run (visible on /backend/agents, Traces, the process
activity trail, cost per run), not a docker call the orchestrator never sees. Same shape as today
(checkout → agent edits → diff → PR), moved into the sidecar's file sandbox. Reverses D-009.

## Plan

- [x] Sidecar image: node 22 + git + npm on the pinned OpenCode base (`docker/opencode/Dockerfile`)
- [x] `entrypoint.sh`: `OM_OPENCODE_BASH_ENABLED` turns the global `bash` tool on (agents still gate it)
- [x] `docker-compose.yml`: build the local image, pass the flag
- [x] File agent `factory.developer` (`src/modules/factory/agents/developer/{AGENT,OUTCOME}.md`,
      `files: true`, `filesBash: true`, outcome `research { summary }`)
- [x] `lib/checkout.ts`: clone the site into `<workspace root>/factory/<taskId>` (git dir outside the
      sandbox), collect the diff after the run, clean up. Reuses the runner helpers.
- [x] `factory.deliver_product` workflow: settle → prepare_checkout (function) → develop
      (INVOKE_AGENT factory.developer) → open PR (function) → end
- [x] `di.ts`: register `factory.prepare_checkout`; `developer.ts` opens the PR from collected files
- [x] Remove `runner.ts`'s docker path + `docker/developer-runner`; update tests
- [x] `yarn generate`, build + start the sidecar (`--profile agents`), restart dev with the env
- [x] Run a DEMO task end to end; verify the run on /backend/agents, Traces, the process page
- [ ] Spec update (SPEC-001 decision, execution spec EX-P0 note, README) — after the run works

## Verification

- `yarn test` for factory + task_delegation; `yarn typecheck`; `yarn lint`
- A real run: task → PR opened; the run row exists with tool calls and cost; the task links the PR

## Review (2026-09-19)

- Run on task DEMO-5 (ZWM-1500): 94 s, 20 tool calls, all bash inside the sandbox, npm ci/lint/
  typecheck/build green, outcome submitted → PR #10 on the landing repo, task In review.
- Two 0.8.0 gaps found and worked around (see the factory README): the package's file-agent
  loader ignores the app manifest, and the CLI renders every agent file with write/edit/bash deny.
- The run principal needs `agent_orchestrator.agents.run` for the agent's MCP outcome submit.
- Open: spec update (D-009 reversal), cost/tokens on the run are null for the OpenCode runtime,
  the process page's activity trail, drawer link to the run.

---

# Demo scenario validation

## Plan

- [x] Identify the documented first demo scenario and the supported reseed/start commands.
- [x] Reseed the app and start the documented local environment.
- [ ] Walk the complete first scenario in the browser and capture screenshots at key states.
  Blocked: no Browser surface is available, and Scene 2's chat intake/Caseload record-change
  path is not implemented.
- [x] Record the result, evidence, and any blockers here.

## Verification

- ✅ The app readiness check succeeded after reseeding.
- ❌ The documented scenario cannot complete because the chat intake and Caseload record-change
  path are not implemented.
- ❌ No screenshots were captured because the Conductor browser runtime had no available browser.

## Review

- `corepack yarn demo:reset` completed and seeded seven products, the DEMO project, Park of
  Poland order, and Factory process.
- `scripts/conductor-run.sh` started the app at `http://localhost:55110`; migrations were current
  and readiness succeeded.
- Live authenticated API evidence confirmed `ZDP-5000` has `capacityLiters: 5000` and no
  dimensions, matching the Scene 2 starting state; the DEMO board has zero tasks.
- `BASE_URL=http://localhost:55110 PW_CAPTURE_SCREENSHOTS=1 corepack yarn test:integration
  --retries=0`: two authentication tests passed; the task-drawer UI case skipped because the
  reset intentionally creates no task.
- The Conductor browser runtime reported no available browser, so no useful UI screenshot or
  recording could be captured.
- Scene 2 is not runnable end to end in this revision: SPEC-004 still lists chat intake and
  Caseload record changes as missing, and `task_tools` says its tools are only allow-listable by
  an in-app agent later.

---

# Developer task intake tool

## Plan

- [x] Record the approved demo intake contract in a focused spec.
- [x] Add an approval-aware `factory.request_change` AI/MCP tool that creates a scoped staff task
      and delegates it to the existing Developer principal.
- [x] Extend the Catalog Merchandising Assistant with the tool and teach OpenCode clients when to
      use it and how to report queued work.
- [x] Generate discovery output and run focused plus broad validation.
- [x] Reseed/restart the demo, exercise the first scenario in the browser, and capture evidence.
- [x] Review the final diff and commit the completed slice.

## Verification

- `yarn test`: 39 suites / 209 tests green; `yarn lint`: 0 errors; `yarn typecheck`: clean apart
  from the live Developer checkout under `.mercato/opencode-work/` (tsconfig includes it mid-run).
- Live chat (superadmin, Catalog Merchandising Assistant): "ZWP-5000 ma teraz 5200 l … na naszej
  stronie WWW" → approval card (DEMO, Developer, product id) → Confirm → task DEMO-1 created and
  delegated → `factory.developer` run finished `ok` in the sidecar.
- PR step failed: `FACTORY_GITHUB_TOKEN` is empty in this worktree's `.env`.

## Review

- Live run exposed two bugs the mocks hid: the model invented `project: "website"` (input
  dropped; server always files on DEMO), and the in-process runner returned no projects for a
  super admin because it sends no selected-org cookie (fixed by `task_tools/lib/scoped-runner.ts`,
  also used by `task_tools`; lesson recorded).
- After approval the chat only shows "Action applied"; the task reference isn't shown back
  (installed pending-action flow gives the model no follow-up turn).

---

# Repository registry only (trimmed PR #43)

Goal: add GitHub repos through OM (GitHub App) and let the factory get its GitHub token from the
App instead of `gh auth token` → `FACTORY_GITHUB_TOKEN`. The Developer agent flow on main
(sidecar OpenCode, local checkout, diff → PR, in-app approve) stays as is.

Decisions (user, 2026-09-19): no qualification; broker optional → GitHub App calls in-app; new PR.

## Plan

- [x] `repositories` module from #43, trimmed: connections (GitHub App install + OAuth consent),
      register / edit base branch / disable / enable / remove, project links + default.
      Drop: kind/profile, qualification, broker transport, internal callback routes, outbox,
      replay table, recovery worker/schedule.
- [x] `lib/github-app.ts`: App JWT, installation grant, consent verify, branches, and a
      repo-scoped installation token (contents + pull_requests write) for the factory.
- [x] Fresh migration for the trimmed tables.
- [x] Factory: resolve `{ repo, baseBranch, token }` from the task project's default linked repo;
      fall back to `FACTORY_SITE_REPO` + `FACTORY_GITHUB_TOKEN`. Clone with the token (private repos).
- [x] Review/approve read the PR from the delegation's repo (PR URL), token from the same source.
- [x] Tests for token resolution, repo selection, App client, authenticated clone; README/.env.example/spec note.

## Verification

- `yarn generate && yarn typecheck && yarn lint && yarn test`
- Manual: connect the App, register the Stal-Zbiorniki repo, link to the demo project, run a task.

## Review (2026-09-19)

- `yarn generate`, `yarn typecheck`, `yarn lint` (0 errors), `yarn test` (46 suites / 228 tests), `yarn build` pass.
  `yarn ds:check` reports only the two findings already on main (`BackendHeaderChrome.tsx`).
- Migration `Migration20260919180625_repositories` creates only the 4 `repositories_*` tables; not applied.
- Not exercised live: GitHub App connect, register, and a task run with an App token (needs the App
  env + migration applied).
