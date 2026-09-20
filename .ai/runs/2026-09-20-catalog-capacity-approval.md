# Catalog capacity correction through the existing assistant

Source doc: docs/specs/SPEC-004-2026-09-18-demo-metal-zbiorniki.md

## Goal

Prepare presentation scene 2 using the catalog assistant and its existing approval card: change ZDP-5000 from 5000 to 5200 litres in the catalog data, title and description after human confirmation.

## Scope

Add an app-owned `catalog_corrections` AI tool and additive extension of `catalog.merchandising_assistant`. Reuse pending actions, version rechecks, the scoped API runner and the owning catalog update route/command. Preserve unrelated metadata, SKU, dimensions and prices. No new table, migration, external write, paid model call, or deployment is part of this PR.

The presentation uses the shorter assistant flow, not the future task/Caseload change-set flow of SPEC-003. Desktop only. The installed pending-action gate checks staleness before execution; this work does not claim an atomic database compare-and-set that the catalog command does not provide.

## Implementation Plan

### Phase 1: Capacity correction

1. Amend scene 2 and its acceptance criteria to the confirmed assistant-only, capacity-only scope.
2. Test and implement the scoped capacity tool, before/after preview, metadata-preserving catalog write and additive agent extension.
3. Run discovery and the configured validation gate; verify preparation, cancellation/stale rejection, and the successful write using a disposable test record when the local test boundary is ready.
4. Obtain independent code and security review; publish the focused PR with exact evidence and remaining rehearsal requirements.

## Risks

- The stock `catalog.update_product` rejects metadata, so updating copy alone leaves `metadata.capacityLiters` unchanged. This tool must update both together through one catalog call.
- The current default approval gate checks record versions before executing a tool, but the catalog command does not provide atomic expected-version writes. Do not advertise stronger concurrency guarantees.
- Human confirmation and tenant/organization scope must remain mandatory. No privileged direct SQL correction or reset.
- PR #60 separately repairs search indexing after reset. Preserve the existing local demo, whose product is already query-visible; do not duplicate or run its reset.
- A paid model rehearsal is a separate bounded operation, requested only after local preparation.

## Progress

PR: #61

### Phase 1: Capacity correction

- [x] 1.1 Amend the presentation scope and acceptance criteria
- [x] 1.2 Implement and test the scoped approval-aware capacity tool
- [x] 1.3 Run discovery, full validation and deterministic integration verification
- [ ] 1.4 Complete independent review and PR handoff

## Verification

- Discovery, typecheck, lint, design-system check, 58 Jest suites / 325 tests and production build passed. Lint retains 10 pre-existing warnings outside this module.
- Approval-bypass regression: the real shared `executeTool` returned success before the guard (RED), then rejected unapproved execution without reads/writes (GREEN). All 19 focused tests passed.
- Deterministic local integration through the installed pending-action repository/executor and catalog API passed on a disposable product: preview without write, cancellation, stale-version rejection, confirmation storing 5200 in metadata and copy, unchanged SKU/dimensions/other metadata, replay without a second write, cleanup via the catalog delete command. No model call. Local credentials, fixture IDs and runtime logs remain outside Git.
- The initial build could not use a node_modules symlink outside the Turbopack root. Installing locked dependencies in this worktree resolved the environment failure; the normal build command then passed.
- Independent primary and security reviewers approved the corrected delta. The approval bypass and contradictory scene instructions identified in review were fixed and rechecked.
- Browser/model rehearsal remains separate; passing deterministic integration is not a claim that a live model has completed the presentation scene.
