# Open Mercato Software Factory

An agentic software factory on [Open Mercato](https://github.com/open-mercato/open-mercato)'s
Agent Orchestrator. Everything starts as a **task**. Assigning a task to an agent starts a
process: research → plan → a human approves in the Caseload → implementation → review →
follow-up tasks. The human reviews the plan, not the diff
([WSFF](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/wsff.md)).

Design: [`docs/specs/SPEC-001-2026-09-18-agentic-software-factory.md`](docs/specs/SPEC-001-2026-09-18-agentic-software-factory.md).

## Layout

| Path | What |
|---|---|
| `/` | Standalone Open Mercato 0.8 app ([`create-mercato-app`](https://docs.openmercato.com/customization/standalone-app), empty preset) with the enterprise `agent_orchestrator` module enabled |
| `src/modules/` | Our modules: `tasks` (the task board, the factory's intake), `factory` (agents, process definitions, webhooks), `demo_fixtures` (the demo company's catalog, [SPEC-004](docs/specs/SPEC-004-2026-09-18-demo-stal-zbiorniki.md)), `task_tools` (MCP tools for the `staff` task board) |
| `docs/agent-orchestrator.md` | How the upstream Agent Orchestrator works (architecture brief) |
| `docs/specs/` | Specs |
| `AGENTS.md` | Agent rules (Open Mercato's standalone-app harness); `CLAUDE.md` points to it |

## Quick start

Needs Node 24, Docker, corepack.

```bash
cp .env.example .env        # set OPENAI_API_KEY or ANTHROPIC_API_KEY (+ OM_AI_PROVIDER)
docker compose up -d        # Postgres, Redis, Meilisearch
corepack yarn install
corepack yarn generate
corepack yarn db:migrate
corepack yarn initialize    # prints logins; admin@acme.com / secret
corepack yarn dev           # http://localhost:3000/backend
```

Ports clash with another Open Mercato stack? Set `POSTGRES_PORT`, `REDIS_PORT`,
`MEILISEARCH_PORT` and `COMPOSE_PROJECT_NAME` in `.env`, and match the port in
`DATABASE_URL`.

Useful pages: **Agent Orchestrator → Playground** (`/backend/playground`), **Caseload**
(`/backend/caseload`), **Processes** (`/backend/processes`), **Workflows**.

## Reset to the demo state

`corepack yarn demo:reset` wipes the database in `.env` `DATABASE_URL` and seeds the
[SPEC-004](docs/specs/SPEC-004-2026-09-18-demo-stal-zbiorniki.md) demo: `init --reinstall
--no-examples`, then `demo_fixtures seed-stal-zbiorniki`, `task_delegation seed-demo` and
`factory ensure-process`. Plain `yarn reinstall` is not the same: it also seeds the core
example catalog (sneakers, haircuts).

`seed-stal-zbiorniki` also trims the sidebar to the pitch's working places, as a default for
every role in the tenant: Projekty › Zadania, Katalog › Produkty i usługi, Sprzedaż › Szanse
sprzedaży, Zamówienia, Klienci, and the whole Agenci and Automatyzacje groups. Hidden pages still
open by URL. To get the full menu back, clear the role default in Customize sidebar
(`/backend/sidebar-customization`).

- Stop `yarn dev` first (its queue worker writes during the wipe). Kill leftover Next and
  worker processes too: `pkill -f "$PWD/"`.
- Restart `yarn dev` afterwards. It rotates the MCP key and restarts the OpenCode sidecar. If
  that fails: `docker compose --profile agents up -d opencode`.
- Log in again (`superadmin@acme.com` / `secret`). Tenant and org ids change.
- GitHub is untouched: close leftover Factory PRs and branches on the landing repo.

## Connect an MCP client

The `task_tools` module (SPEC-007) lets Claude
Code or any MCP client work with the `staff` task board: `task_tools.list_projects`,
`search_tasks`, `get_task`, `create_task` and `comment_task`. `yarn dev` serves them at
`http://localhost:3001/mcp` (standalone: `yarn mercato ai_assistant mcp:serve-http --port 3001`).
When the enterprise agent modules are enabled, `factory.request_change` creates a `DEMO` task and
delegates it to Developer; the existing Agent Orchestrator process then prepares the website PR.

1. **Role.** Use a role holding `staff.timesheets.tasks.view`, `staff.timesheets.tasks.manage`
   and `staff.timesheets.projects.view` (read-only: drop `tasks.manage`). The built-in
   `employee` role has them; after enabling `staff` on an existing tenant, grant them with
   `yarn mercato auth sync-role-acls --tenant <tenantId>`. The key's user sees only projects
   they are a member of, unless they have `staff.timesheets.projects.manage`.
2. **Key.** Settings → API Keys: create a key for that user **with an organization selected** —
   the tools refuse keys without tenant and organization (`mcp:ensure-api-key` keys have no
   organization, so they do not work here).
3. **Claude Code** (`.mcp.json`, or `claude mcp add --transport http`):

   ```json
   {
     "mcpServers": {
       "open-mercato": {
         "type": "http",
         "url": "http://localhost:3001/mcp",
         "headers": { "x-api-key": "omk_REPLACE_WITH_YOUR_KEY" }
       }
     }
   }
   ```

`create_task` and `comment_task` write as soon as they are called and are not deduplicated:
calling `create_task` twice creates two tasks. Leave client-side tool approval on for them.
After changing the tool code, restart the MCP server; if it still runs old code, delete
`.mercato/generated/ai-tools.generated.bundled.mjs`.

## Licence note

`@open-mercato/enterprise` (the Agent Orchestrator) is source-available: free for local and
non-production use, production needs an enterprise licence. See
[packages/enterprise](https://github.com/open-mercato/open-mercato/blob/main/packages/enterprise).
