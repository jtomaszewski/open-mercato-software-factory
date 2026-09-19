# Task drawer, simplified — discovery prototype (revision 001)

Clickable, neutral, offline simulation of the staff task board and the task drawer after the
UX simplification agreed on 2026-09-19. All records are fictitious. This artifact proves that the
flow can be operated; it establishes no user demand, no research evidence and no production
readiness, and it does not satisfy the Definition of Ready.

## Sources

- Brief: none at `.ai/specs/product-brief.md`. By the user's decision (2026-09-19, Q1 of round 1)
  the brief role is played by `docs/specs/SPEC-001-2026-09-18-agentic-software-factory.md`
  (user stories, Business owner persona) and `docs/specs/SPEC-002-2026-09-18-tasks-module.md`
  (Design section, personas, storyboard).
- Related specs read for constraints: `docs/specs/SPEC-008-2026-09-19-software-engineer-rename.md`
  (agent name), `docs/specs/SPEC-009-2026-09-19-assignment-picker.md` (one "Assigned to" picker,
  person + agent pair), `.ai/specs/2026-09-19-agent-execution-and-preview.md` (Changes panel,
  preview, "Request changes").
- Previous storyboard (frozen, not a revision of this skill): `.ai/prototypes/factory-intake/`
  (SPEC-002 s1–s14). Its drawer/board frames predate the rebuild on the installed `staff` module.
- Panel report: none supplied.
- Current-state evidence: three user screenshots of `/backend/staff/time-tracking/board` (board,
  failed task drawer, complete task drawer), 2026-09-19.

## Selected flow

**Actor:** business owner of the demo company (steel tanks manufacturer), non-technical, the
task's accountable assignee. **Start:** the task board of project "Strona WWW".
**Success:** the owner understands each task's state at a glance, hands a task to the
Software Engineer agent, decides on its plan, checks the preview and publishes the change,
and recovers from a failed run, all from one place in the drawer.

Included screens/states: board (4 staff default columns), drawer for every run state
(no agent, starting, running, awaiting decision, ready to approve, published, failed by
configuration, failed by the agent, plan rejected, user without delegate permission), preview
screen, unknown-route recovery, reset. Desktop (1280) and narrow (390, via the toolbar toggle
or a real narrow viewport).

Excluded (labelled or absent): creating tasks (staff + chat/MCP intake, SPEC-007), the
orchestrator Caseload page (link is inert and announces the limit), GitHub, time tracking
(timers, logged minutes, add-time), tags, subtasks creation.

## Decisions preserved (owner: user, 2026-09-19 conversation, rounds 1–2)

| ID | Decision | Source / status |
|---|---|---|
| D-1 | Business owner is the primary persona; technical detail folded under "Szczegóły techniczne". | Round 1 Q1 (a). **Goes beyond SPEC-002**, whose primary persona is the product owner. Recorded as a proposed brief change, not a fact. |
| D-2 | Scope = drawer content + board card. | Round 1 Q2 (c). |
| D-3 | One status bar under the title, one primary action per state, plain language. | Round 1 Q3 (a). |
| D-4 | "Ready" state: preview + Zatwierdź i opublikuj + Poproś o poprawki; PR link under technical details. | Round 1 Q4 (a). Approve exists in `factory` widget; "request changes" is EX-spec only (see A-2). |
| D-5 | Configuration failures (factory not ready) and agent failures are different messages; only the latter offers retry. | Round 1 Q5; agent is named **Software Engineer** (SPEC-008), never "Fabryka". |
| D-6 | A person and an agent can be assigned at the same time (Linear-like); one picker (SPEC-009). | Round 1 Q6; SPEC-009 already implements the pair. |
| D-7 | Keep comments and timeline; subtasks only when present; hide time entries and tags. | Round 1 Q7. |
| D-8 | Board card: ref, title, person + agent chips, run state in one Polish phrase; no timer/time controls. | Round 2 Q1 (a). |
| D-9 | Awaiting decision: plan summary and decision **inline** in the drawer, Caseload as a secondary link (chosen for the hackathon demo). | Round 2 Q2, user: "do what shows better"; see A-1. |
| D-10 | Properties as one compact row (Status · Przypisane do · Projekt). | Round 2 Q3 (a). |
| D-11 | Task creation out of scope. | Round 2 Q4. |

