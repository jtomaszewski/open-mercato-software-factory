import { beforeEach, expect, it, jest } from '@jest/globals'
import { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'

const findOne = jest.fn<(em: unknown, entity: unknown, where: Record<string, unknown>) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (em: unknown, entity: unknown, where: Record<string, unknown>) => findOne(em, entity, where) }))
const resolveExecutionUser = jest.fn<(...args: unknown[]) => Promise<string | null>>()
jest.mock('@open-mercato/core/modules/workflows/lib/definition-grant', () => ({ resolveWorkflowDefinitionExecutionUserId: (...args: unknown[]) => resolveExecutionUser(...args) }))

// The real request container pulls in the ESM-only DB driver; the deliver deps inject one instead.
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))

import { createDeliverFunction, DELIVER_FUNCTION } from '../lib/deliver'
import { productTaskDescription } from '../lib/board'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const productId = 'aaaaaaaa-0000-4000-8000-000000000003'
const execute = jest.fn<(id: string, args: { input: Record<string, unknown>; ctx: { auth: { sub: string } } }) => Promise<unknown>>()
const produceChange = jest.fn<(...args: unknown[]) => Promise<never>>()
let description: string | null

const container = {
  resolve: (name: string) => ({
    em: { fork: () => ({}) },
    commandBus: { execute },
    queryEngine: { query: async () => ({ items: [{ id: 'task-1', title: 'Opublikuj stronę produktu ZWM-1500', description }] }) },
  } as Record<string, unknown>)[name],
}
const deliver = createDeliverFunction({ resolveContainer: async () => container as never, produceChange: produceChange as never })
const context = { workflowInstance: { id: 'wf-1', definitionId: 'def-1', ...scope }, workflowContext: {} } as never

beforeEach(() => {
  description = productTaskDescription({ id: productId, sku: 'ZWM-1500', title: 'Zbiornik' })
  execute.mockReset().mockResolvedValue({ result: {} })
  resolveExecutionUser.mockReset().mockResolvedValue('principal-1')
  produceChange.mockReset().mockResolvedValue({ prUrl: 'https://github.com/o/r/pull/7', prLabel: 'PR #7 · ZWM-1500', reused: false } as never)
  findOne.mockReset().mockImplementation(async (_em, entity, where) => {
    if (entity === ProcessInstance) return where.workflowInstanceId === 'wf-1' ? { id: 'process-1', input: { taskId: 'task-1', delegationId: 'delegation-1' } } : null
    if (entity === WorkflowDefinition) return { id: 'def-1' }
    return null
  })
})

it('drives the bound task through the tasks commands as the execution principal', async () => {
  await deliver({}, context)
  const identity = { taskId: 'task-1', delegationId: 'delegation-1', processInstanceId: 'process-1' }
  expect(execute.mock.calls.map(([id, args]) => [id, args.input])).toEqual([
    ['task_delegation.task.set_status', { ...identity, stepId: `${DELIVER_FUNCTION}:in_progress`, status: 'in_progress' }],
    ['task_delegation.task.link', { ...identity, stepId: `${DELIVER_FUNCTION}:pr`, kind: 'pr', ref: 'PR #7 · ZWM-1500', url: 'https://github.com/o/r/pull/7' }],
    ['task_delegation.task.set_status', { ...identity, stepId: `${DELIVER_FUNCTION}:in_review`, status: 'in_review' }],
  ])
  expect(execute.mock.calls.every(([, args]) => args.ctx.auth.sub === 'principal-1')).toBe(true)
  expect(produceChange).toHaveBeenCalledWith(expect.anything(), scope, { id: 'task-1', title: 'Opublikuj stronę produktu ZWM-1500', description }, productId)
})

it('refuses a workflow instance with no bound delegation', async () => {
  findOne.mockResolvedValue(null)
  await expect(deliver({}, context)).rejects.toThrow('no delegated task is bound')
  expect(execute).not.toHaveBeenCalled()
})

it('refuses to act without an execution principal', async () => {
  resolveExecutionUser.mockResolvedValue(null)
  await expect(deliver({}, context)).rejects.toThrow('no execution principal')
  expect(execute).not.toHaveBeenCalled()
})

it('passes a task without a product link on, and closes the task with the reason when producing fails', async () => {
  description = 'Popraw literówkę w stopce'
  produceChange.mockRejectedValue(new Error('The Developer agent finished without changing any file.'))
  await expect(deliver({}, context)).rejects.toThrow('without changing any file')
  expect(produceChange).toHaveBeenCalledWith(expect.anything(), scope, expect.objectContaining({ id: 'task-1' }), null)
  expect(execute.mock.calls.map(([id, args]) => [id, args.input.status])).toEqual([
    ['task_delegation.task.set_status', 'in_progress'],
    ['task_delegation.task.set_status', 'failed'],
  ])
  expect(execute.mock.calls[1]![1].input.reason).toContain('without changing any file')
})
