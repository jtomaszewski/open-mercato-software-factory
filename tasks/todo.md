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
