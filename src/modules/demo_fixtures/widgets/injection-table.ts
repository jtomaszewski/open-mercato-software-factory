import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'menu:sidebar:main': { widgetId: 'demo_fixtures.injection.demo-tasks-menu', priority: 50 },
}

export default injectionTable
