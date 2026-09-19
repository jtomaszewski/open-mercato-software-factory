import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'detail:staff:staff_time_project:tabs': [{
    widgetId: 'repositories.injection.project-repositories',
    kind: 'tab',
    groupLabel: 'repositories.projectLinks.tab',
    priority: 20,
  }],
}

export default injectionTable
