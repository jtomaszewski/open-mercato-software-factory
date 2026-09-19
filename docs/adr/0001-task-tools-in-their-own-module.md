---
status: proposed
---

# Task tools live in their own app module, not in `tasks`

SPEC-002 places task intake (the `tasks_create` tool) inside the `tasks` module. That module is
being built by another person on a local branch and is on no remote branch the day before the
demo freeze (2026-09-19). We put the task AI tools in a separate app module
(`src/modules/task_tools/`) that creates tasks through the core `staff` task route and calls
the `tasks` delegation route only when the `tasks` module is installed; without it the task lands
in the backlog and the tool says why. We chose independence from another person's timeline and
no shared source files (only a coordinated one-line edit of `src/modules.ts`) over the tidier
"everything about tasks in `tasks`".

## Consequences

- Tool names are prefixed by our module id and are a contract with MCP clients; moving them
  into `tasks` later is a breaking rename, so we would keep them where they are.
- The intake command and the `tasks_intake` dedupe table from SPEC-002 stay with the `tasks`
  owner; when they land, our tool swaps one call and keeps its name and input.
- Enabling `staff`, `planner` and `resources` in `src/modules.ts` is needed by both modules and
  is the one identical edit both branches make.
