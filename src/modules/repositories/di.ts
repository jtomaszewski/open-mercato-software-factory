import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CodeRepository, RepositoryConnection, RepositoryConnectState, RepositoryProjectLink } from './data/entities'
import { createGitHubApp, REPOSITORY_GITHUB_APP } from './lib/github-app'
import { createRepositoryAccess, REPOSITORY_ACCESS } from './lib/repository-access'

export function register(container: AppContainer): void {
  container.register({
    CodeRepository: asValue(CodeRepository),
    RepositoryConnection: asValue(RepositoryConnection),
    RepositoryConnectState: asValue(RepositoryConnectState),
    RepositoryProjectLink: asValue(RepositoryProjectLink),
    [REPOSITORY_GITHUB_APP]: asFunction(() => createGitHubApp()).singleton(),
    [REPOSITORY_ACCESS]: asFunction(createRepositoryAccess).proxy().scoped(),
  })
}
