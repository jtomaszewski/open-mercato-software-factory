import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'repositories',
  title: 'Code repositories',
  version: '0.1.0',
  description: 'Registers GitHub repositories through a GitHub App and links them to projects.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
export { REPOSITORY_ACCESS } from './lib/repository-access'
export type { RepositoryAccess, ProjectRepositoryAccess } from './lib/repository-access'
