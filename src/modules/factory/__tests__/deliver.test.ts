import { beforeEach, expect, it, jest } from '@jest/globals'
import { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'

const findOne = jest.fn<(em: unknown, entity: unknown, where: Record<string, unknown>) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (em: unknown, entity: unknown, where: Record<string, unknown>) => findOne(em, entity, where) }))
const resolveExecutionUser = jest.fn<(...args: unknown[]) => Promise<string | null>>()
jest.mock('@open-mercato/core/modules/workflows/lib/definition-grant', () => ({ resolveWorkflowDefinitionExecutionUserId: (...args: unknown[]) => resolveExecutionUser(...args) }))

// The real request container pulls in the ESM-only DB driver; the deliver deps inject one instead.
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))

import { createDeliverFunction, createPrepareFunction, DELIVER_FUNCTION, PREPARE_FUNCTION, type DeliverDeps } from '../lib/deliver'
import { orderTaskDescription, productTaskDescription } from '../lib/board'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const productId = 'aaaaaaaa-0000-4000-8000-000000000003'
const orderId = 'bbbbbbbb-0000-4000-8000-000000000004'
const execute = jest.fn<(id: string, args: { input: Record<string, unknown>; ctx: { auth: { sub: string } } }) => Promise<unknown>>()
let description: string | null

const container = {
  resolve: (name: string) => ({
    em: { fork: () => ({}) },
    commandBus: { execute },
    queryEngine: { query: async () => ({ items: [{ id: 'task-1', title: 'Opublikuj stronę produktu ZWM-1500', description, time_project_id: 'project-1' }] }) },
  } as Record<string, unknown>)[name],
}
const deps = {
  resolveContainer: async () => container as never,
  loadRecord: jest.fn<DeliverDeps['loadRecord']>(),
  loadOrder: jest.fn<DeliverDeps['loadOrder']>(),
  resolveGitHub: jest.fn<DeliverDeps['resolveGitHub']>(),
  prepareCheckout: jest.fn<DeliverDeps['prepareCheckout']>(),
  collectChanges: jest.fn<DeliverDeps['collectChanges']>(),
  removeCheckout: jest.fn<DeliverDeps['removeCheckout']>(),
  openPullRequest: jest.fn<DeliverDeps['openPullRequest']>(),
}
const prepare = createPrepareFunction(deps)
const deliver = createDeliverFunction(deps)
const context = { workflowInstance: { id: 'wf-1', definitionId: 'def-1', ...scope }, workflowContext: {} } as never
const identity = { taskId: 'task-1', delegationId: 'delegation-1', processInstanceId: 'process-1' }
const site = { token: 'app-token', repo: 'o/site', baseBranch: 'main', apiUrl: 'https://api.github.com' }
const calls = () => execute.mock.calls.map(([id, args]) => [id, args.input])

beforeEach(() => {
  description = productTaskDescription({ id: productId, sku: 'ZWM-1500', title: 'Zbiornik' })
  execute.mockReset().mockResolvedValue({ result: {} })
  resolveExecutionUser.mockReset().mockResolvedValue('principal-1')
  deps.resolveGitHub.mockReset().mockResolvedValue(site)
  deps.loadRecord.mockReset().mockResolvedValue({ id: productId, sku: 'ZWM-1500' } as never)
  deps.loadOrder.mockReset().mockResolvedValue({ id: orderId, orderNumber: 'SO-2026-0042' } as never)
  deps.prepareCheckout.mockReset().mockResolvedValue({ baseSha: 'base-sha', workDir: '/home/opencode/work/factory/task-1' })
  deps.collectChanges.mockReset().mockResolvedValue({ baseSha: 'base-sha', files: [{ path: 'app/a.tsx', content: 'x' }] })
  deps.removeCheckout.mockReset().mockResolvedValue(undefined)
  deps.openPullRequest.mockReset().mockResolvedValue({ prNumber: 7, prUrl: 'https://github.com/o/r/pull/7', prLabel: 'PR #7 · ZWM-1500', branch: 'developer/task-task-1' })
  findOne.mockReset().mockImplementation(async (_em, entity, where) => {
    if (entity === ProcessInstance) return where.workflowInstanceId === 'wf-1' ? { id: 'process-1', input: { taskId: 'task-1', delegationId: 'delegation-1' } } : null
    if (entity === WorkflowDefinition) return { id: 'def-1' }
    return null
  })
})

