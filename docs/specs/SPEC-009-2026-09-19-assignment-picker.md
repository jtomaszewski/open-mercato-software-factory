# SPEC-009: Assigned to: one picker for a person and an agent

**Status**: Draft
**Owner**: HackOn team · **Date**: 2026-09-19 · **Tracker**: —
**Parent**: [SPEC-002](./SPEC-002-2026-09-18-tasks-module.md), whose delegate command, delegation
table and injected widgets this spec builds on and partly replaces.
[SPEC-008](./SPEC-008-2026-09-19-software-engineer-rename.md) renames the agent this picker lists;
neither spec blocks the other. Names throughout follow the `task_delegation` module id the
`tasks` module was renamed to in #20; the picker's own label comes from the roster, not from
SPEC-008's rename.

## TLDR

Who owns a task is `staff`'s assignee `Select` in the drawer's Properties section; who does the
work is our "Agent delegate" section further down, with its own `Select` and its own button.
Handing a task to a colleague *and* to the Software Engineer is two interactions, two round trips
and two audit entries, and neither can be done from the card.

They become **one "Assigned to" picker**: a searchable popover with *People* and *Agents*,
opened by click or `A`, that takes a person, a person **and** an agent, or an agent alone, and
persists whatever it produced through one audited, undoable command. The human stays
accountable — picking an agent alone still records the picker's user as the assignee, and says so
before it happens rather than silently afterwards.

Which agents are pickable comes from an app-owned **roster**: a role, its copy, and the process
its delegation starts. v1 has one row (Software Engineer → `factory.deliver`), so nothing about
today's behaviour changes; the roster is how the second role arrives later.

## Problem Statement

- **Assignment is the act people repeat most, and it costs two of everything.** Two controls in
  two places in the drawer, two requests, two audit entries, two things to undo. In Linear the
  same act is one control, one keystroke, one list — and that is the bar for a board people are
  supposed to live in all day.
- **The card cannot assign at all.** Every assignment means opening the drawer, which is the
  slowest path on the busiest screen.
- **The rules are discovered by failing.** Delegation is allowed only from `backlog`, removal
  after the sizing decision is refused, and an actor without a staff member cannot delegate. The
  current UI offers the action and lets the server answer with a `409` or a `422`; the picker
  should show why something is not available before it is clicked.
- **The agent list is whatever happens to be provisioned.** `GET /api/task_delegation/agents` returns every
  enabled agent principal in the organization, while exactly one of them has a process behind it.
  Anything else in that list is an offer we cannot honour.

## User Stories

- **Product owner** opens `WEB-12`, presses `A`, types "an", and sees *People* (Ola Nowak, Anna
  Kot) and *Agents* (Software Engineer). They pick Ola **and** Software Engineer, confirm once,
  and the card moves to `Queued` with Ola's avatar and the agent badge showing the run state.
- **Product owner** picks only the Software Engineer. Before confirming, the picker states that
  they will be recorded as the accountable owner; after confirming their avatar is on the card
  next to the agent, exactly as the command has always behaved.
- **Team lead without `task_delegation.delegate`** opens the same picker and sees only *People*, with one
  line explaining that delegating needs the permission — the control never half-works.
- **Product owner** assigns straight from the board card without opening the drawer, and it is
  one command, one audit entry, one undo.
- **Anyone** opening a task whose run is live sees the *Agents* half read-only: the role, the run
  state, one sentence for why it is locked, and *Remove delegate* as the only way out. After the
  sizing decision, that sentence points at the Caseload instead.
- **Whoever adds the next role** provisions its principal, enables its process and adds one
  roster row with two i18n keys; the picker lists it the next time it loads.

## Proposed Solution

One component, one command, one roster:

- **`AssignedToPicker`** — a searchable popover with two sections, opened by click or `A`,
  navigable by arrows, applied with `Enter`, closed with `Esc`. Its value is the pair
  `{ assigneeStaffMemberId, agentUserId }`. A section the caller may not use is hidden rather
  than disabled.
- **`task_delegation.task.assign`** — one command behind `POST /api/task_delegation/assignments` that applies the
  human half through `staff`'s own task update and the agent half through the existing delegation
  path, under one optimistic-lock check, one audit entry and one undo. `staff` 0.8.0 commits each
  of its own commands separately, so the two halves are not one transaction: they are ordered —
  assignee first, delegation second — and a failing delegation compensates the assignee write
  back, the same discipline `task_delegation.task.delegate` already runs.
