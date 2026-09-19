# Execution plan — one run-status bar in the task drawer and one state chip on the board card

Engine: om-auto-create-pr (steps: 14, --loop: no)
Source doc: `.ai/prototypes/discovery/task-drawer/revision-001/README.md` (decisions + copy) and
`index.html` (behaviour). Hackathon demo; the user waived the feature spec explicitly.

## Goal

The business owner of the demo company opens a delegated task and understands its state, and the
one thing to do about it, from a single bar under the "Assigned to" picker — in Polish, with no
raw i18n keys and no staff time-tracking chrome that does not concern them.

## Scope

1. A `task_delegation` status-bar widget in `detail:staff:staff_time_task:header`, one widget for
   every run state: `starting`, `stalled`, `running`, `awaiting_decision`, `complete` (ready to
   approve) / published, `failed` (configuration vs. agent), `rejected`, and no agent at all.
   Copy from the prototype README, Polish and English, keys in `task_delegation` i18n.
2. `factory.injection.task-approve` and `task_delegation.injection.task-delegate-sidebar` leave the
   `:sidebar` slot. The sidebar widget is deleted (the status bar covers what it showed); the
   factory panel moves to the header and folds PR link, checks and the per-file diff under a
   collapsed "Szczegóły techniczne", keeping "Podgląd" and "Zatwierdź i opublikuj" in the open.
3. The board card's run badge becomes one Polish phrase ("Pracuje · 12 min", "Czeka na decyzję",
   "Do zatwierdzenia", "Nie udało się", "Opublikowane").
4. Staff chrome that does not concern the owner — time entries, logged minutes, timer / add-time
   buttons, tags, the empty subtasks state — is hidden by the same injected-`<style>`-by-`data-testid`
   mechanism that already hides `task-drawer-assignee-select`, with the brittleness stated in code
   and pinned by a tripwire test.
5. Kept: comments, the timeline, and the status select disabled while a process owns the task.

### Non-goals

- Inline plan approve/reject in the drawer (A-1 in the prototype): `awaiting_decision` keeps the
  Caseload link only.
- "Poproś o poprawki" (A-2), a drawer of our own, and task creation.
- No new API route, no entity change, no migration.

## Contract-surface note (read `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`)

| Surface | Change | Classification |
|---|---|---|
| `GET /api/task_delegation/delegations` item shape | `delegation.startedAt` added (ISO, the delegation's `createdAt`) so the card chip can say "· 12 min" | ✓ ADDITIVE — new optional field, no request change |
| `task_delegation.injection.task-delegate-sidebar` | Widget removed | App-owned widget id in this private app; no downstream consumer, its content moves into the status bar's "Szczegóły techniczne" |
| `detail:staff:staff_time_task:sidebar` | No longer contributed to by either app module | Host spot untouched; a spot with no contribution renders nothing |
| Entities, migrations, API routes, event ids, ACL features, DI names, CLI | No change | ✓ n/a |

## Risks

- The run state is derived from the orchestrator's process status; `failed` carries only a free-text
  `closeReason`, so configuration-vs-agent is a documented client-side heuristic, not a stored kind.
- Hiding staff chrome by `data-testid` is brittle by construction; tripwire unit tests fail the
  build when the selectors stop matching staff's markup.

## Progress

PR: #36

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Run-state copy and read model

- [x] 1.1 Add the additive `startedAt` field to the delegation read item — 2ea289d
- [x] 1.2 Add the Polish and English status-bar, chip and technical-details strings — 2ea289d
- [x] 1.3 Add the pure run-state presentation module and its unit tests — 2ea289d

### Phase 2: The status bar

- [x] 2.1 Add the status-bar injection widget in the drawer header spot — 435268d
- [x] 2.2 Wire its actions: delegate, retry, take over, Caseload, permission copy — 435268d
- [x] 2.3 Cover every state with widget tests — 435268d

### Phase 3: Slot rearrangement

- [x] 3.1 Delete the delegate sidebar widget and its slot entry — fe1a11d
- [x] 3.2 Move the factory approve panel to the header and collapse its technical detail — fe1a11d
- [x] 3.3 Cover the moved panel with tests — fe1a11d

### Phase 4: Board card and staff chrome

- [x] 4.1 Make the card badge one Polish phrase with the running elapsed time — befb3c4
- [x] 4.2 Hide the owner-irrelevant staff chrome on the drawer and the card — befb3c4
- [x] 4.3 Pin the hidden selectors with tripwire tests — befb3c4

### Phase 5: Validation and evidence

- [x] 5.1 Run the full validation gate — green after merging main (generate, typecheck, lint, ds:check, test, build)
- [x] 5.2 Capture a screenshot of every run state and attach them to the PR — 5b055ac (11/11 in a real browser)

## How the screenshot blocker was resolved

Both routes to a signed-in browser were blocked at first, and neither was this change's fault:

1. The worktree database `milan_v1` is an **old clone of the Conductor template**, made before the
   template was seeded with `superadmin@acme.com`. Its only login account is `admin@local.test`,
   whose password nobody has. Encryption keys and the lookup pepper are fine — the account simply
   is not there. `yarn initialize` refuses to add it ("found 3 existing user(s)") and only
   `--reinstall` would, which wipes the database.
2. The ephemeral harness seeds its own throwaway database correctly, but refused to boot: it runs
   in production mode and `auth.jwt` rejects `.env`'s published placeholder `JWT_SECRET`. The
   harness has its own safe default (`om-ephemeral-integration-jwt-secret`) which `.env` shadows,
   because dotenv fills `process.env` before the harness reads it.

Route 2 was taken, passing the harness its own documented value. Two further environment facts cost
time and are worth knowing: repeated failed logins trip an in-memory auth rate limiter (429 that
looks like a credential problem until the server restarts), and a raw `page.request` call to a
scoped API answers 401 because the app's client adds organization-scope headers — so the spec reads
the task id from the rendered board instead.
