# Repository/project delegation prototype

Created 2026-09-19 with `om-mockup-prototype`. Revision 002, refreshed 2026-09-19 from [revision 001](../revision-001/README.md). No synthetic panel report was supplied.

Source: [Code repositories and the Developer agent](../../../../specs/2026-09-19-code-repositories.md), PR #16, merged main commit `aae02479b33e589007978161143bcb4fc83f158a`. The team-owned source specification remains Draft; this prototype does not promote it to an implemented or approved contract.

## Scope and preserved decisions

Actors: repository administrator, project manager, delegator. Start: Code repositories. Outcome: simulated registration, qualification, project linking/default selection and a repository-bound Developer delegation.

Preserve REQ-001 through REQ-005 and journeys J-001 through J-004. D-043 excludes editing the hosting instance; D-044 makes OM the registry authority with GitHub consent; D-045 allows many repositories per project and one per task; D-046 supports PR-only; D-047 names the agent Developer. Changes to these decisions belong to the team specification process, not prototype code.

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

Static verification passed: inline JavaScript parses with Node's `vm.Script`; no network APIs, remote assets/destinations or browser storage; only fixture data; all changes stay outside application code. Source inspection covers labels, focus styles, form submission prevention, local navigation and state handlers. This does not prove interactive behavior or responsive rendering.

Browser verification: **not-run**. The repository initially lacked `.ai/browsers/playwright.md`; the user approved the Codex browser fallback. Its URL policy rejected the local file navigation and explicitly prohibited indirect workarounds. No prototype page was loaded, no interactions were exercised and no screenshots were produced. Correction to revision 001: tab closure was not confirmed. The close operation returned "Tab 3 is not part of browser session". Cleanup status is unavailable/stale; the earlier success claim was incorrect. This revision opened no browser session. Later, at the user's request, the official upstream descriptor was copied into the repository unchanged; that addition is not browser evidence and does not lift the session's policy restriction.

All 12 walkthrough steps above remain unexecuted in a browser. Open `index.html` manually in a browser and follow this checklist; record real results before marking verification passed. No server or dependency installation is required for this standalone artifact. A prototype approval does not establish user demand, production readiness or backend security.

## Descriptor provenance

`.ai/browsers/playwright.md` is an exact copy of `skills/om-setup-agent-pipeline/references/browsers/playwright.md` from `open-mercato/skills` commit `7c81ffe68d99a9263143110c150e903d910f7526`, SHA-256 `c9c1fded256173e110d015b3af93931f9fe0fcf4f30b8203a34e65b3d52b91b8`. All eight required operations are present. The repository config defaults to this provider. No installation, browser doctor or provider switch was performed to bypass the blocked navigation.

## Refresh changes and static acceptance

The prior ownership manifest and both recorded file hashes matched before refresh. Revision 001 and the official browser descriptor are preserved byte for byte. This revision corrects the closure claim in its own context; it does not rewrite historical evidence. The original exclusions A1-A5 remain in force. The team owns D-043 through D-047; changes require that team's specification decision, not a prototype edit.

| Source defect | Revision 002 correction | Browser verification |
|---|---|---|
| Build edits disappeared after save; even an unchanged save invalidated qualification | Keep the entered command in the in-memory repository; increment its epoch only when the command changes | Not run |
| A second save bypassed the simulated conflict | Keep rejecting writes until Reload latest values or an explicit test-state reset | Not run |
| Delegation claimed a frozen version but stored only the repository ID | Capture the epoch; show it and refuse simulated publication after a profile change, including after re-qualification | Not run |
| Loading left aria-busy on denied/error screens | Clear busy state before rendering each screen | Not run |
| Reopening Connect offered an already registered repository | Show an empty-grant recovery state | Not run |
| Disable dialog lacked an accessible name and Cmd/Ctrl+Enter action | Name the dialog and route the shortcut to its confirmation before background forms | Not run |

Additional manual checks: save a changed build command and revisit detail; save unchanged and confirm qualification does not change; attempt two saves after conflict and confirm both are refused; reload and retry; delegate, edit that repository's build command, re-qualify, then confirm the old delegation still reports unavailable. These are expected outcomes from source review, not observed browser results.

The prototype models an epoch but does not calculate a production profile digest, enforce authorization, or implement the broker. Those remain production contracts. No executable behavior test was run; only source inspection and JavaScript parsing are eligible under the inherited browser restriction. A DOM emulator or alternative transport was not used.

## Implementation readiness and team coordination

Fresh GitHub read-back on 2026-09-19: PR #16 is merged into `aae0247`; PR #20 is merged into `2a894ef` and renames `tasks` to `task_delegation`, including delegation commands, setup, subscriber, sidebar and tests. The registry specification still names the old module. Reconcile the registry specification against that merged change before implementation; do not duplicate the module rename.

| Requested item / phase | Current disposition | Required next evidence |
|---|---|---|
| Offline J-001 through J-004 prototype | Revised source; browser acceptance not-run | Authorized browser-policy change, then the checklist above |
| Phase 1, Developer compatibility rename (REQ-006) | Not started: covering spec remains Draft | Team readiness decision and reconciled task module surface; TEST-010 and seed/delegation exit gate |
| Phase 2, repository registry/connect (REQ-001, 002, 005) | Not started; fake broker is permitted by the design but does not waive Draft gate | Ready spec and verified Phase 1; local fake-broker implementation and full phase validation |
| Phase 3, links and frozen delegation (REQ-003, 004, 005) | Depends on verified Phase 2 | Registry, broker usability contract, reconciled delegation module and integration evidence |
| Phase 4, live website target | Blocked by prior phases and qualified broker | Qualified broker and separate live configuration authority |

The local `om-implement-spec` reference `references/phases-and-gates.md` requires `Ready for implementation`, not `Draft`. Merge of a specification is not that status transition. This task does not promote the spec, modify application source, apply migrations, configure providers, run paid inference, or deploy.

Two specification inconsistencies need a team correction before readiness: the reuse/rollout prose says two delegation columns while the data model and compatibility table list three; the task module names must be reconciled with merged PR #20. The broker prerequisite remains an explicit external dependency even after the Draft gate is resolved.

## Verification record (2026-09-19)

Runner: local, Node v26.7.0. This is a standalone HTML parse check, not the app's pinned runtime validation.

- `new vm.Script(inlineScript)`: passed for revisions 001 and 002; no script execution.
- Source inspection plus a scan for network APIs, external HTML destinations, dynamic imports, cookies and browser storage: passed for the selected offline surface. This is not a security certification.
- SHA-256 ownership inventory: passed for both revisions; all original revision hashes and the descriptor hash still match the handoff.
- `git diff --no-index --check <revision-001> <revision-002>`: passed, exit 0.
- Application typecheck, build, tests, migrations, UI interactions, responsive layout, keyboard behavior and screenshots: not run.
- Upstream prototype skill source: `open-mercato/skills` commit `7c81ffe68d99a9263143110c150e903d910f7526`; no installed skills changed.

Publication preparation uses main `2a894ef` as its base. Only the standalone prototype revisions and the official browser descriptor are included; application source is unchanged. Independent source review returned PASS, with browser behavior explicitly unverified. Revision 001 is historical; its tab-closure claim is superseded by the correction in this revision.