it('prepare: moves the bound task to In progress and hands the agent the checkout and the catalog record', async () => {
  const input = await prepare({}, context)
  expect(calls()).toEqual([['task_delegation.task.set_status', { ...identity, stepId: `${PREPARE_FUNCTION}:in_progress`, status: 'in_progress' }]])
  expect(execute.mock.calls[0]![1].ctx.auth.sub).toBe('principal-1')
  expect(deps.loadRecord).toHaveBeenCalledWith(expect.anything(), scope, productId)
  expect(deps.resolveGitHub).toHaveBeenCalledWith(expect.anything(), scope, 'project-1')
  expect(deps.prepareCheckout).toHaveBeenCalledWith('task-1', site)
  expect(input).toEqual({
    taskId: 'task-1', title: 'Opublikuj stronę produktu ZWM-1500', description, record: { id: productId, sku: 'ZWM-1500' }, order: null,
    workDir: '/home/opencode/work/factory/task-1', baseSha: 'base-sha',
  })
})

it('prepare: a realization task hands the agents the fulfilled order instead of a catalog record', async () => {
  description = orderTaskDescription({ id: orderId, orderNumber: 'SO-2026-0042', customerName: 'Park of Poland (Suntago)' }, 'https://demo.example')
  const input = await prepare({}, context)
  expect(deps.loadRecord).not.toHaveBeenCalled()
  expect(deps.loadOrder).toHaveBeenCalledWith(expect.anything(), scope, orderId)
  expect(input).toMatchObject({ record: null, order: { id: orderId, orderNumber: 'SO-2026-0042' } })
})

it('prepare: a task without a product link gets no record, and a clone failure closes the task with the reason', async () => {
  description = 'Popraw literówkę w stopce'
  deps.prepareCheckout.mockRejectedValue(new Error('Cannot clone o/site: network'))
  await expect(prepare({}, context)).rejects.toThrow('Cannot clone')
  expect(deps.loadRecord).not.toHaveBeenCalled()
  expect(calls().map(([id, input]) => [id, (input as { status: string }).status])).toEqual([
    ['task_delegation.task.set_status', 'in_progress'],
    ['task_delegation.task.set_status', 'failed'],
  ])
  expect((execute.mock.calls[1]![1].input as { reason: string }).reason).toContain('Cannot clone')
})

it('deliver: commits the collected change with the agent summary, links the PR, moves the task to review and removes the checkout', async () => {
  const result = await deliver({ summary: 'Dodałem stronę.' }, context)
  expect(deps.collectChanges).toHaveBeenCalledWith('task-1')
  expect(deps.openPullRequest).toHaveBeenCalledWith(
    { id: 'task-1', title: 'Opublikuj stronę produktu ZWM-1500', description },
    { baseSha: 'base-sha', files: [{ path: 'app/a.tsx', content: 'x' }], summary: 'Dodałem stronę.' },
    site,
  )
  expect(calls()).toEqual([
    ['task_delegation.task.link', { ...identity, stepId: `${DELIVER_FUNCTION}:pr`, kind: 'pr', ref: 'PR #7 · ZWM-1500', url: 'https://github.com/o/r/pull/7' }],
    ['task_delegation.task.set_status', { ...identity, stepId: `${DELIVER_FUNCTION}:in_review`, status: 'in_review' }],
  ])
  expect(deps.removeCheckout).toHaveBeenCalledWith('task-1')
  expect(result.prUrl).toBe('https://github.com/o/r/pull/7')
})

it('deliver: an unresolved summary token is treated as no summary', async () => {
  await deliver({ summary: '{{context.developer.summary}}' }, context)
  expect(deps.openPullRequest.mock.calls[0]![1].summary).toBe('')
})

it('deliver: an empty change closes the task as failed and keeps the checkout for inspection', async () => {
  deps.collectChanges.mockRejectedValue(new Error('The Developer agent finished without changing any file.'))
  await expect(deliver({}, context)).rejects.toThrow('without changing any file')
  expect(deps.openPullRequest).not.toHaveBeenCalled()
  expect(deps.removeCheckout).not.toHaveBeenCalled()
  expect(calls()).toEqual([['task_delegation.task.set_status', { ...identity, stepId: `${DELIVER_FUNCTION}:failed`, status: 'failed', reason: 'The Developer agent finished without changing any file.' }]])
})

it('refuses a workflow instance with no bound delegation', async () => {
  findOne.mockResolvedValue(null)
  await expect(prepare({}, context)).rejects.toThrow('no delegated task is bound')
  await expect(deliver({}, context)).rejects.toThrow('no delegated task is bound')
  expect(execute).not.toHaveBeenCalled()
})

it('refuses to act without an execution principal', async () => {
  resolveExecutionUser.mockResolvedValue(null)
  await expect(prepare({}, context)).rejects.toThrow('no execution principal')
  expect(execute).not.toHaveBeenCalled()
})
