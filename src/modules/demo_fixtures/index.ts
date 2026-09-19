import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'demo_fixtures',
  title: 'Demo fixtures',
  version: '0.1.0',
  description: 'Demo data for the hackathon storyline: the Stal-Zbiorniki catalog (SPEC-004) and the Park of Poland customer with its order (SPEC-006).',
  author: 'HackOn team',
  license: 'MIT',
  requires: ['catalog', 'customers', 'sales'],
}
