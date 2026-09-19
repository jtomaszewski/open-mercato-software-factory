# fix(repositories): add a return path after connection errors

## Goal
Provide a local return to the repository list when a GitHub connection callback is invalid or fails.

## Scope
Desktop audit UI-05. Keep existing Open Mercato components, routes, backend authorization and data contracts.

## Non-goals
No other audit items, mobile, providers, migrations, paid agent runs, merge or production publication.

## Implementation Plan
1. Add a regression oracle and make the smallest complete UI correction.
2. Run configured validation, inspect desktop behavior, and complete independent review.

## Risks
Changed labels and conditional UI may affect user expectations. Cover the relevant states and preserve the existing mutation path.

## Progress

PR: #55

### Phase 1: Correct the audited behavior
- [x] 1.1 Add regression coverage and implement the scoped correction.
- [ ] 1.2 Validate, inspect desktop, review, and publish the focused PR.

## Verification
RED: two expected failures. GREEN: three component tests, including the existing in-flight callback regression. Generate, typecheck, lint, ds:check, all 297 tests and production build passed. Desktop QA verified the error layout and navigation back to the list; the link uses the framework-required Next Link component.

Independent primary review is pending because runtime dispatch was blocked. Desktop evidence is attached to PR #55.
