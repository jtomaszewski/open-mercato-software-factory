import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'catalog_corrections',
  title: 'Catalog corrections',
  version: '0.1.0',
  description: 'Approval-aware product capacity corrections through the existing catalog assistant.',
  requires: ['catalog', 'ai_assistant', 'task_tools'],
}
