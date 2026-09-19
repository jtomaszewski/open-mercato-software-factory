# fix(task_delegation): clarify assignment selection and agent launch

## Goal
Make the selected person or agent distinguishable from keyboard focus, explain agent execution before submission, and describe the actual Enter behavior.

## Scope
Desktop audit UI-02. Keep existing Open Mercato components, routes, backend authorization and data contracts.

## Non-goals
No other audit items, mobile, providers, migrations, paid agent runs, merge or production publication.

## Implementation Plan
1. Add a regression oracle and make the smallest complete UI correction.
2. Run configured validation, inspect desktop behavior, and complete independent review.

## Risks
Changed labels and conditional UI may affect user expectations. Cover the relevant states and preserve the existing mutation path.

## Progress

PR: #51

### Phase 1: Correct the audited behavior
- [x] 1.1 Add regression coverage and implement the scoped correction.
- [x] 1.2 Validate, inspect desktop, review, and publish the focused PR.

## Verification
RED: three expected failures. GREEN: 17 picker tests. Full generate, typecheck, lint, ds:check, 298-test suite and production build passed; the final hint correction has targeted coverage and a fresh successful build. Desktop checks covered selected versus highlighted rows, the launch warning, and Escape without saving.

Independent primary review: no introduced blockers. Desktop evidence is attached to PR #51.
