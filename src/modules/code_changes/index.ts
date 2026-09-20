import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'code_changes',
  title: 'Code changes',
  version: '0.2.0',
  description:
    'Owns the change request: one proposed change to a repository, from the agent run that produces it to the person who approves or rejects it. Workflow functions check the project repository out and open the pull request; the Code section lists every change request and decides it; the task-drawer panel decides the same change from the board.',
  author: 'HackOn team',
  license: 'MIT',
  // `repositories` is deliberately absent: `lib/github-source.ts` resolves it through a guarded
  // `hasRegistration` check and falls back to the environment, so the module works without it.
  requires: ['workflows', 'task_delegation', 'staff'],
}

export { features } from './acl'
