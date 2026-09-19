import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
export const injectionTable: ModuleInjectionTable = {
  'staff.time_task.board:card-badges': [
    { widgetId: 'task_delegation.injection.task-assigned-to-card', priority: 40 },
    { widgetId: 'task_delegation.injection.task-delegate-badge', priority: 50 },
  ],
  'detail:staff:staff_time_task:header': { widgetId: 'task_delegation.injection.task-assigned-to', priority: 10 },
  'detail:staff:staff_time_task:sidebar': { widgetId: 'task_delegation.injection.task-delegate-sidebar', priority: 50 },
}
export default injectionTable
