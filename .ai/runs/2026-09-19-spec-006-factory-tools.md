# Execution plan — spec-006-factory-tools

Source doc: docs/specs/SPEC-006-2026-09-19-factory-tools.md
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Goal

Land the design of the factory tools (chat intake agent, six AI tools, site drift detection) as
SPEC-006 with its glossary and decision records, so the team lead can review the design before
any code is written.

## Scope

- `docs/specs/SPEC-006-2026-09-19-factory-tools.md` and its row in `docs/specs/README.md`.
- `CONTEXT.md` (project glossary) and `docs/adr/0001`, `docs/adr/0002`.
- One changelog row each in SPEC-001 (`factory_send_task` superseded) and SPEC-002 (chat intake
  moved to SPEC-006).

**Non-goals:** no code under `src/`, no `src/modules.ts` change, no migration, no change to the
`tasks` module or the site repo. Implementation follows in its own PR via
`om-auto-implement-spec docs/specs/SPEC-006-2026-09-19-factory-tools.md`.

## Implementation Plan

### Phase 1: Design documents

1. **1.1 Spec and ledger** — SPEC-006 on the `SPEC-000` template (all sections), Draft status,
   row 006 in the ledger.
2. **1.2 Glossary and decisions** — `CONTEXT.md` with the shared vocabulary (English; PL terms
   where the demo uses them); ADR-0001 (own module `factory_tools`), ADR-0002 (chat writes only
   tasks).
3. **1.3 Cross-references** — changelog rows in SPEC-001 and SPEC-002 pointing at SPEC-006.
4. **1.4 Docs-only validation** — manual re-read of the full diff against `main`; CI (`ci.yml`)
   runs the configured gate on the PR. No markdown linter is configured in `package.json`.

## Risks

- The `tasks` module's HTTP contract (SPEC-002) may land differently than SPEC-006 assumes;
  Phase 3 of the spec is the only part affected (spec Q-001).
- The local worktree has no `node_modules`, so the configured `validation.commands` were not run
  locally; the change is Markdown only and CI runs the full gate on the PR.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Design documents

- [ ] 1.1 Spec and ledger
- [ ] 1.2 Glossary and decisions
- [ ] 1.3 Cross-references
- [ ] 1.4 Docs-only validation
