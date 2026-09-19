import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerWorkflowFunctions } from '@open-mercato/core/modules/workflows/lib/workflow-function-registry'
import {
  createOpenPullRequestFunction,
  createPrepareCheckoutFunction,
  OPEN_PULL_REQUEST_FUNCTION,
  PREPARE_CHECKOUT_FUNCTION,
} from './lib/functions'

registerWorkflowFunctions([
  {
    name: PREPARE_CHECKOUT_FUNCTION,
    description: 'Move the delegated board task to In progress and clone its project repository into the run sandbox for the coding agent.',
  },
  {
    name: OPEN_PULL_REQUEST_FUNCTION,
    description: 'Commit the coding agent’s changes, open the pull request, link it on the task and move the task to review.',
  },
])

export function register(container: AppContainer) {
  // The functions build their own request container per run, so they hold no scoped services.
  container.register({
    [`workflowFunction:${PREPARE_CHECKOUT_FUNCTION}`]: asValue(createPrepareCheckoutFunction()),
    [`workflowFunction:${OPEN_PULL_REQUEST_FUNCTION}`]: asValue(createOpenPullRequestFunction()),
  })
}
