/**
 * The scoped CSS this module injects into `staff`'s own board and task drawer.
 *
 * **This is the brittle part of the module, on purpose.** `staff` 0.8.0 publishes ten overridable
 * components and nine injection spots, and none of them lets a host drop a section of the task
 * drawer or of the Kanban card. The delegation board is used by a company owner who does not log
 * time, does not run timers and does not tag tasks, so every one of those controls is noise in
 * front of the one thing they are there for — what the agent did with the task.
 *
 * Until `staff` publishes a seam, the rules below hide those sections by the `data-testid` values
 * staff renders. `display: none` is deliberate: it also takes the controls out of the tab order, so
 * nothing stays reachable by keyboard that is invisible to the eye. Every selector is pinned by
 * `widgets/__tests__/staff-chrome.test.ts`, which reads staff's own sources and fails at
 * `yarn test` the moment one of them stops matching — the alternative is a drawer that silently
 * grows back a timer nobody wants, or loses a section we meant to keep.
 *
 * What is deliberately NOT hidden: comments, the timeline, the status select (disabled by staff
 * itself while a process owns the task) and subtasks that actually exist.
 */

/** Staff's own assignee field, which our "Assigned to" picker replaces. */
export const STAFF_ASSIGNEE_FIELD_TESTID = 'task-drawer-assignee-select'

export const HIDE_STAFF_ASSIGNEE_FIELD = `
div:has(> [data-testid="task-drawer-assignee-select"]) { display: none !important; }
`

/** Drawer sections a company owner has no use for. */
export const OWNER_IRRELEVANT_DRAWER_TESTIDS = [
  // Timer, "log time" row and the day/duration fields under it.
  'task-drawer-quick-log',
  // Logged total, own/subtask split, billable and cost badges.
  'task-drawer-logged',
  // The time-entry list and its "Show all".
  'task-drawer-entries',
] as const

export const HIDE_OWNER_IRRELEVANT_DRAWER_CHROME = `
${OWNER_IRRELEVANT_DRAWER_TESTIDS.map((testId) => `[data-testid="${testId}"]`).join(',\n')} { display: none !important; }

/* Subtasks are worth a section when there are some; an empty one is a prompt to do staff's work. */
[data-testid="task-drawer-subtasks"]:not(:has(li)) { display: none !important; }

/* The tags block of the properties section. The first selector names its tag picker; the second
   catches the read-only case, where staff renders no picker — properties holds exactly two divs,
   the status/assignee grid and the tags. */
[data-testid="task-drawer-properties"] > div:has([data-testid="task-drawer-tag-select"]),
[data-testid="task-drawer-properties"] > div:nth-of-type(2) { display: none !important; }
`

/** Board-card chrome a company owner has no use for. */
export const HIDE_OWNER_IRRELEVANT_CARD_CHROME = `
/* Staff's tag chips. The quick-action row is also flex-wrap, but at gap-1.5, not gap-1. */
[data-task-card] > div.flex-wrap.gap-1 { display: none !important; }

/* The separator and the avatar / timer / logged-minutes row under it: our own card widgets already
   carry the owner and the run state in the badges spot above it. */
[data-task-card] > div[aria-hidden="true"],
[data-task-card] > div[aria-hidden="true"] + div { display: none !important; }

/* Start/stop timer and "Add time". The "Move" button is wrapped in a div, so it survives and the
   card keeps a keyboard route between columns. */
[data-testid^="kanban-card-actions-"] > button { display: none !important; }

/* The logged-hours total in each column header. The task count beside it stays — how many tasks
   sit in a column is the owner's business; how many hours were booked against them is not. */
[data-testid^="kanban-hours-"] { display: none !important; }
`

/**
 * The board's subtitle reads "<project> · 7 tasks · 656:30 logged" as ONE joined string, so no
 * selector can reach the last third of it. `staff` builds it from parts and drops the empty ones,
 * and an app module's dictionary is merged after core's — so blanking this key removes the segment
 * and leaves the rest of the line intact. Same intent as the rules above, different seam, because
 * this one is text rather than an element.
 */
export const BLANKED_STAFF_KEYS = ['staff.time_tracking.board.summary.logged'] as const
