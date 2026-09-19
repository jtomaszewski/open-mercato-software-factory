import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  CodeRepository,
  RepositoryBrokerReplay,
  RepositoryConnection,
  RepositoryConnectState,
  RepositoryEventIntent,
  RepositoryProjectLink,
  RepositoryQualificationDispatch,
} from './data/entities'
import { createRepositoryBroker } from './lib/broker'
import { REPOSITORY_BROKER } from './lib/qualification-dispatch'
import { createRepositoryTargetResolver, REPOSITORY_TARGET_RESOLVER } from './lib/target-resolver'

export function register(container: AppContainer): void {
  container.register({
    CodeRepository: asValue(CodeRepository),
    RepositoryConnection: asValue(RepositoryConnection),
    RepositoryConnectState: asValue(RepositoryConnectState),
    RepositoryEventIntent: asValue(RepositoryEventIntent),
    RepositoryProjectLink: asValue(RepositoryProjectLink),
    RepositoryQualificationDispatch: asValue(RepositoryQualificationDispatch),
    RepositoryBrokerReplay: asValue(RepositoryBrokerReplay),
    [REPOSITORY_BROKER]: asFunction(createRepositoryBroker).singleton(),
    [REPOSITORY_TARGET_RESOLVER]: asFunction(createRepositoryTargetResolver).proxy().scoped(),
  })
}
