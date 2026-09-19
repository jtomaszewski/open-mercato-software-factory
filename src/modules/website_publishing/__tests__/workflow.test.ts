import { beforeEach, expect, it, jest } from '@jest/globals'
import { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'

const findOne = jest.fn<(em: unknown, entity: unknown, where: Record<string, unknown>) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (em: unknown, entity: unknown, where: Record<string, unknown>) => findOne(em, entity, where) }))
const resolveExecutionUser = jest.fn<(...args: unknown[]) => Promise<string | null>>()
jest.mock('@open-mercato/core/modules/workflows/lib/definition-grant', () => ({ resolveWorkflowDefinitionExecutionUserId: (...args: unknown[]) => resolveExecutionUser(...args) }))

// The real request container pulls in the ESM-only DB driver; the deps inject one instead.
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))

import { createLoadRecordsFunction, LOAD_RECORDS_FUNCTION, type LoadRecordsDeps } from '../lib/workflow'
import { orderTaskDescription, productTaskDescription } from '../lib/board'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const productId = 'aaaaaaaa-0000-4000-8000-000000000003'
const orderId = 'bbbbbbbb-0000-4000-8000-000000000004'
const execute = jest.fn<(id: string, args: { input: Record<string, unknown> }) => Promise<unknown>>()
let description: string | null

const container = {
  resolve: (name: string) => ({
    em: { fork: () => ({}) },
    commandBus: { execute },
    queryEngine: { query: async () => ({ items: [{ id: 'task-1', title: 'Zadanie', description, time_project_id: 'project-1' }] }) },
  } as Record<string, unknown>)[name],
}
const deps = {
  resolveContainer: async () => container as never,
  loadRecord: jest.fn<LoadRecordsDeps['loadRecord']>(),
  loadOrder: jest.fn<LoadRecordsDeps['loadOrder']>(),
}
const loadRecords = createLoadRecordsFunction(deps)
const context = { workflowInstance: { id: 'wf-1', definitionId: 'def-1', ...scope }, workflowContext: {} } as never

beforeEach(() => {
  execute.mockReset().mockResolvedValue({ result: {} })
  resolveExecutionUser.mockReset().mockResolvedValue('principal-1')
  deps.loadRecord.mockReset().mockResolvedValue({ id: productId, sku: 'ZWM-1500' } as never)
  deps.loadOrder.mockReset().mockResolvedValue({ id: orderId, orderNumber: 'SO-2026-0042' } as never)
  findOne.mockReset().mockImplementation(async (_em, entity) => {
    if (entity === ProcessInstance) return { id: 'process-1', input: { taskId: 'task-1', delegationId: 'delegation-1' } }
    if (entity === WorkflowDefinition) return { id: 'def-1' }
    return null
  })
})

it('hands the agents the catalog record a product task links', async () => {
  description = productTaskDescription({ id: productId, sku: 'ZWM-1500', title: 'Zbiornik' })
  await expect(loadRecords({}, context)).resolves.toEqual({ record: { id: productId, sku: 'ZWM-1500' }, order: null })
  expect(deps.loadRecord).toHaveBeenCalledWith(expect.anything(), scope, productId)
  expect(deps.loadOrder).not.toHaveBeenCalled()
})

it('hands the agents the fulfilled order a realization task links', async () => {
  description = orderTaskDescription({ id: orderId, orderNumber: 'SO-2026-0042', customerName: 'Park of Poland (Suntago)' }, 'https://demo.example')
  await expect(loadRecords({}, context)).resolves.toMatchObject({ record: null, order: { id: orderId, orderNumber: 'SO-2026-0042' } })
  expect(deps.loadRecord).not.toHaveBeenCalled()
})

it('a task without a link gets no records; a load failure closes the task with the reason', async () => {
  description = 'Popraw literówkę w stopce'
  await expect(loadRecords({}, context)).resolves.toEqual({ record: null, order: null })

  description = productTaskDescription({ id: productId, sku: 'ZWM-1500', title: 'Zbiornik' })
  deps.loadRecord.mockRejectedValue(new Error('db down'))
  await expect(loadRecords({}, context)).rejects.toThrow('db down')
  expect(execute).toHaveBeenCalledWith('task_delegation.task.set_status', expect.objectContaining({
    input: expect.objectContaining({ stepId: `${LOAD_RECORDS_FUNCTION}:failed`, status: 'failed', reason: 'db down' }),
  }))
})
