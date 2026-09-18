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
| `apps/mercato/` | Standalone Open Mercato 0.8 app (`create-mercato-app`, empty preset) with the enterprise `agent_orchestrator` module enabled |
| `apps/mercato/src/modules/` | Our modules: `tasks` (the task board, the factory's intake), `factory` (agents, process definitions, webhooks) |
| `docs/agent-orchestrator.md` | How the upstream Agent Orchestrator works (architecture brief) |
| `docs/specs/` | Specs |

## Quick start

Needs Node 24, Docker, corepack.

```bash
cd apps/mercato
cp .env.example .env        # set OPENAI_API_KEY or ANTHROPIC_API_KEY (+ OM_AI_PROVIDER)
docker compose up -d        # Postgres, Redis, Meilisearch
corepack yarn install
corepack yarn generate
corepack yarn db:migrate
corepack yarn initialize    # prints logins; admin@acme.com / secret
corepack yarn dev           # http://localhost:3000/backend
```

Ports clash with another Open Mercato stack? Set `POSTGRES_PORT`, `REDIS_PORT`,
`MEILISEARCH_PORT` and `COMPOSE_PROJECT_NAME` in `apps/mercato/.env`, and match the port in
`DATABASE_URL`.

Useful pages: **Agent Orchestrator → Playground** (`/backend/playground`), **Caseload**
(`/backend/caseload`), **Processes** (`/backend/processes`), **Workflows**.

## Licence note

`@open-mercato/enterprise` (the Agent Orchestrator) is source-available: free for local and
non-production use, production needs an enterprise licence. See
[packages/enterprise](https://github.com/open-mercato/open-mercato/blob/main/packages/enterprise).
