# website_publishing

Keeps the Stal-Zbiorniki website in step with the ERP (SPEC-004 scenes 3 and 3b, SPEC-005,
SPEC-006). Three intakes put a task on the DEMO board, delegated to the Software Engineer; its
process runs the Developer agent against the website repo through `code_changes`, and Marek
approves the PR from the task drawer.

```
catalog.product.created ─▶ subscribers/product-created.ts (is it in „Od ręki”?) ─▶ lib/board.ts: task links the product
sales.orders.update ─▶ commands/interceptors.ts (status → fulfilled?) ─▶ website_publishing.order.fulfilled
  └─▶ subscribers/order-fulfilled.ts ─▶ lib/board.ts: task links the order
catalog chat ─▶ website_publishing.request_change (ai-tools.ts) ─▶ task with the instructions (+ product link)
  └─▶ task_delegation.task.delegate ─▶ start-factory ─▶ process + workflow website_publishing.website_change:
        settle (10 s, the catalog form writes prices after the product)
        code_changes.prepare_checkout ─▶ In progress, the site cloned into the run sandbox
        website_publishing.load_task_records ─▶ the linked product (lib/catalogRecord.ts) or order (lib/orderRecord.ts)
        INVOKE_AGENT website_publishing.researcher (orders only; web_fetch on the customer's site)
        INVOKE_AGENT website_publishing.developer ─▶ edits and builds the checkout in the OpenCode sidecar
        code_changes.open_pull_request ─▶ PR ─▶ In review ─▶ approve in the drawer (code_changes)
```

- `website_publishing.website_change` is a DB-owned workflow definition (`workflowDefinitionAuthoring`)
  with `grantedFeatures: task_delegation.view, task_delegation.process, agent_orchestrator.agents.run`
  (+ the web features for the Researcher), so the run acts as its own least-privilege principal.
  Seeded by `setup.seedDefaults`, or `mercato website_publishing ensure-process` for an older
  tenant (also for a database seeded while this module was called `factory`).
- The run reads the product/order from the task description, never from the payload, so a task
  created by hand with a `/backend/catalog/products/<id>` link works the same way. The agent
  follows the site repo's own AGENTS.md; the linked record is in its prompt as the source of truth.
- Two 0.8.0 workarounds: `ai-agents.ts` registers the file agents from the app manifest (the
  package's loader only reads its own copy), and `scripts/fix-file-agents-manifest.mjs` renders
  the Developer's file-plane frontmatter into `docker/opencode/agents-local/`, which
  docker-compose mounts over the generated file. After editing `agents/*`: `yarn generate`, then
  restart the sidecar.
- `NEXT_PUBLIC_WEBSITE_URL` is the topbar „Website” link (build-time).
- Rehearsal: `yarn mercato website_publishing publish-product --product <id> --tenant <t> --org <o>`
  puts a product on the board like the intake does. Scene 3b: set order SO-2026-0042 to
  *Fulfilled*; `demo_fixtures/lib/suntago.json` is the cached scrape if `web_fetch` fails.
  Approving merges into the site repo's `main`, which publishes the page: reset the site after a
  rehearsal.
