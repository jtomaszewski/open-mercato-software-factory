# Specs

Design specs for non-trivial changes. Naming: `SPEC-{NNN}-{YYYY-MM-DD}-{kebab-title}.md`.

Sections: TLDR, Problem Statement, User Stories, Proposed Solution, Design, Data Models,
API Contracts, Implementation Approach, Key Design Decisions, Open Questions, Changelog.

## Index

<!-- Number-allocation ledger: take the next {NNN} from here and add your row in the same
     commit that creates the spec. Numbers are never reused or renumbered. -->

| SPEC | Date | Title | Status | Description |
|------|------|-------|--------|-------------|
| [001](./SPEC-001-2026-09-18-agentic-software-factory.md) | 2026-09-18 | Agentic Software Factory on the Open Mercato Agent Orchestrator | Draft | A `tasks` module (delegation on the core `staff` task board) as intake; assigning a task to an agent triggers one orchestrator process (research → size → WSFF design gates in the Caseload → slices → coding runner or another effector → review → follow-up tasks); stateless, replaceable runner opening one PR per slice as a bot with one bounded CI fix round |
| [002](./SPEC-002-2026-09-18-tasks-module.md) | 2026-09-18 | Tasks module: agent delegation on the staff task board | Draft | The factory's intake on the core `staff` task board (projects, frozen references like `WEB-12`, board, comments): a human assignee plus an agent delegate whose setting emits `tasks.task.delegated`, process-owned status columns guarded by a command interceptor, run state derived from the orchestrator in two injected widgets; manual triggers only in the MVP |
| [003](./SPEC-003-2026-09-18-task-change-set.md) | 2026-09-18 | Task change set: what the factory proposes and does, on the task | Draft | Everything a delegated task changes as one typed list: `code` (PR, preview, planned vs touched files), `record` (workflow-safe command updates with before → after, compare-and-set apply, undo), `message` (replies staged by the factory, sent by a person under their own name), `artifact`; one effector function for mixed plans; runner progress events and manifest; previews behind a signed redirect |
| [004](./SPEC-004-2026-09-18-demo-stal-zbiorniki.md) | 2026-09-18 | Demo: Stal-Zbiorniki, a steel-tank maker runs its website from Open Mercato | Draft | The Sunday pitch as one company's story: a fictional steel-tank manufacturer (modelled on metal-zbiorniki.pl) fixes a product record, gets a new stock tank onto its website as a reviewed PR, and sees legal text wait for a lawyer; demo catalog seeded by `demo_fixtures`, target website, fallbacks, Q&A |
| [005](./SPEC-005-2026-09-19-stal-zbiorniki-www.md) | 2026-09-19 | Strona Stal-Zbiorniki, docelowe repo fabryki na demo | Draft | Strona producenta na Next ze static export, gdzie produkt to strona TSX w repo: PR per nowy zbiornik, preview per PR na Vercelu, test Playwright chodzący po zbudowanej stronie, status `factory/catalog-match` i osobna App do merge'a waivera, ścieżki zmapowane na klasy recenzji (`content` → waiver, `legal` → prawnik) |
| [006](./SPEC-006-2026-09-19-task-tools.md) | 2026-09-19 | Task management AI tools over MCP | Draft | One app module `task_tools` with five `defineAiTool` tools served by the Open Mercato MCP server: create/read/search/comment on `staff` tasks and list projects, with optional delegation through `tasks`; the tools write only tasks and comments |

Statuses: `Draft` → `Approved` → `Implemented` (or `Rejected` / `Superseded by SPEC-NNN`).

The spec body is state: keep it matching what is being built. The Changelog table is a record:
append dated rows, never rewrite old ones.