- **The roster** — `task_delegation/lib/agentRoster.ts`, the list of roles a person may delegate to and the
  process each one starts. It replaces "every provisioned principal" as the source of the
  *Agents* section.

Everything underneath stays: `task_delegations`, `task_delegation.task.delegated` /
`task_delegation.task.undelegated`, `task_delegation.view` / `task_delegation.delegate`, the transition guard and the existing
error codes. The old delegation endpoints remain for the MCP tools and scripts.

### Alternatives considered

- **Widen our sidebar section and leave `staff`'s field alone** — cheapest and needs nothing from
  the framework, but the drawer keeps two ways to set an owner and they drift apart.
- **Our own cross-project board** — full control of card, drawer and picker, but it forks the
  board `staff` maintains for us, and SPEC-002 parked it as "later" for good reasons.
- **Put the agent in the assignee slot** (Jira, Plane) — rejected with SPEC-002's reasoning: the
  accountable human disappears the moment the agent is assigned.

## Design

**Where it renders.** In the drawer through the published `detail:staff:staff_time_task:header`
injection spot; on the card through the published `staff.time_task.board:card-badges` spot, next
to the run badge this module already injects there.

The card was specified as a `staff.kanban_card` component override, and it is not implemented as
one. `staff.kanban_card` supports `wrapper`, `replace` and `props` modes: a `replace` means
re-implementing the 435 lines of `KanbanCard` — its dnd-kit draggable, timer actions, move menu
and two injection spots — which is exactly the copied component family the house rules refuse,
and it would falsify this spec's own test that the card is unchanged with the picker closed; a
`wrapper` cannot put a control inside the card's layout, only around it. The published badge spot
gives the same act (assign without opening the drawer) through a seam that survives a `staff`
upgrade. The card's own avatar stays `staff`'s, so the card shows the owner once, from the host,
and the picker trigger next to it.

**How `staff`'s own field gets out of the way.** `staff` 0.8.0 publishes ten overridable
components (`staff.kanban_card`, `staff.kanban_column`, `staff.project_card`,
`staff.time_entry_dialog`, `staff.timer_bar`, `staff.timesheet_grid|list|calendar`,
`staff.report_sheet`, `staff.entries_summary_footer`) and nine injection spots — and the drawer's
assignee `Select` is none of them. Until it is, our widget ships a scoped DOM rule
(`div:has(> [data-testid="task-drawer-assignee-select"]) { display: none }`, so the field leaves
the tab order with the layout), fenced by two tests: a unit tripwire that fails when the installed
drawer stops carrying exactly one such field, and a browser case that asserts one visible
assignment control and the hidden one unfocusable.

**What the old sidebar section keeps.** The injected "Agent delegate" section stays, minus every
control: it reports what the run produced — role, run state, close reason, links — and setting or
removing the delegate lives only in the picker, so the drawer has one assignment control and not
two.

**The roster.** One row per delegatable role:

| Field | Meaning |
|---|---|
| `agentDefinitionId` | the provisioned principal's id — `'factory'` for v1 |
| `labelKey` | i18n key for the name the picker shows (`task_delegation.agents.softwareEngineer`) |
| `descriptionKey` | one line under the name ("Researches, plans and opens a PR") |
| `processName` | the process a delegation starts — `'factory.deliver'` for v1 |

`GET /api/task_delegation/agents` returns only roster entries that have both a provisioned, enabled
principal and an enabled process definition; an entry missing its process is reported through the
existing `orchestratorUnavailable` path instead of being offered. `subscribers/start-factory.ts`
stops hard-coding the pair: it looks the entry up by `payload.agentId` and starts that entry's
`processName`, returning early for an id outside the roster — which is today's behaviour for the
one row that exists.

**Two names, one truth.** Our surfaces render the roster's `labelKey`; every surface we do not own
— audit, `staff`, notifications, MCP — reads the principal's `auth.User.name`, which SPEC-008
renames. A new role is one roster row and two i18n keys, not a database change.

