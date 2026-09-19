import { beforeEach, expect, it, jest } from '@jest/globals'
import { AgentPrincipal, ProcessDefinition } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation } from '../../data/entities'
import startDelegatedRun from '../start-delegated-run'

const execute = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const findOne = jest.fn<(entity: unknown, where?: Record<string, unknown>) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (_em: unknown, entity: unknown, where: Record<string, unknown>) => findOne(entity, where),
}))

const payload = {
  taskId: '11111111-1111-4111-8111-111111111111',
  delegationId: '22222222-2222-4222-8222-222222222222',
  delegateUserId: '33333333-3333-4333-8333-333333333333',
  agentId: 'developer', delegatedBy: '44444444-4444-4444-8444-444444444444',
  tenantId: 'tenant-id', organizationId: 'org-id',
}

// The shape the event bus passes: `resolve` only, no `hasRegistration`.
function context(registered: readonly string[] = ['ProcessDefinition', 'AgentPrincipal']) {
  const em = { fork: () => ({ flush: async () => undefined }) }
  return {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'commandBus') return { execute }
      if (registered.includes(name)) return {}
      throw new Error(`Could not resolve '${name}'`)
    },
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
  await startDelegatedRun(payload, context() as never)
  expect(execute).toHaveBeenCalledWith('agent_orchestrator.processes.startExecution', expect.objectContaining({
    input: expect.objectContaining({
      input: { taskId: payload.taskId, delegationId: payload.delegationId },
      idempotencyKey: `task:${payload.taskId}:${payload.delegationId}`,
    }),
  }))
})

it('does not start a released or superseded delegation', async () => {
  findOne.mockResolvedValueOnce(null)
  await startDelegatedRun(payload, context() as never)
  expect(execute).not.toHaveBeenCalled()
})

it('ignores an event whose agent id no roster row names', async () => {
  await startDelegatedRun({ ...payload, agentId: 'other' }, context() as never)
  expect(findOne).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('takes the principal and the process it starts from the roster row', async () => {
  await startDelegatedRun(payload, context() as never)
  expect(findOne).toHaveBeenCalledWith(AgentPrincipal, expect.objectContaining({ agentDefinitionId: 'developer' }))
  expect(findOne).toHaveBeenCalledWith(ProcessDefinition, expect.objectContaining({ name: 'website_publishing.website_change' }))
})

it('starts a delegation to a principal still carrying the pre-rename id', async () => {
  // The principal is looked up by the id the delegation carries, not by the roster's current one.
  await startDelegatedRun({ ...payload, agentId: 'factory' }, context() as never)
  expect(findOne).toHaveBeenCalledWith(AgentPrincipal, expect.objectContaining({ agentDefinitionId: 'factory' }))
  expect(execute).toHaveBeenCalledWith('agent_orchestrator.processes.startExecution', expect.anything())
})

it('keeps the persistent event retryable when the required process is absent', async () => {
  findOne.mockImplementation(async (entity) => entity === TaskDelegation ? { id: payload.delegationId } : entity === AgentPrincipal ? { id: 'principal' } : null)
  await expect(startDelegatedRun(payload, context() as never)).rejects.toThrow('website_publishing.website_change is unavailable')
})

it('fails retryably when the orchestrator is not installed', async () => {
  await expect(startDelegatedRun(payload, context([]) as never)).rejects.toThrow('the agent orchestrator is unavailable')
  expect(execute).not.toHaveBeenCalled()
})
