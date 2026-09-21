import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'website_publishing',
  title: 'Website publishing',
  version: '0.1.0',
  description:
    'Keeps the company website in step with the ERP: a product added to the catalog becomes its product page, a fulfilled order becomes a customer reference, and the catalog chat can request a website change. Each becomes a board task the Developer agent turns into a pull request (SPEC-004 scenes 3 and 3b, SPEC-005, SPEC-006).',
  author: 'HackOn team',
  license: 'MIT',
  requires: ['catalog', 'sales', 'customers', 'workflows', 'task_delegation', 'task_tools', 'ai_assistant', 'code_changes'],
}
