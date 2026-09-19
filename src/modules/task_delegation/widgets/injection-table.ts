import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
export const injectionTable: ModuleInjectionTable = {
  'staff.time_task.board:toolbar': { widgetId: 'task_delegation.injection.board-chrome', priority: 90 },
  'staff.time_task.board:card-badges': [
    { widgetId: 'task_delegation.injection.task-assigned-to-card', priority: 40 },
    { widgetId: 'task_delegation.injection.task-delegate-badge', priority: 50 },
  ],
  // The drawer header is the whole owner-facing read of a delegated task: who owns it, then what
  // the run is doing, then — from `code_changes` at priority 10 — the website change to approve. The
  // spot renders the highest priority first, so these numbers descend in reading order.
  'detail:staff:staff_time_task:header': [
    { widgetId: 'task_delegation.injection.task-assigned-to', priority: 30 },
    { widgetId: 'task_delegation.injection.task-run-status', priority: 20 },
  ],
}
export default injectionTable
