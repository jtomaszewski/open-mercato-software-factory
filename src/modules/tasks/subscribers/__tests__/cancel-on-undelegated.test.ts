import { beforeEach, expect, it, jest } from '@jest/globals'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import cancelOnUndelegated from '../cancel-on-undelegated'

const completeWorkflow = jest.fn<(...args: unknown[]) => Promise<void>>()
const findOne = jest.fn<(entity: unknown) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (_em: unknown, entity: unknown) => findOne(entity),
}))

function context() {
  const em = { fork: () => ({}) }
  return {
    hasRegistration: () => true,
    resolve: (name: string) => name === 'em' ? em : { completeWorkflow },
  }
}

const payload = { processInstanceId: 'process-id', tenantId: 'tenant-id', organizationId: 'org-id' }

beforeEach(() => {
  completeWorkflow.mockReset().mockResolvedValue(undefined)
  findOne.mockReset().mockImplementation(async (entity) => {
    if (entity === ProcessInstance) return { id: 'process-id', workflowInstanceId: 'workflow-id' }
    if (entity === WorkflowInstance) return { id: 'workflow-id', status: 'RUNNING' }
    return null
  })
})

it('does nothing without a linked process', async () => {
  await cancelOnUndelegated({ ...payload, processInstanceId: null }, context() as never)
  expect(completeWorkflow).not.toHaveBeenCalled()
})

it('does nothing when the process or workflow is missing', async () => {
  findOne.mockResolvedValueOnce(null)
  await cancelOnUndelegated(payload, context() as never)
  expect(completeWorkflow).not.toHaveBeenCalled()
})

it.each(['RUNNING', 'PAUSED'] as const)('cancels one active workflow in %s', async (status) => {
  findOne.mockImplementation(async (entity) => entity === ProcessInstance
    ? { id: 'process-id', workflowInstanceId: 'workflow-id' }
    : { id: 'workflow-id', status })
  await cancelOnUndelegated(payload, context() as never)
  expect(completeWorkflow).toHaveBeenCalledTimes(1)
  expect(completeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'workflow-id', 'CANCELLED')
})

it('does not cancel a terminal workflow', async () => {
  findOne.mockImplementation(async (entity) => entity === ProcessInstance
    ? { id: 'process-id', workflowInstanceId: 'workflow-id' }
    : { id: 'workflow-id', status: 'COMPLETED' })
  await cancelOnUndelegated(payload, context() as never)
  expect(completeWorkflow).not.toHaveBeenCalled()
})
