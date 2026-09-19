import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerWorkflowFunctions } from '@open-mercato/core/modules/workflows/lib/workflow-function-registry'
import { createLoadRecordsFunction, LOAD_RECORDS_FUNCTION } from './lib/workflow'

registerWorkflowFunctions([
  {
    name: LOAD_RECORDS_FUNCTION,
    description: 'Read the catalog product or the fulfilled order the delegated task links, for the Researcher and Developer agents.',
  },
])

export function register(container: AppContainer) {
  // The function builds its own request container per run, so it holds no scoped services.
  container.register({
    [`workflowFunction:${LOAD_RECORDS_FUNCTION}`]: asValue(createLoadRecordsFunction()),
  })
}
