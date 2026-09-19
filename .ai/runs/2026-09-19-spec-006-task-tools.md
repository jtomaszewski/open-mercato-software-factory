# Execution plan — spec-006-task-tools

Source doc: docs/specs/SPEC-006-2026-09-19-task-tools.md
Engine: om-auto-create-pr (steps: 2, --loop: no)

## Goal

Land the design of the task tools (five task management AI tools served by the Open Mercato
MCP server over the `staff` task board) as SPEC-006, so the team lead can review it before any
code is written.

## Scope

- `docs/specs/SPEC-006-2026-09-19-task-tools.md` and its row in `docs/specs/README.md`.

**Non-goals:** no code under `src/`, no `src/modules.ts` change, no migration. Implementation
follows in its own PR via `om-auto-implement-spec docs/specs/SPEC-006-2026-09-19-task-tools.md`.

## Implementation Plan

### Phase 1: Design documents

1. **1.1 Spec and ledger** — SPEC-006 on the `SPEC-000` template (all sections, brief), Draft
   status, row 006 in the ledger.
2. **1.2 Docs-only validation** — manual re-read of the full diff against `main`; CI (`ci.yml`)
   runs the configured gate on the PR. No markdown linter is configured in `package.json`.

## Risks

- The local worktree has no `node_modules`, so the configured `validation.commands` were not run
  locally; the change is Markdown only and CI runs the full gate on the PR.

## Progress

PR: #11

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Design documents

- [x] 1.1 Spec and ledger — 2712bcf
- [x] 1.2 Docs-only validation — 2712bcf