**States.** Loading (skeleton in both sections), empty search, no agents in the roster, no
`task_delegation.delegate` (no *Agents* section, one line of explanation), the confirm line "You will be
recorded as the accountable owner" when an agent is picked with no human, a live run (the
*Agents* half read-only with *Remove delegate*), the sizing decision taken (the same, pointing at
the Caseload), a stale version (`409`, offer to reload), and the orchestrator absent (the *Agents*
section empty with today's message, the *People* half still working).

**Keyboard and a11y.** `A` opens the picker in the drawer, typing filters, `↑/↓` moves, `Space`
takes the highlighted option into the draft, `Enter` assigns the draft, `Esc` closes. The split
between `Space` and `Enter` is what makes "a person **and** an agent, confirmed once" reachable
from the keyboard: one key that both selected and wrote could only ever assign one half. The
trigger is a button whose accessible name is the current value; section headers are real headings;
the confirm line and every error are announced. Copy is localized under `task_delegation.assign.*`;
status colours come from the shared UI tokens.

## Data Models

No schema change. `task_delegations` (`task_id`, `delegate_user_id`, `assignee_user_id`,
`delegated_by`, `released_at`, `outcome`, `agent_id`) already carries everything the picker
reads, and the human assignee stays `staff`'s `assigneeStaffMemberId`. The roster is code, not
data, so a role cannot be half-created by an operator.

## API Contracts

| Surface | Shape |
|---|---|
| `POST /api/task_delegation/assignments` (new) | `{ taskId, assigneeStaffMemberId?: string \| null, agentUserId?: string \| null }` with the `If-Match` optimistic-lock header. `200 { taskId, assigneeStaffMemberId, delegation }`. Errors reuse today's codes: `403` (feature or project access), `409 invalid_transition` (`backlogOnly`, `alreadyDelegated`, `decisionPending`), `409` stale version, `422 assignee_required`, `422 invalid_agent`, `503 orchestrator_unavailable` |
| `GET /api/task_delegation/agents` | additive: `{ items: [{ userId, agentId, name, label, description }] }`, filtered to roster entries with a provisioned principal and an enabled process. `name` stays the principal's name; `label` is what our surfaces render |
| `GET /api/task_delegation/assignable-people?taskId=` (new) | `{ items: [{ staffMemberId, name, userId }] }` — the people the caller may assign on the task, so the *People* section does not read a `staff` internal. `staff` offers every **active team member** on its own assignee field and gates the task by project access, so this route gates the same way (`403 project_forbidden`) and returns the same population; project membership in `staff` decides who may *manage* a project, not who may be assigned |
| `GET /api/task_delegation/delegations` | additive: each item gains `assigneeStaffMemberId` and `assigneeName`, so the picker's trigger names the current owner without a second read. The `delegation` object is unchanged |
| `POST /api/task_delegation/delegations`, `DELETE /api/task_delegation/delegations/{taskId}` | unchanged, kept for the MCP tools, scripts and the picker's *Remove delegate* |

Commands: `task_delegation.task.assign`, audited and undoable — undo restores the previous assignee and
un-delegates, reusing the `beforeUndo` guard that refuses after the sizing decision.

## Implementation Approach

Each step leaves the app working and ends with its own test.

**Phase 1: the roster and the command** (nothing visible changes yet)

1. `task_delegation/lib/agentRoster.ts` with the v1 row and its two i18n keys; `GET /api/task_delegation/agents`
   filtered to roster entries with a provisioned principal and an enabled process, returning
   `label` and `description` alongside today's fields. *Tests:* an unrostered principal is not
   returned; a roster entry whose process is disabled is not returned; the existing fields keep
   their shape.
2. `subscribers/start-factory.ts` resolves the roster entry by `payload.agentId` and starts its
   `processName`. *Tests:* the existing suite passes unchanged; an event with an unrostered
   `agentId` starts nothing.
3. `GET /api/task_delegation/assignable-people`, scoped and ACL-checked like the agents route. *Tests:*
   only the caller's project members; `403` without project access.
4. The `task_delegation.task.assign` command and `POST /api/task_delegation/assignments`. *Tests:* person only; agent
   only (the actor becomes assignee); both; a stale version returns `409`; a failing delegation
   rolls the assignee change back; undo restores the assignee and un-delegates; the ACL matrix.

**Phase 2: the picker**

5. `AssignedToPicker` with both sections, search, keyboard and every state from *Design*,
   including the read-only agent half. *Tests:* one per state; keyboard and screen-reader
   assertions; the locked state offers only *Remove delegate*.
6. The card, through the `staff.kanban_card` override, keeping avatar, agent chip and run badge.
   *Test:* the card is unchanged with the picker closed; assigning from it issues one command.
7. The drawer: the picker in `detail:staff:staff_time_task:header` plus the scoped rule that
   hides `staff`'s assignee field. *Test:* integration — exactly one assignment control is
   visible and the hidden field is not focusable.
8. Refresh on `task_delegation.task.delegated`, `task_delegation.task.undelegated` and
   `staff.timesheets.time_task.status_changed`, as today's widgets do. *Test:* integration —
   assigning in one tab moves the card in another.

Validation per phase: `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn
test`; `yarn test:integration:ephemeral` after steps 7 and 8.

## Key Design Decisions

1. **The human keeps ownership.** Linear's split — the agent is a delegate, the assignee stays
   accountable — is what SPEC-002 already enforces; the picker makes the implicit assignment
   explicit *before* it happens instead of leaving it to be discovered in the audit log.
2. **One command, not two calls from the client.** "Assign" is one act to the person doing it, so
   it is one thing to audit, one thing to undo and one thing to fail atomically.
3. **The roster decides what is pickable, not the principal table.** A delegatable role is a role
   with a process behind it; keeping the pair in one file means a new role cannot be half-added.
4. **Today's rules stay, and become visible.** Delegation from `backlog` only, removal refused
   after the sizing decision: the picker renders them instead of letting the server answer.
5. **The drawer is taken over with the bluntest tool that works.** A scoped DOM rule plus a
   tripwire test, because the alternatives were shipping two assignment controls or waiting on a
   framework release. It is the one place this spec depends on `staff`'s internals, and it is
   fenced by a test.

## Open Questions

- **Will `staff` publish a seam for the drawer's assignee field?** Ask the Open Mercato
  maintainers, and offer the override upstream (`staff.task_assignee_field`, mirroring
  `staff.kanban_card`). When it lands, step 7's DOM rule is replaced and the tripwire test stays.
  Until then the rule ships.
- **Does anything else still write the assignee behind the picker?** The hidden field is hidden,
  not removed, and `staff`'s own API remains open. Confirm in Phase 2, step 7 whether any other
  installed surface renders the same form; if one does, decide then whether to guard the write or
  accept it as an alternative path.
- **When the roster gets its second role, does the picker need grouping?** Two or three roles fit
  a flat list; more than that wants sections or search-by-capability. Resolves when the second
  role is real, not before.

## Implementation Status

Source doc: `docs/specs/SPEC-009-2026-09-19-assignment-picker.md`

Acceptance IDs are the numbered steps of *Implementation Approach*: AC-1 roster and agents route,
AC-2 roster-driven `start-factory`, AC-3 assignable people, AC-4 the assign command and its route,
AC-5 the picker, AC-6 the card, AC-7 the drawer takeover, AC-8 cross-surface refresh.

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 1 — the roster and the command | verified | none | AC-1…AC-4 | `yarn jest src/modules/task_delegation` | `POST /api/task_delegation/assignments` assigns a person, an agent, or both under one audited undoable command; nothing visible changes |
| Phase 2 — the picker | verified | Phase 1 | AC-5…AC-8 | `yarn jest src/modules/task_delegation` + `yarn test:integration:ephemeral` | one "Assigned to" control on the card and in the drawer; `staff`'s own field is neither visible nor focusable |

### Phase 1 progress

- [x] AC-1 roster + agents route: `lib/agentRoster.ts` (new), `lib/delegationService.ts` (`listAgents` filters principals by roster and by a startable `ProcessDefinition`, returns `label`/`description`), `api/agents/route.ts` (openApi), `i18n/en.json` (two keys); tests cover the offered row, an unrostered principal, a missing process and a non-manual process — `yarn jest src/modules/task_delegation/lib` passed (8 suites, 22 tests)
- [x] AC-2 roster-driven start: `subscribers/start-factory.ts` looks the row up by `payload.agentId` and starts its `processName`, returning early for an id outside the roster; `subscribers/__tests__/start-factory.test.ts` adds the roster-lookup assertion and keeps the five existing cases — `yarn jest src/modules/task_delegation/subscribers` passed (2 suites, 11 tests)
- [x] AC-3 assignable people: `api/assignable-people/route.ts` (new, `task_delegation.view`), `lib/delegationService.ts` (`listAssignablePeople`, project access extracted into one `resolveAccess` used by `getDelegations` too); tests cover the listed members and `403 project_forbidden` — `yarn jest src/modules/task_delegation` passed (23 suites, 87 tests), `yarn generate` + `yarn typecheck` clean
- [x] AC-4 the assign command: `commands/tasks.ts` (`task_delegation.task.assign`, ordered halves with assignee compensation, audited, undoable through `undelegate` + assignee restore), `data/validators.ts` (`assignInputSchema`/`assignSchema`), `commands/types.ts`, `api/assignments/route.ts` (new), `i18n/en.json`; `commands/__tests__/assign-flow.test.ts` (11 cases: person only, agent only with the actor as owner, both, compensation, stale `409`, cleared assignee `422`, the ACL matrix, undo both halves) and `api/__tests__/assignments.test.ts` (7 cases incl. the guard rewrite refusal and the response projection) — `yarn jest src/modules/task_delegation` passed (25 suites, 105 tests)
- [x] Phase 1 gate: `yarn generate`, `yarn typecheck`, `yarn lint` (0 errors, 10 pre-existing warnings, none in changed files), `yarn ds:check` (292 files), `yarn test` (31 suites, 174 tests) all passed

### Phase 2 progress

- [x] AC-5 the picker: `components/AssignedToPicker.tsx` (new, shared `Popover`/`SearchInput`/`Avatar`/`Skeleton`/`StatusBadge`/`Button` primitives, no raw fetch), `lib/delegationService.ts` (`getDelegations` additively returns `assigneeStaffMemberId`/`assigneeName`), `i18n/en.json` (15 keys); `components/__tests__/AssignedToPicker.test.tsx` covers the trigger's accessible name, both halves in one command, the accountable-owner line, the hidden *Agents* section without the permission, the locked run, the Caseload pointer, the `409` reload, empty search, arrows/Space/Enter, `A`, and the failed read — `yarn jest src/modules/task_delegation` passed (27 suites, 118 tests)
- [x] AC-6 the card: `widgets/injection/task-assigned-to-card/*` in the published `staff.time_task.board:card-badges` spot (priority 40, ahead of the run badge), `widgets/injection-table.ts`; the card's own markup is untouched, so it is unchanged with the picker closed. Implemented through the badge spot rather than a `staff.kanban_card` override — see *Design*
- [x] AC-7 the drawer: `widgets/injection/task-assigned-to/*` in `detail:staff:staff_time_task:header` with the scoped rule, and `widgets/injection/task-delegate-sidebar/widget.client.tsx` trimmed to run output only; `widgets/__tests__/drawer-takeover.test.tsx` pins the installed drawer's single assignee field and the rule that hides it, `.ai/qa/tests/task_delegation/TC-TASK-DELEGATION-003.spec.ts` asserts one visible control and the hidden one unfocusable
- [x] AC-8 refresh: the picker announces `staff.timesheets.time_task.status_changed` after both writes and reads through `use-task-delegation`, which already subscribes to `task_delegation.task.*`, `staff.timesheets.time_task.*` and the orchestrator events; `widgets/__tests__/live-delegation.test.tsx` covers the refresh path
- [x] Review pass: `assignable-people` also requires `staff.view`, because the population it returns is `staff`'s team directory and that route must not widen who may enumerate it; undo now announces `task_delegation.task.changed` symmetrically; a compensation that fails is logged instead of masking the delegation error; `Space` no longer swallows a space typed in the search field; a failed agents read reports itself instead of claiming there is no agent. Each has its own test
- [x] Phase 2 gate: `yarn generate`, `yarn typecheck`, `yarn lint` (0 errors), `yarn ds:check` (297 files), `yarn test` (33 suites, 190 tests), `yarn build` all passed; `yarn test:integration:ephemeral TC-TASK-DELEGATION --no-reuse-env` ran TC-001 and TC-002 green and **skipped TC-003**, whose drawer assertions need one staff task — a bare ephemeral database has none. Run it against a seeded environment (`yarn mercato task_delegation seed-demo`) to close that gap; the unit tripwire covers the selector meanwhile

## Changelog

<!-- Record, not state: rows are closed once dated — append, never rewrite. -->

| Date | Change |
|------|--------|
| 2026-09-19 | Split out of the combined rename-plus-picker draft after a scope-cohesion review; this spec is the picker, the roster and the assign command, with the rename in SPEC-008. Decisions carried over: human keeps ownership, curated roster driving the process, today's mid-run rules kept, drawer taken over via the header injection spot plus a scoped DOM rule. |
| 2026-09-19 | Names realigned to the `task_delegation` module id (#20 renamed `tasks`), and the assign command's two halves restated as ordered writes with compensation rather than one transaction, because `staff` 0.8.0 commits each of its commands separately. Implementation Status added; phases and acceptance IDs unchanged. |
| 2026-09-19 | Phase 2 as built: the card's picker renders through the published `staff.time_task.board:card-badges` spot instead of a `staff.kanban_card` override (a `replace` would copy 435 lines of `KanbanCard` and falsify this spec's own "card unchanged" test); the drawer's old delegate section keeps the run's output and loses its controls; `Space` selects and `Enter` assigns, so picking a person and an agent stays one confirmation from the keyboard; the drawer tripwire is split into a unit pin of the installed markup plus the browser case. |
