import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerWorkflowFunctions } from '@open-mercato/core/modules/workflows/lib/workflow-function-registry'
import { createDeliverFunction, createPrepareFunction, DELIVER_FUNCTION, PREPARE_FUNCTION } from './lib/deliver'

registerWorkflowFunctions([
  {
    name: PREPARE_FUNCTION,
    description: 'Move the delegated board task to In progress and clone the website repo into the run sandbox for the Developer agent.',
  },
  {
    name: DELIVER_FUNCTION,
    description: 'Commit the Developer agent’s changes, open the website PR, link it on the task and move the task to review.',
  },
])

export function register(container: AppContainer) {
  // The functions build their own request container per run, so they hold no scoped services.
  container.register({
    [`workflowFunction:${PREPARE_FUNCTION}`]: asValue(createPrepareFunction()),
    [`workflowFunction:${DELIVER_FUNCTION}`]: asValue(createDeliverFunction()),
  })
}
