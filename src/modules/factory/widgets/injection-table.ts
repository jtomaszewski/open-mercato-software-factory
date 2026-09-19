import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
export const injectionTable: ModuleInjectionTable = {
  // Directly under `task_delegation`'s run-status bar in the drawer header, because the bar tells
  // the owner the change is ready and this panel is where they act on it. The spot renders the
  // highest priority first, so a number below the bar's 20 puts this after it. It used to sit in
  // the `:sidebar` spot, below staff's tags, which is not where anyone looked.
  'detail:staff:staff_time_task:header': { widgetId: 'factory.injection.task-approve', priority: 10 },
}
export default injectionTable
