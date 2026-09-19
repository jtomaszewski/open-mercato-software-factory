import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'code_changes',
  title: 'Code changes',
  version: '0.1.0',
  description:
    'Turns a delegated board task into a pull request on its project repository: workflow functions that check the repository out for the coding agent and open the PR from its changes, and the task-drawer panel that reviews and approves (merges) it.',
  author: 'HackOn team',
  license: 'MIT',
  requires: ['workflows', 'task_delegation'],
}
