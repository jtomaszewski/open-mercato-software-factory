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
| `src/modules/` | Our modules: `task_delegation` (handing a board task to an agent), `code_changes` (the change request: an agent's proposed change to a repository, and the decision on it), `website_publishing` (the catalog/sales/chat intakes, the Developer and Researcher agents, the `website_change` process), `repositories` (GitHub App connections and registered repositories), `demo_fixtures` (the Metal Zbiorniki catalog, company and branding, [SPEC-004](docs/specs/SPEC-004-2026-09-18-demo-metal-zbiorniki.md)), `task_tools` (MCP tools for the `staff` task board) |
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

Useful pages: **Code → Code changes** (`/backend/code/changes`, every change an agent proposed
and the approve/reject decision on it), **Code → Code repositories**
(`/backend/code/repositories`), **Agent Orchestrator → Playground** (`/backend/playground`),
**Caseload** (`/backend/caseload`), **Processes** (`/backend/processes`), **Workflows**.

## Reset to the demo state

`corepack yarn demo:reset` wipes the database in `.env` `DATABASE_URL` and seeds the
[SPEC-004](docs/specs/SPEC-004-2026-09-18-demo-metal-zbiorniki.md) demo: `init --reinstall
--no-examples`, then `demo_fixtures seed-metal-zbiorniki`, `task_delegation seed-demo` and
`website_publishing ensure-process`. Plain `yarn reinstall` is not the same: it also seeds the
core example catalog (sneakers, haircuts).

**The GitHub App connection survives a reset.** The App (`om-software-factory`) stays installed
on GitHub regardless; what a wipe used to destroy was our record of it — the connection, the
registered repository and its link to `WWW` — and rebuilding that costs a browser consent the
script cannot make. So the rows are carried over and re-scoped to the new tenant, and the script
says which repository it kept. Nothing new is granted: the consent already happened. To start
genuinely clean, disconnect in **Settings → Code repositories** after the reset.

**Scenes 3 and 3b need that link.** Without a repository the intake still puts its task on the
board and the coding run then dies at checkout — the script warns when none is linked.

First time, or after disconnecting: no personal access token is involved. Connect with one
consent click — **Code → Code repositories → Repository settings → Connect GitHub**, register the
landing repo, then link it to `WWW` on the project page. The run then uses a short-lived
installation token scoped to that one repository. If the App is *already* installed on your
account, use **Connect existing installation** instead: the plain Connect button opens GitHub's
install page, which is a dead end once the App is installed.

Two things to check if the consent redirect lands nowhere: the App must list
`<dev origin>/backend/repositories/connect` as a callback URL, and each Conductor worktree runs on
its own port (`CONDUCTOR_PORT`), so that origin differs per workspace.

`CODE_CHANGES_REPO` + `CODE_CHANGES_GITHUB_TOKEN` still work as a pre-registry fallback, but they
mean a long-lived personal token where the App gives a scoped, expiring one — prefer the App.

`seed-metal-zbiorniki` also trims the sidebar to the pitch's working places, as a default for
every role in the tenant: Projekty › Zadania, Katalog › Produkty i usługi, Sprzedaż › Szanse
sprzedaży, Zamówienia, Klienci, and the whole Agenci and Automatyzacje groups. Hidden pages still
open by URL. To get the full menu back, clear the role default in Customize sidebar
(`/backend/sidebar-customization`).

- Stop `yarn dev` first (its queue worker writes during the wipe). Kill leftover Next and
  worker processes too: `pkill -f "$PWD/"`.
- Restart `yarn dev` afterwards. It rotates the MCP key and restarts the OpenCode sidecar. If
  that fails: `docker compose --profile agents up -d opencode`.
- Log in again (`superadmin@acme.com` / `secret`). Tenant and org ids change.
- GitHub is untouched: close leftover agent PRs and branches on the landing repo. The change requests that pointed at them go with the database.

## Connect an MCP client

The `task_tools` module (SPEC-007) lets Claude
Code or any MCP client work with the `staff` task board: `task_tools.list_projects`,
`search_tasks`, `get_task`, `create_task` and `comment_task`. `yarn dev` serves them at
`http://localhost:3001/mcp` (standalone: `yarn mercato ai_assistant mcp:serve-http --port 3001`).
When the enterprise agent modules are enabled, `website_publishing.request_change` creates a `WWW` task and
delegates it to Developer; the existing Agent Orchestrator process then opens a **change request**
and prepares the website PR. `code_changes.list_change_requests` / `get_change_request` answer
whether it shipped, and `approve_change_request` / `reject_change_request` decide it.

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
