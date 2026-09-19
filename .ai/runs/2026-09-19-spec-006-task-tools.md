# Execution plan — spec-006-task-tools

Source doc: docs/specs/SPEC-006-2026-09-19-task-tools.md
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Goal

Land the design of the task tools (five task management AI tools served by the Open Mercato
MCP server) as SPEC-006 with its glossary and decision record, so the team lead can review the
design before any code is written.

## Scope

- `docs/specs/SPEC-006-2026-09-19-task-tools.md` and its row in `docs/specs/README.md`.
- `CONTEXT.md` (project glossary) and `docs/adr/0001`.
- One changelog row each in SPEC-001 (`factory_send_task` superseded) and SPEC-002 (intake tool
  moved to SPEC-006).

**Non-goals:** no code under `src/`, no `src/modules.ts` change, no migration, no change to the
`tasks` module. Implementation follows in its own PR via
`om-auto-implement-spec docs/specs/SPEC-006-2026-09-19-task-tools.md`.

## Implementation Plan

### Phase 1: Design documents

1. **1.1 Spec and ledger** — SPEC-006 on the `SPEC-000` template (all sections), Draft status,
   row 006 in the ledger.
2. **1.2 Glossary and decisions** — `CONTEXT.md` with the shared vocabulary; ADR-0001 (own
   module `task_tools`).
3. **1.3 Cross-references** — changelog rows in SPEC-001 and SPEC-002 pointing at SPEC-006.
4. **1.4 Docs-only validation** — manual re-read of the full diff against `main`; CI (`ci.yml`)
   runs the configured gate on the PR. No markdown linter is configured in `package.json`.

## Risks

- The `tasks` module's HTTP contract (SPEC-002) may land differently than SPEC-006 assumes;
  Phase 2 of the spec is the only part affected (spec Q-001).
- The local worktree has no `node_modules`, so the configured `validation.commands` were not run
  locally; the change is Markdown only and CI runs the full gate on the PR.

## Progress

PR: #11

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Design documents

- [x] 1.1 Spec and ledger — 2712bcf
- [x] 1.2 Glossary and decisions — 2712bcf
- [x] 1.3 Cross-references — 2712bcf
- [x] 1.4 Docs-only validation — 2712bcf