Business rules kept from SPEC-002/009: a delegated task cannot be moved by hand while the
process owns it (status select disabled while starting/running/awaiting/complete); an agent
cannot be the only owner (picker validation); a live run only allows removing the agent;
failed/rejected/complete releases the delegation, so the task can be delegated again;
users without the delegate permission see the reason, not a disabled control.

## Assumptions

| ID | Assumption | Why needed | How to check |
|---|---|---|---|
| A-1 `[ASSUMPTION]` | The plan can be approved/rejected inline on the task (proposal summary + two buttons) instead of only in the orchestrator Caseload. | D-9, demo clarity. Today the only implemented action is a link to the Caseload. | Needs a spec decision and an API (`task_delegation` command that disposes the Caseload item). If refused, the status bar keeps the "Otwórz Caseload" link only. |
| A-2 `[ASSUMPTION]` | "Poproś o poprawki" starts a bounded new attempt on the same PR and the reason lands as a task comment. | D-4. Described in `.ai/specs/2026-09-19-agent-execution-and-preview.md` (J-EX-1), not implemented. | Confirm with the execution spec owner; otherwise hide the button. |
| A-3 `[ASSUMPTION]` | "Spróbuj ponownie" = delegate again to the same agent after failed/rejected (allowed because the delegation is released). | D-5. | Matches `delegationService` release semantics; verify the picker's re-delegate path in code. |
| A-4 `[ASSUMPTION]` | "Przejmij zadanie" = remove the agent and move the task to Backlog, keeping the person. | D-5/D-7. SPEC-002 "Remove delegate" + `outcome.closedByAssignee`. | Verify the command moves the column the same way. |
| A-5 `[ASSUMPTION]` | Hiding time entries, timer buttons, logged minutes and tags on staff's card/drawer is feasible (override or injected CSS on staff markup, like the existing assignee-select hide). | D-7/D-8. | Architecture decision for implementation (UMES vs own drawer); not settled here. |
| A-6 `[ASSUMPTION]` | The task has a description field shown in the drawer. | Storyboard shows one; staff drawer section list in code did not surface it. | Check `TaskDrawer.tsx` / task entity. |
| A-7 `[ASSUMPTION]` | Automated checks summary ("wszystko przeszło") and change scope (files, +/−) are enough technical detail for the owner; per-file diff stays out of the default view. | D-1. | Synthetic panel or real walkthrough with the demo owner. |
| A-8 `[ASSUMPTION]` | Simulated timings: starting→running after 1.5 s, building→ready after 2.5 s. | Reviewer reaches outcomes without waiting. | N/A, simulation only. |

Fixed run-state vocabulary (Polish): Startuje · Pracuje · Czeka na decyzję · Do zatwierdzenia ·
Opublikowane · Nie udało się · Odrzucone. The real `pl.json` written alongside this revision
uses "Gotowe" for `complete`; the prototype's "Do zatwierdzenia" is the proposed replacement
(the state means "ready for your approval", not "done").

## Screen/state map

| From | Action | Expected | IDs |
|---|---|---|---|
| Board | click card | drawer opens, focus on title, URL `#task/<ref>` | D-2 |
| Drawer, no agent | "Przekaż agentowi Software Engineer" | starting → running; column W toku; card chip "Pracuje" | D-3, A-8 |
| Drawer, no agent, factory not ready (toolbar) | same | "Fabryka nie jest gotowa", stays Backlog, only "Przejmij zadanie" | D-5 |
| Drawer, no agent, no permission (toolbar) | — | explanation, no primary button; picker shows note instead of Agents | SPEC-009 |
| Drawer | "Przypisane do" | picker: people radio + agent checkbox, search, Enter applies, Esc closes and returns focus | D-6 |
| Drawer, running | picker | agent checkbox read-only with note; "Przejmij zadanie" available | SPEC-009 |
| Drawer, awaiting decision | "Zatwierdź plan" | running → ready to approve with change section | A-1 |
| Drawer, awaiting decision | "Odrzuć" → empty → "Wyślij" | inline error, focus stays | A-1 |
| Drawer, awaiting decision | "Odrzuć" → reason → "Wyślij" | "Plan odrzucony", Backlog, retry/take over | A-1, A-3 |
| Drawer, ready | "Podgląd strony" | preview screen, focus on heading, back link | D-4 |
| Drawer, ready | "Zatwierdź i opublikuj" | "Opublikowane", column Zrobione, card chip "Opublikowane" | D-4 |
| Drawer, ready | "Poproś o poprawki" → reason | comment added, running, then ready again with larger scope | A-2 |
| Drawer, failed (agent) | "Spróbuj ponownie" | starting → running | A-3 |
| Drawer | comment empty → "Skomentuj" | inline error | D-7 |
| Drawer | comment text → ⌘⏎ | comment listed, field cleared, announced | D-7 |
| Any | unknown `#hash` | recovery screen with link to board | — |
| Any | "Resetuj symulację" | fixtures restored, toggles cleared, board, announced | — |

