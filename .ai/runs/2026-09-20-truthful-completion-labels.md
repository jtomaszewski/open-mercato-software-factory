# fix(ui): distinguish task completion from website deployment

## Goal
Use truthful review and completion copy: approval merges a change and closes the task, while completed task state does not prove a live website deployment.

## Scope
Desktop audit UI-04b. Keep existing Open Mercato components, routes, backend authorization and data contracts.

## Non-goals
No other audit items, mobile, providers, migrations, paid agent runs, merge or production publication.

## Implementation Plan
1. Add a regression oracle and make the smallest complete UI correction.
2. Run configured validation, inspect desktop behavior, and complete independent review.

## Risks
Changed labels and conditional UI may affect user expectations. Cover the relevant states and preserve the existing mutation path.

## Progress

PR: #54

### Phase 1: Correct the audited behavior
- [x] 1.1 Add regression coverage and implement the scoped correction.
- [x] 1.2 Validate, inspect desktop, review, and publish the focused PR.

## Verification
All 16 edited locale values parsed successfully with identical key sets and placeholders. Generate, typecheck, lint, ds:check, all 295 tests and production build passed. Desktop QA inspected the review panel. Completed-state meaning was checked against the source, including manual completion; no merge or live deployment was executed.

Independent primary review: no introduced blockers. Desktop evidence is attached to PR #54.
