import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'factory',
  title: 'Software factory',
  version: '0.1.0',
  description:
    'Turns catalog and sales changes into website pull requests: a product added to „Od ręki” becomes its product page, a fulfilled order becomes a customer reference (SPEC-001, SPEC-004 scenes 3 and 3b, SPEC-005, SPEC-006).',
  author: 'HackOn team',
  license: 'MIT',
  requires: ['catalog', 'sales', 'customers', 'workflows', 'task_delegation', 'task_tools', 'ai_assistant'],
}
