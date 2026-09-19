# Hide status panels for tasks without an agent run

## Goal
A human-owned or completed task must not claim nobody is working or offer a misleading delegation shortcut.

## Scope
UI-01: hide the redundant run panel when no live or closed agent run exists. The existing assignment picker remains the place to choose an owner or agent. Preserve active and closed run presentation and all backend permissions and transitions.

## Implementation Plan
1. Reproduce missing/released delegation rendering with component tests, then hide the panel.
2. Run focused and configured validation, desktop QA, and an independent review.

## Non-goals
No data, API, workflow, permission, provider, mobile, or other audit changes.

## Risks
The backlog no longer has a second delegation shortcut. Its existing assignment picker remains available.

## Progress

### Phase 1: Correct the panel
- [ ] 1.1 Add regression coverage and hide the no-run panel.
- [ ] 1.2 Validate, inspect desktop, review, and publish the focused PR.
