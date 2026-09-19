import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { TaskDelegation, TaskProcessWrite } from './data/entities'
import { createTasksDelegationService, TASKS_DELEGATION_SERVICE } from './lib/delegationService'

export function register(container: AppContainer): void {
  container.register({
    TaskDelegation: asValue(TaskDelegation),
    TaskProcessWrite: asValue(TaskProcessWrite),
    [TASKS_DELEGATION_SERVICE]: asFunction(createTasksDelegationService).scoped(),
  })
}
