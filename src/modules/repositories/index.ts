import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'repositories',
  title: 'Code repositories',
  version: '0.1.0',
  description: 'Registers and qualifies GitHub repositories through an external credential broker.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
export { REPOSITORY_BROKER } from './lib/qualification-dispatch'
export type { RepositoryBroker } from './lib/broker'
export { REPOSITORY_TARGET_RESOLVER } from './lib/target-resolver'
export type { RepositoryTargetResolver, ResolvedRepositoryTarget } from './lib/target-resolver'
