# factory

The software factory's first slice (SPEC-001, SPEC-004 scene 3, SPEC-005): a catalog product
created in the „Od ręki” category becomes a task on the DEMO board, delegated to the Factory
agent. The factory run opens a pull request with the product page in the website repo, and
Marek approves it from the task drawer.

```
catalog.product.created ─▶ subscribers/product-created.ts (is it in „Od ręki”?)
  └─▶ lib/board.ts: DEMO task (description links the product) ─▶ task_delegation.task.delegate → Factory
        └─▶ task_delegation start-factory ─▶ process factory.deliver ─▶ workflow factory.deliver_product
              └─▶ lib/deliver.ts (EXECUTE_FUNCTION, as the workflow's own principal):
                    In progress ─▶ the change (below) ─▶ task link `pr` ─▶ In review
                                                        (any error ─▶ Backlog, outcome failed)
The change (execution spec EX-P0), lib/runner.ts + lib/developer.ts: the host clones the site,
  the Developer agent (OpenCode 1.18.3) edits and builds it in a disposable om-developer-runner
  container that holds only the model key; the host refuses protected paths/links, commits on
  the cloned base and opens one PR per task
Task drawer ─▶ GET /api/factory/tasks/:id/review: the PR's diff, checks and preview
Task drawer „Zatwierdź i opublikuj” ─▶ POST /api/factory/tasks/:id/approve (assignee only)
  └─▶ lib/approve.ts: squash-merge at the checked head ─▶ task Done (delegation released, outcome done)
```

- `factory.deliver_product` is a DB-owned workflow definition (`workflowDefinitionAuthoring`)
  with `grantedFeatures: task_delegation.view, task_delegation.process`, so the run acts as its own least-privilege
  principal; the task_delegation process commands refuse human actors. Seeded by `setup.seedDefaults`, or
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
- Env: `FACTORY_GITHUB_TOKEN` (contents + pull requests on the site repo), `FACTORY_SITE_REPO`
  (default `jtomaszewski/hackaton-stal-zbiorniki-landing`), `FACTORY_SITE_BASE_BRANCH` (default
  `main`), `FACTORY_GITHUB_API_URL` (default `https://api.github.com`), `APP_URL` (links in the task and PR).
- The agent runner needs Docker and the image: `docker build -t om-developer-runner:local
  docker/developer-runner`. `.git` stays outside the mounted work tree, so nothing the agent
  writes can become a hook or config the host's git would run; build output is never published.
- Rehearsal: `yarn mercato factory publish-product --product <id> --tenant <t> --org <o>` puts
  the product on the board like the intake does.
  Approving merges into the site repo's `main`, which publishes the page: reset the site after a
  rehearsal.
