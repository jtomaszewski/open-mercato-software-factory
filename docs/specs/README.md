# Specs

Design specs for non-trivial changes. Naming: `SPEC-{NNN}-{YYYY-MM-DD}-{kebab-title}.md`.

Sections: TLDR, Problem Statement, User Stories, Proposed Solution, Design, Data Models,
API Contracts, Implementation Approach, Key Design Decisions, Open Questions, Changelog.

## Index

<!-- Number-allocation ledger: take the next {NNN} from here and add your row in the same
     commit that creates the spec. Numbers are never reused or renumbered. -->

| SPEC | Date | Title | Status | Description |
|------|------|-------|--------|-------------|
| [001](./SPEC-001-2026-09-18-agentic-software-factory.md) | 2026-09-18 | Agentic Software Factory on the Open Mercato Agent Orchestrator | Partly implemented | A `task_delegation` module (delegation on the core `staff` task board) as intake; assigning a task to an agent triggers one orchestrator process (research → size → WSFF design gates in the Caseload → slices → coding runner or another effector → review → follow-up tasks); stateless, replaceable runner opening one PR per slice as a bot with one bounded CI fix round |
| [002](./SPEC-002-2026-09-18-tasks-module.md) | 2026-09-18 | Task delegation module: agent delegation on the staff task board | In progress | The factory's intake on the core `staff` task board (projects, frozen references like `WEB-12`, board, comments): a human assignee plus an agent delegate whose setting emits `task_delegation.task.delegated`, process-owned status columns guarded by a command interceptor, run state derived from the orchestrator in two injected widgets; manual triggers only in the MVP |
| [003](./SPEC-003-2026-09-18-task-change-set.md) | 2026-09-18 | Task change set: what the factory proposes and does, on the task | Draft | Everything a delegated task changes as one typed list: `code` (PR, preview, planned vs touched files), `record` (workflow-safe command updates with before → after, compare-and-set apply, undo), `message` (replies staged by the factory, sent by a person under their own name), `artifact`; one effector function for mixed plans; runner progress events and manifest; previews behind a signed redirect |
| [004](./SPEC-004-2026-09-18-demo-metal-zbiorniki.md) | 2026-09-18 | Demo: Metal Zbiorniki, a steel-tank maker runs its website from Open Mercato | Partly implemented | **The single source of truth for the Sunday pitch** (Polish, live): one company's story — a fictional steel-tank manufacturer (modelled on metal-zbiorniki.pl) fixes a product record, gets a new stock tank onto its website as a PR the owner approves on its preview, and after a fulfilled order sees the customer's logo and a case-study card on the site; state of each scene, closed decisions, tab order, fallbacks, Q&A, demo data |
| [005](./SPEC-005-2026-09-19-metal-zbiorniki-www.md) | 2026-09-19 | Strona Metal Zbiorniki, docelowe repo fabryki na demo | Partly implemented | Strona producenta na Next ze static export, gdzie produkt to strona TSX w repo: PR per nowy zbiornik, preview per PR na Vercelu, test Playwright chodzący po zbudowanej stronie, status `factory/catalog-match` i osobna App do merge'a waivera, ścieżki zmapowane na klasy recenzji (`content` → waiver, `legal` → prawnik) |
| [006](./SPEC-006-2026-09-19-realizacja-klienta.md) | 2026-09-19 | Realizacja na stronie: zrealizowane zamówienie → logo klienta i karta realizacji | Partly implemented | Scena 3b dema: zamówienie przestawione na `fulfilled` tworzy zadanie, researcher czyta stronę klienta przez `web_fetch` (opis), Developer pobiera logo, PR klasy `content` z logo w „Zaufali nam” i kartą realizacji; zdjęcia z załączników zamówienia jako drugi PR z galerią; Park of Poland (Suntago) jako klient demo |
| [007](./SPEC-007-2026-09-19-task-tools.md) | 2026-09-19 | Task management AI tools over MCP | Implemented | One app module `task_tools` with five `defineAiTool` tools served by the Open Mercato MCP server: create, read, search and comment on `staff` tasks and list projects; `staff` ACL, tenant/org scope from the API key; writes only tasks and comments |
| [008](./SPEC-008-2026-09-19-software-engineer-rename.md) | 2026-09-19 | Software Engineer: the delegatable agent gets a role name | Implemented | The agent provisioned as `Factory` renamed to `Software Engineer` everywhere a human reads it — picker, card, drawer, two CLI outputs, the orchestrator-unavailable message, SPEC-001/002 prose — with every identifier (`FACTORY_AGENT_ID`, `factory.deliver`, `FACTORY_COLUMNS`, the CI status, the product name) left alone; a CLI step renames the principal in databases that already ran setup, because provisioning writes the name only on create |
| [009](./SPEC-009-2026-09-19-assignment-picker.md) | 2026-09-19 | Assigned to: one picker for a person and an agent | Implemented | One "Assigned to" popover (People + Agents, `A`, searchable) on the card and in the drawer, replacing `staff`'s assignee `Select` plus our separate "Agent delegate" section: one audited, undoable `task_delegation.task.assign` takes a person, a person and an agent, or an agent alone; an app-owned roster (role → copy → process) decides which agents are pickable |

Statuses: `Draft` → `Approved` → `In progress` → `Partly implemented` → `Implemented` (or `Rejected` / `Superseded by SPEC-NNN`).

A spec's own `**Status**` line is authoritative; this column summarises it. When you move one, move the other in the same commit.

The spec body is state: keep it matching what is being built. The Changelog table is a record:
append dated rows, never rewrite old ones.
