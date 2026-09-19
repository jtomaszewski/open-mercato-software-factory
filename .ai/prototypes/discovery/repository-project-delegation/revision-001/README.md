# Repository/project delegation prototype

Created 2026-09-19 with `om-mockup-prototype`. Revision 001; no previous revision and no synthetic panel report.

Source: [Code repositories and the Developer agent](../../../../specs/2026-09-19-code-repositories.md), PR #16, source commit `3207acb1553265b29d414410186dd061387f25af`. The team-owned source specification remains Draft; this prototype does not promote it to an implemented or approved contract.

## Scope and preserved decisions

Actors: repository administrator, project manager, delegator. Start: Code repositories. Outcome: simulated registration, qualification, project linking/default selection and a repository-bound Developer delegation.

Preserve REQ-001 through REQ-004 and journeys J-001 through J-004. D-043 excludes editing the hosting instance; D-044 makes OM the registry authority with GitHub consent; D-045 allows many repositories per project and one per task; D-046 supports PR-only; D-047 names the agent Developer. Changes to these decisions belong to the team specification process, not prototype code.

The project default is evaluated at delegation, according to PR #16. This deliberately does not adopt the separate local draft's create-time task binding. Unqualified repositories can be linked but are not delegation options. Disabling/unlinking a repository blocks subsequent publication; the accepted delegation retains its identity. No credentials, provider calls, real GitHub redirects, source edits, runner, merge or deployment exist here.

## Assumptions and limits

- [ASSUMPTION A1] All `demo-company` records and users are fictitious, in-memory fixtures. Reset restores the baseline; refresh discards edits.
- [ASSUMPTION A2] Role switching is represented by the explicit Test state control. This is a permission-state mock, not authentication or authorization enforcement.
- [ASSUMPTION A3] GitHub consent and qualification use explicit simulation buttons. Their production implementation remains blocked by the broker prerequisites in the spec.
- [ASSUMPTION A4] Build command editing demonstrates qualification invalidation only; full profile editing, connection expiry/installation conflicts, deletion, search/pagination and production audit are outside this selected walkthrough. These omissions do not remove them from the spec.
- [ASSUMPTION A5] Neutral English wireframes follow the source UI terminology. This is not a production component implementation or visual design approval.

## Screen and state map / manual walkthrough

| Step | Action | Expected outcome | Source |
|---|---|---|---|
| 1 | Open index.html | Three repository fixtures with qualification and project links | J-001 |
| 2 | Connect GitHub; simulate consent; submit without a selection | Accessible validation; no repository added | J-001, A3 |
| 3 | Select shop; register; complete simulated qualification | New repository becomes Qualified | J-001, A3 |
| 4 | Project; choose linked repositories; choose an unlinked default and save | Validation, input retained | J-002, D-045 |
| 5 | Link default and save; open Task | Qualified default preselected | J-002/J-003 |
| 6 | Link two qualified repositories with no default; open Task | Explicit selection required | J-003 |
| 7 | Delegate | Frozen repository shown; no real process started | J-003 |
| 8 | Disable the delegated repository; inspect Task | Publication-unavailable message; historical binding retained | J-004 |
| 9 | Enable and re-qualify | Stale -> Qualifying -> Qualified | REQ-002 |
| 10 | Test state: empty/loading/denied/failure/conflict | Distinct state and recovery action; conflict requires reload | UI contract |
| 11 | Back/forward, unknown fragment, reset | Correct screen/recovery; reset removes simulated outcomes | A1 |
| 12 | Keyboard, dialog Escape, Ctrl/Cmd+Enter, narrow viewport | Visible focus and usable layout/actions | UI contract |

## Verification

Static verification passed: inline JavaScript parses with Node's `vm.Script`; no network APIs, remote assets/destinations or browser storage; only fixture data; all changes stay outside application code. Manual source inspection covers labels, focus styles, form submission prevention, local navigation and state handlers. This does not prove interactive behavior or responsive rendering.

Browser verification: **not-run**. The repository initially lacked `.ai/browsers/playwright.md`; the user approved the Codex browser fallback. Its URL policy rejected the local file navigation and explicitly prohibited indirect workarounds. No prototype page was loaded, no interactions were exercised and no screenshots were produced. The temporary tab was closed. Later, at the user's request, the official upstream descriptor was copied into the repository unchanged; that addition is not browser evidence and does not lift the session's policy restriction.

All 12 walkthrough steps above remain unexecuted in a browser. Open `index.html` manually in a browser and follow this checklist; record real results before marking verification passed. No server or dependency installation is required for this standalone artifact. A prototype approval does not establish user demand, production readiness or backend security.

## Descriptor provenance

`.ai/browsers/playwright.md` is an exact copy of `skills/om-setup-agent-pipeline/references/browsers/playwright.md` from `open-mercato/skills` commit `7c81ffe68d99a9263143110c150e903d910f7526`, SHA-256 `c9c1fded256173e110d015b3af93931f9fe0fcf4f30b8203a34e65b3d52b91b8`. All eight required operations are present. The repository config defaults to this provider. No installation, browser doctor or provider switch was performed to bypass the blocked navigation.
