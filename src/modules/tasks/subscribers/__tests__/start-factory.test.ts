import { beforeEach, expect, it, jest } from '@jest/globals'
import { AgentPrincipal, ProcessDefinition } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation } from '../../data/entities'
import startFactory from '../start-factory'

const execute = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const findOne = jest.fn<(entity: unknown) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (_em: unknown, entity: unknown) => findOne(entity),
}))

const payload = {
  taskId: '11111111-1111-4111-8111-111111111111',
  delegationId: '22222222-2222-4222-8222-222222222222',
  delegateUserId: '33333333-3333-4333-8333-333333333333',
  agentId: 'factory', delegatedBy: '44444444-4444-4444-8444-444444444444',
  tenantId: 'tenant-id', organizationId: 'org-id',
}

function context() {
  const em = { fork: () => ({ flush: async () => undefined }) }
  return {
    hasRegistration: () => true,
    resolve: (name: string) => name === 'em' ? em : { execute },
  }
}

beforeEach(() => {
  execute.mockReset().mockResolvedValue({ result: { executionId: 'execution-id' } })
  findOne.mockReset().mockImplementation(async (entity) => {
    if (entity === TaskDelegation) return { id: payload.delegationId }
    if (entity === AgentPrincipal) return { userId: payload.delegateUserId, agentDefinitionId: 'factory' }
    if (entity === ProcessDefinition) return { id: 'definition-id', triggers: [{ kind: 'manual' }] }
    return null
  })
})

it('starts the exact active factory delegation with identifier-only input', async () => {
  await startFactory(payload, context() as never)
  expect(execute).toHaveBeenCalledWith('agent_orchestrator.processes.startExecution', expect.objectContaining({
    input: expect.objectContaining({
      input: { taskId: payload.taskId, delegationId: payload.delegationId },
      idempotencyKey: `task:${payload.taskId}:${payload.delegationId}`,
    }),
  }))
})

it('does not start a released or superseded delegation', async () => {
  findOne.mockResolvedValueOnce(null)
  await startFactory(payload, context() as never)
  expect(execute).not.toHaveBeenCalled()
})

it('ignores a non-factory event', async () => {
  await startFactory({ ...payload, agentId: 'other' }, context() as never)
  expect(findOne).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('keeps the persistent event retryable when the required process is absent', async () => {
  findOne.mockImplementation(async (entity) => entity === TaskDelegation ? { id: payload.delegationId } : entity === AgentPrincipal ? { id: 'principal' } : null)
  await expect(startFactory(payload, context() as never)).rejects.toThrow('factory.deliver is unavailable')
})
