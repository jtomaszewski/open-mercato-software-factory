# Repository delegation prototype

Revision 003, created 2026-09-19. Start with `index.html`. This revision follows [revision 002](../revision-002/README.md); revisions 001 and 002 are preserved unchanged. No synthetic panel report was supplied.

## Purpose and scope

A repository administrator connects and qualifies a repository, a project manager links it to DEMO, and a delegator assigns WEB-12 to Developer. The selected walkthrough covers registration, qualification, project links/defaults, delegation and disabling a repository. All records are fictional and all actions stay in memory. Reloading discards edits; Reset simulation restores the fixtures.

Source: [Code repositories and the Developer agent](../../../../specs/2026-09-19-code-repositories.md), merged in PR #16. The specification remains Draft. REQ-001 through REQ-005 and journeys J-001 through J-004 define the simulation; this artifact does not implement or approve the production contracts.

D-043 excludes editing the hosting instance. D-044 makes Open Mercato the registry authority with GitHub consent. D-045 allows several repositories per project, with one selected at delegation. D-046 supports PR-only work. D-047 names the agent Developer. These are team-owned decisions; prototype edits do not change them. A usable default is evaluated at delegation time, unqualified repositories can be linked but not delegated, and an accepted delegation retains its repository and configuration epoch.

## What changed

The previous wireframe used its own header, spacing, colours and controls. This revision uses the existing [factory-intake](../../../factory-intake/README.md) presentation:

- The sidebar groups Tasks and Projects under Work, with Code repositories under Settings. The topbar contains contextual breadcrumbs; the page and task delegation panel use the established shell structure.
- `tokens.css`, `components.css` and `screens.css` are byte-for-byte copies of factory-intake at repository commit `ad3e000`. `repositories.css` contains only the repository composition and responsive overrides. No source token or earlier prototype file was changed.
- The forms, table, buttons and qualification badges use the existing component classes. The local theme toggle selects the inherited light/dark tokens.
- Simulation controls are collapsed above the application. Only implemented destinations are interactive; global search, notifications and AI chat are omitted.
- The Unslop Ultra pass replaces broker jargon with the consequence for the delegator, removes repeated page labels and explains the project default where it is selected. Qualification, version binding, conflict reload and disable behavior are preserved.

The layout uses the same fictional Northwind Furniture organization as factory-intake. The demo-company repositories remain fictional fixtures. This is a static approximation of Open Mercato, not imported React components or a production UI.

## Assumptions and exclusions

- [ASSUMPTION A1, retained] Fixtures live in memory. No account, API, storage or agent execution is involved.
- [ASSUMPTION A2, clarified] Test state previews permission/error states; it does not authenticate a user or enforce roles.
- [ASSUMPTION A3, retained] Explicit buttons simulate GitHub consent and qualification. Production depends on the broker contracts.
- [ASSUMPTION A4, retained] Full profile editing, connection expiry/installation conflicts, deletion, search/pagination and production audit remain outside this walkthrough. The epoch illustrates frozen configuration; a production profile digest is not calculated here.
- [ASSUMPTION A5, superseded presentation] Earlier revisions used neutral wireframes. The user requested the existing factory-intake shell and styles for this revision. That request does not establish visual acceptance or production readiness.

## Manual acceptance checklist

All items below are planned checks, not observed browser results.

| Screen or state | Action and expected result |
|---|---|
| Registry | Open the page; identify repository, qualification and project link; open a detail |
| Connect | Simulate consent; submit no selection and see validation; select shop and register |
| Qualification | Complete the simulated check; the repository becomes Qualified |
| Detail | Change the build command; revisit and see the saved value; qualification becomes Stale |
| Unchanged detail | Save without editing; qualification and epoch do not change |
| Project | Try an unlinked default; input remains with an error; link it and save |
| Delegation selection | A usable default or single usable repository is selected; several usable repositories without a default require a choice |
| Accepted delegation | Delegate and see the retained repository and configuration version |
| Changed target | Disable or unlink the target, or edit its command and re-qualify; the old delegation reports that it cannot publish |
| Conflict | Select the conflict test state; two saves are refused until Reload latest values or an explicit test-state reset |
| Recovery | Empty/loading/denied/failure states have a recovery action; browser back/forward, unknown fragments and Reset work |
| Presentation | Check desktop and narrow widths, both themes, keyboard traversal, focus, dialog Escape and Cmd/Ctrl+Enter |

## Verification and limitations

Verification: **not-run** for browser acceptance. Source checks cover JavaScript parsing without execution, local asset references, unique static IDs, copied stylesheet identity, absence of network/storage APIs and manifest hashes. Independent review is limited to source. The text checker is an editorial aid, not visual evidence.

The earlier browser policy rejected the artifact and prohibited alternate tools or transports. Computer Use, another browser session, an HTTP server and DOM emulation were not used as workarounds. A user-opened tab does not establish a policy change. No screenshots or claims about observed layout, focus, keyboard behavior or theme rendering are provided.

Correction to revision 001: its statement that the temporary browser tab was closed was unsupported. The close operation returned "Tab 3 is not part of browser session"; cleanup status was unavailable/stale. Revisions 002 and 003 opened no browser session.

The official browser descriptor remains unchanged, SHA-256 `c9c1fded256173e110d015b3af93931f9fe0fcf4f30b8203a34e65b3d52b91b8`, sourced from open-mercato/skills commit `7c81ffe68d99a9263143110c150e903d910f7526`. Its presence does not lift the policy restriction.

Application implementation remains separate. PR #20 renamed tasks to task_delegation; PR #21 removed the Core/shared patches. The registry specification still needs readiness reconciliation, including stale module references and two-column prose where the data model declares three. No application source, dependency, migration, provider configuration or deployment is changed by this prototype.
