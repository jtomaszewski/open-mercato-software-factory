import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { registerWorkflowFunctions } from '@open-mercato/core/modules/workflows/lib/workflow-function-registry'
import { createDeliverFunction, createPrepareFunction, DELIVER_FUNCTION, PREPARE_FUNCTION } from './lib/deliver'
import { readCheckoutConfigFromEnv } from './lib/checkout'
import { DockerFactoryContainerSupervisor, createFactoryIsolatedAgentRuntime } from './lib/isolated-runtime'
import { startFactoryRunGateway } from './lib/run-gateway'

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
    agentRuntime: asFunction(({ commandBus }: { commandBus: CommandBus }) =>
      createFactoryIsolatedAgentRuntime({
        container,
        commandBus,
        checkoutConfig: readCheckoutConfigFromEnv(),
        containerSupervisor: new DockerFactoryContainerSupervisor({
          image: () => requiredEnv('FACTORY_DEVELOPER_RUNNER_IMAGE'),
        }),
        startGateway: () => startFactoryRunGateway({
          model: process.env.FACTORY_DEVELOPER_MODEL?.trim() || 'anthropic/claude-sonnet-4.5',
          budgetUsd: factoryBudgetUsd(),
          mcpUrl: process.env.OPENCODE_MCP_URL?.trim() || 'http://127.0.0.1:3001/mcp',
          mcpApiKey: requiredEnv('MCP_SERVER_API_KEY'),
          openRouterApiKey: requiredEnv('OPENROUTER_API_KEY'),
          ...(process.env.FACTORY_RUNTIME_CONTAINER_HOST?.trim()
            ? { containerHost: process.env.FACTORY_RUNTIME_CONTAINER_HOST.trim() }
            : {}),
        }),
      }),
    ).proxy().scoped(),
  })
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`[internal] ${name} is required for the isolated factory runtime`)
  return value
}

function factoryBudgetUsd(): number {
  const value = Number(process.env.FACTORY_DEVELOPER_BUDGET_USD ?? '0')
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('[internal] FACTORY_DEVELOPER_BUDGET_USD must be a non-negative number')
  }
  return value
}
