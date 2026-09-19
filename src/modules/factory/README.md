# factory

The software factory's first slice (SPEC-001, SPEC-004 scene 3, SPEC-005): a catalog product
created in the „Od ręki” category becomes a task on the DEMO board, delegated to the Factory
agent. The factory run opens a pull request with the product page in the website repo, and
Marek approves it from the task drawer.

```
catalog.product.created ─▶ subscribers/product-created.ts (is it in „Od ręki”?)
  └─▶ lib/board.ts: DEMO task (description links the product) ─▶ task_delegation.task.delegate → Factory
        └─▶ task_delegation start-factory ─▶ process factory.deliver ─▶ workflow factory.deliver_product
              └─▶ lib/deliver.ts (as the workflow's own principal):
                    factory.prepare_checkout ─▶ In progress, the site cloned into the run sandbox
                    INVOKE_AGENT factory.developer ─▶ the orchestrator run (below)
                    factory.deliver_product_pr ─▶ diff ─▶ PR ─▶ task link `pr` ─▶ In review
                                                        (any error ─▶ Backlog, outcome failed)
The run, agents/developer + lib/checkout.ts: the Developer file agent edits and builds the
  checkout in the OpenCode sidecar (bash + edit inside the sandbox root), so the run, its tool
  calls, trace and cost are the orchestrator's (Backend → Agents, Traces, the process page); the
  host refuses protected paths/links, commits on the cloned base and opens one PR per task
Scene 3b (SPEC-006): sales.orders.update ─▶ commands/interceptors.ts (status → fulfilled?)
  └─▶ factory.order.fulfilled ─▶ subscribers/order-fulfilled.ts ─▶ lib/board.ts: DEMO task (links the order)
        └─▶ the same factory.deliver: prepare_checkout loads the order (lib/orderRecord.ts), then
              INVOKE_AGENT factory.researcher (web_fetch on the customer's website; only when there is
              an order) ─▶ factory.developer adds the logo + the realization entry ─▶ PR ─▶ In review
Task drawer ─▶ GET /api/factory/tasks/:id/review: the PR's diff, checks and preview
Task drawer „Zatwierdź i opublikuj” ─▶ POST /api/factory/tasks/:id/approve (assignee only)
  └─▶ lib/approve.ts: squash-merge at the checked head ─▶ task Done (delegation released, outcome done)
```

- `factory.deliver_product` is a DB-owned workflow definition (`workflowDefinitionAuthoring`)
  with `grantedFeatures: task_delegation.view, task_delegation.process, agent_orchestrator.agents.run`,
  so the run acts as its own least-privilege principal (the agent's OpenCode session submits its
  outcome through MCP as that principal); the task_delegation process commands refuse human actors. Seeded by `setup.seedDefaults`, or
  `mercato factory ensure-process` for an older tenant.
- The run reads its process from the engine's workflow instance id and the product from the task
  description, never from the payload. A task created by hand with a
  `/backend/catalog/products/<id>` link works the same way.
- The 0.8.0 engine emits no `workflows.instance.failed` when an async activity fails (the
  orchestrator process then stays `running`). So the activity has one engine attempt, the
  function retries transient GitHub errors itself, and it closes the task as failed on the
  final error.
- The agent follows the site repo's own AGENTS.md (file layout, the product mapping table); the
  linked product's catalog record is in its prompt as the source of truth.
- Site repo and token: the task project's default (or only) repository linked in Code repositories
  (`src/modules/repositories`), with a GitHub App installation token scoped to that repository;
  the clone, the PR, the review panel and approve all use it. A project with no linked repository
  falls back to the env below; a linked repository that is disabled or no longer granted fails
  the run instead of falling back.
- Env: `FACTORY_GITHUB_TOKEN` (contents + pull requests on the site repo), `FACTORY_SITE_REPO`
  (default `jtomaszewski/hackaton-stal-zbiorniki-landing`), `FACTORY_SITE_BASE_BRANCH` (default
  `main`), `FACTORY_GITHUB_API_URL` (default `https://api.github.com`), `APP_URL` (links in the task and PR).
- The agent needs the OpenCode sidecar with the file and shell planes on and node + git in the
  image (`docker/opencode/Dockerfile`; see the factory section of `.env.example`). Its checkout
  lives at `$OM_OPENCODE_WORKSPACE_ROOT/factory/<taskId>`; `.git` stays outside the sandbox, so
  nothing the agent writes can become a hook or config the host's git would run; build output is
  never published.
- Two 0.8.0 workarounds: `ai-agents.ts` registers the file agent from the app manifest (the
  package's loader only reads its own copy), and `scripts/fix-file-agents-manifest.mjs` renders
  the agent's file-plane frontmatter into `docker/opencode/agents-local/` (the CLI renders
  `write/edit/bash: deny`), which docker-compose mounts over the generated file. After editing
  `agents/developer`: `yarn generate`, then restart the sidecar.
- Rehearsal of scene 3b: set order SO-2026-0042 to *Fulfilled* on its page (or PUT
  `/api/sales/orders` with the `fulfilled` status entry). A `web_fetch` failure leaves the
  Researcher's description thin; `demo_fixtures/lib/suntago.json` is the cached scrape.
- Rehearsal: `yarn mercato factory publish-product --product <id> --tenant <t> --org <o>` puts
  the product on the board like the intake does.
  Approving merges into the site repo's `main`, which publishes the page: reset the site after a
  rehearsal.
