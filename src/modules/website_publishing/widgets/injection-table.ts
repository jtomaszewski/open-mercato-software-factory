import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
export const injectionTable: ModuleInjectionTable = {
  // External link to the published website, next to the topbar actions.
  'menu:topbar:actions': { widgetId: 'website_publishing.injection.site-link', priority: 50 },
}
export default injectionTable