## Verification

Static review: passed. All links are in-artifact fragments; no external URLs, scripts,
fonts, storage, fetch or form actions. Form submission is intercepted. Document language `pl`.

Browser walk: **performed outside the skill's descriptor contract.** No `.ai/browsers/*.md`
descriptor exists in this repository and both available browser providers (Playwright MCP,
Claude in Chrome) refuse `file://`. The revision directory was served read-only on
`127.0.0.1:8931` with Python's built-in `http.server` and exercised with Playwright MCP.
Because the descriptor gate did not run, the manifest records `not-run`; the checks below
were observed, not inferred.

| Check | Result | Evidence |
|---|---|---|
| Board entry, 4 columns, chips, no time controls | ✅ | `evidence/01-board.png` |
| Ready state, status bar with 3 actions, change section, tech details collapsed | ✅ | `evidence/02-task-complete.png` |
| Preview screen, heading focus, back link | ✅ | `evidence/03-preview.png` |
| Browser back returns to drawer with title focused | ✅ | (evaluated) |
| Approve → published, card moved to Zrobione, live announcement | ✅ | `evidence/04-published.png` |
| Awaiting decision with inline plan | ✅ | `evidence/05-awaiting-decision.png` |
| Reject with empty reason → inline error, focus in textarea | ✅ | `evidence/06-reject-validation.png` |
| Reject with reason → rejected, Backlog, retry available | ✅ | `evidence/07-rejected.png` |
| Retry → running, status select disabled | ✅ | `evidence/08-running.png` |
| No agent state and picker (person + agent, focus in search) | ✅ | `evidence/09-no-agent.png`, `10-picker.png` |
| Enter applies → starting/running, focus returns to trigger | ✅ | `evidence/11-starting.png` |
| Picker while running: agent locked, note shown; Esc closes picker only | ✅ after fix | `evidence/12-picker-locked.png` |
| No-permission state and empty-comment validation | ✅ | `evidence/13-no-permission-comment-error.png` |
| Comment via ⌘⏎, field cleared | ✅ | (evaluated) |
| Delegate while factory not ready → configuration failure, take over only | ✅ | `evidence/14-factory-not-ready.png` |
| Unknown route recovery | ✅ | `evidence/15-unknown-route.png` |
| Reset restores fixtures and toggles | ✅ | (evaluated) |
| Narrow 390: board stacked, drawer full width, all actions in view, no horizontal overflow | ✅ | `evidence/16-mobile-board.png`, `17-mobile-task.png` |
| Keyboard: Tab through status-bar actions with visible focus | ✅ | `evidence/18-mobile-focus.png` |
| Agent-failed state with quoted reason | ✅ | `evidence/19-agent-failed.png` |
| Request changes → comment, rerun, ready again | ✅ | (evaluated) |
| Approve plan → running → ready with change section | ✅ | (evaluated) |
| Console errors | none from the artifact (only a favicon 404 from the ad-hoc server) | — |

Fixed during the walk (inside this revision): card titles rendered underlined; Esc in the
picker bubbled to the drawer and closed it; double full stop after a rejection reason; status
bar squeezed its text next to three buttons on desktop (actions now stack under the text).

Not checked: screen-reader announcement wording (only the live region's text was read
programmatically); agent-only assignment validation (every fixture already has a person, so
the error path exists but was not reached through the UI).

## How to open

Open `index.html` in a browser (double-click), or serve the directory when a tool refuses
`file://`:

```bash
python3 -m http.server 8931 --bind 127.0.0.1
```

Then `http://127.0.0.1:8931/index.html`. Use the grey toolbar to switch to the 390 px frame,
simulate a user without the delegate permission or a factory without its GitHub token, and
**Resetuj symulację** to restore the start. Everything lives in memory; reloading also resets.
