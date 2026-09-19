# fix(task_delegation): distinguish empty agent search results

## Goal
Show a search-specific message when configured agents do not match the query, preserving the empty-roster message.

## Scope
Desktop audit UI-03. Keep existing Open Mercato components, routes, backend authorization and data contracts.

## Non-goals
No other audit items, mobile, providers, migrations, paid agent runs, merge or production publication.

## Implementation Plan
1. Add a regression oracle and make the smallest complete UI correction.
2. Run configured validation, inspect desktop behavior, and complete independent review.

## Risks
Changed labels and conditional UI may affect user expectations. Cover the relevant states and preserve the existing mutation path.

## Progress

PR: #52

### Phase 1: Correct the audited behavior
- [ ] 1.1 Add regression coverage and implement the scoped correction.
- [ ] 1.2 Validate, inspect desktop, review, and publish the focused PR.
