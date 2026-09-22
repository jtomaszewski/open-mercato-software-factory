# fix(repositories): clarify project repository states and actions

## Goal
Explain empty repository choices, default repository use, project disconnection, and removal from the local registry.

## Scope
Desktop audit UI-07. Keep existing Open Mercato components, routes, backend authorization and data contracts.

## Non-goals
No other audit items, mobile, providers, migrations, paid agent runs, merge or production publication.

## Implementation Plan
1. Add a regression oracle and make the smallest complete UI correction.
2. Run configured validation, inspect desktop behavior, and complete independent review.

## Risks
Changed labels and conditional UI may affect user expectations. Cover the relevant states and preserve the existing mutation path.

## Progress

PR: #57

### Phase 1: Correct the audited behavior
- [x] 1.1 Add regression coverage and implement the scoped correction.
- [x] 1.2 Validate, inspect desktop, review, and publish the focused PR.

## Verification
RED: four expected failures. GREEN: four component tests covering empty choices, linked choices, an accessible selector, and the unchanged versioned disconnection request. Generate, typecheck, lint, ds:check, all 299 tests and production build passed. The final wording correction has a fresh focused test pass and build. Desktop QA at 1440px passed: empty registry, available selection with keyboard, disabled add before selection, linking as default, all listed repositories linked, default guidance, disconnection, registry navigation, and removal confirmation with cancel. Temporary fixtures were removed after testing. Existing options pagination still limits the picker to the first 50 repositories.

Independent native primary review found no actionable issues at commit 84f397a71a740b1dfd00ab96a139d15fc28eb70f. Desktop evidence is attached to PR #57.

Latest main (140dfd8) adds repository overview translations without changing the reviewed project widget or its keys; a merge-tree compatibility check completed without conflicts. Live QA used the existing combined UI preview; no new upstream migrations or demo changes were applied.
