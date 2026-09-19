import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'factory',
  title: 'Software factory',
  version: '0.1.0',
  description:
    'Turns catalog changes into website pull requests: a product added to „Od ręki” becomes a DEMO board task delegated to Software Engineer, whose run opens a PR with its product page (SPEC-001, SPEC-004 scene 3, SPEC-005).',
  author: 'HackOn team',
  license: 'MIT',
  requires: ['catalog', 'workflows', 'task_delegation'],
}
