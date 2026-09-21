import { beforeEach, expect, it, jest } from '@jest/globals'
import { WorkflowDefinition, WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'

const findOne = jest.fn<(em: unknown, entity: unknown, where: Record<string, unknown>) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: unknown, entity: unknown, where: Record<string, unknown>) => findOne(em, entity, where),
}))
const resolveExecutionUser = jest.fn<(...args: unknown[]) => Promise<string | null>>()
jest.mock('@open-mercato/core/modules/workflows/lib/definition-grant', () => ({
  resolveWorkflowDefinitionExecutionUserId: (...args: unknown[]) => resolveExecutionUser(...args),
}))

import { failRunChangeRequest } from '../lib/failOnRunEnd'

const execute = jest.fn<(id: string, args: { input: Record<string, unknown> }) => Promise<unknown>>()
const emFindOne = jest.fn<(entity: unknown, where: Record<string, unknown>) => Promise<unknown>>()
const context = { resolve: (name: string) => ({ em: { fork: () => ({ findOne: emFindOne }) }, commandBus: { execute } } as Record<string, unknown>)[name] } as never
const payload = { id: 'wf-1', tenantId: 'tenant-1', organizationId: 'org-1', errorMessage: 'worker restarted' }

beforeEach(() => {
  execute.mockReset().mockResolvedValue({ result: {} })
  resolveExecutionUser.mockReset().mockResolvedValue('principal-1')
  emFindOne.mockReset().mockResolvedValue({ id: 'cr-1' })
  findOne.mockReset().mockImplementation(async (_em, entity) => {
    if (entity === ProcessInstance) return { id: 'process-1', input: { taskId: 'task-1', delegationId: 'delegation-1' } }
    if (entity === WorkflowInstance) return { id: 'wf-1', definitionId: 'def-1', errorMessage: 'worker restarted' }
    if (entity === WorkflowDefinition) return { id: 'def-1' }
    return null
  })
})

it('closes the change request of a run the engine ended, with the reason the engine gave', async () => {
  await failRunChangeRequest(payload, context)
  expect(execute).toHaveBeenCalledWith('code_changes.change_request.mark_failed', expect.objectContaining({
    input: { taskId: 'task-1', delegationId: 'delegation-1', processInstanceId: 'process-1', reason: 'worker restarted' },
  }))
})

it('identifies the run from the process input, so a released delegation does not hide it', async () => {
  await failRunChangeRequest(payload, context)
  // The delegation row is never read: `task_delegation` may already have released it.
  const readEntities = findOne.mock.calls.map(([, entity]) => entity)
  expect(readEntities).toEqual([ProcessInstance, WorkflowInstance, WorkflowDefinition])
})

it('leaves a change request alone once it is no longer being generated', async () => {
  emFindOne.mockResolvedValue(null)
  await failRunChangeRequest(payload, context)
  expect(execute).not.toHaveBeenCalled()
})

it('only looks at change requests still generating, never at a decided one', async () => {
  await failRunChangeRequest(payload, context)
  expect(emFindOne.mock.calls[0]![1]).toMatchObject({ delegationId: 'delegation-1', status: 'generating' })
})

it('ignores an event without scope rather than guessing one', async () => {
  await failRunChangeRequest({ id: 'wf-1' }, context)
  expect(execute).not.toHaveBeenCalled()
})
