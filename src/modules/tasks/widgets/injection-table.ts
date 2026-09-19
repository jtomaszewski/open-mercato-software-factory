import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
export const injectionTable: ModuleInjectionTable = {
  'staff.time_task.board:card-badges': { widgetId: 'tasks.injection.task-delegate-badge', priority: 50 },
  'detail:staff:staff_time_task:sidebar': { widgetId: 'tasks.injection.task-delegate-sidebar', priority: 50 },
}
export default injectionTable
