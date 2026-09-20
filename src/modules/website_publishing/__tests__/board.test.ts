import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const findOne = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => findOne(...args) }))

import { openOrderTask, openProductTask, orderTaskDescription, productTaskDescription, readOrderIdFromTask, readProductIdFromTask } from '../lib/board'

const scope = { tenantId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002' }
const product = { id: 'AAAAAAAA-0000-4000-8000-000000000003', sku: 'ZWM-1500', title: 'Zbiornik mobilny na wodę pitną 1500 l' }
const execute = jest.fn<(id: string, args: { input: Record<string, unknown>; ctx: { auth: { sub: string } } }) => Promise<{ result: Record<string, string> }>>()
let rows: Record<string, Array<Record<string, unknown>>>

function container(registered = true) {
  const services: Record<string, unknown> = {
    em: { fork: () => ({}) },
    queryEngine: { query: async (entity: string) => ({ items: rows[entity] ?? [] }) },
    commandBus: { execute },
  }
  return { resolve: (name: string) => services[name], hasRegistration: (name: string) => registered || name !== 'AgentPrincipal' } as never
}

beforeEach(() => {
  rows = { 'staff:staff_time_project': [{ id: 'project-1', owner_user_id: 'owner-1' }] }
  findOne.mockReset().mockResolvedValue({ userId: 'agent-1' })
  execute.mockReset().mockImplementation(async (id) => ({
    result: id === 'staff.timesheets.tasks.create' ? { taskId: 'task-1' } : { taskId: 'task-1', delegationId: 'delegation-1' } as Record<string, string>,
  }))
})

describe('product ↔ task link', () => {
  it('round-trips the product id through the task description, with or without an app URL', () => {
    expect(readProductIdFromTask(productTaskDescription(product, 'https://demo.example/'))).toBe(product.id.toLowerCase())
    expect(readProductIdFromTask(productTaskDescription(product))).toBe(product.id.toLowerCase())
    expect(readProductIdFromTask('Zadanie bez linku')).toBeNull()
    expect(readProductIdFromTask(null)).toBeNull()
  })
})

describe('order ↔ task link', () => {
  const order = { id: 'BBBBBBBB-0000-4000-8000-000000000004', orderNumber: 'SO-2026-0042', customerName: 'Park of Poland (Suntago)' }

  it('round-trips the order id and never mistakes it for a product', () => {
    const description = orderTaskDescription(order, 'https://demo.example/')
    expect(readOrderIdFromTask(description)).toBe(order.id.toLowerCase())
    expect(readProductIdFromTask(description)).toBeNull()
    expect(readOrderIdFromTask(productTaskDescription(product))).toBeNull()
  })

  it('opens one delegated WWW task per order and reuses it on a repeated intake', async () => {
    const first = await openOrderTask(container(), scope, order)
    expect(execute.mock.calls[0]![1].input).toMatchObject({ title: 'Realizacja: Park of Poland (Suntago) — SO-2026-0042' })
    expect(first).toMatchObject({ status: 'delegated', created: true })

    execute.mockClear()
    rows['staff:staff_time_task'] = [{ id: 'task-9', description: orderTaskDescription(order) }]
    const second = await openOrderTask(container(), scope, order)
    expect(execute.mock.calls.map(([id]) => id)).toEqual(['task_delegation.task.delegate'])
    expect(second).toMatchObject({ taskId: 'task-9', created: false })
  })
})

describe('openProductTask', () => {
  it('creates the WWW task and delegates it to the Software Engineer as the project owner', async () => {
    const result = await openProductTask(container(), scope, product)
    expect(execute.mock.calls.map(([id]) => id)).toEqual(['staff.timesheets.tasks.create', 'task_delegation.task.delegate'])
    expect(execute.mock.calls[0]![1].input).toMatchObject({ ...scope, timeProjectId: 'project-1', title: 'Opublikuj stronę produktu ZWM-1500' })
    expect(execute.mock.calls[1]![1].input).toEqual({ taskId: 'task-1', agentUserId: 'agent-1' })
    expect(execute.mock.calls[1]![1].ctx.auth.sub).toBe('owner-1')
    expect(result).toEqual({ status: 'delegated', taskId: 'task-1', created: true, delegationId: 'delegation-1' })
  })

  it('reuses the task that already links the product and tolerates an active delegation', async () => {
    rows['staff:staff_time_task'] = [
      { id: 'other', description: 'nothing here' },
      { id: 'task-9', description: productTaskDescription(product) },
    ]
    execute.mockRejectedValueOnce(new CrudHttpError(409, { code: 'already_delegated', error: 'x' }))
    const result = await openProductTask(container(), scope, product)
    expect(execute.mock.calls.map(([id]) => id)).toEqual(['task_delegation.task.delegate'])
    expect(result).toEqual({ status: 'already_delegated', taskId: 'task-9', created: false, delegationId: null })
  })

  it('skips without writing when the board or the agent is missing', async () => {
    await expect(openProductTask(container(false), scope, product)).resolves.toMatchObject({ status: 'skipped', reason: 'no_agent' })
    rows['staff:staff_time_project'] = []
    await expect(openProductTask(container(), scope, product)).resolves.toMatchObject({ status: 'skipped', reason: 'no_demo_project' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rethrows other failures so the persistent event retries', async () => {
    execute.mockResolvedValueOnce({ result: { taskId: 'task-1' } }).mockRejectedValueOnce(new CrudHttpError(503, { code: 'orchestrator_unavailable', error: 'x' }))
    await expect(openProductTask(container(), scope, product)).rejects.toMatchObject({ status: 503 })
  })
})
