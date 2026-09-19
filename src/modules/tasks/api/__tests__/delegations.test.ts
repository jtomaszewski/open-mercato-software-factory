import { beforeEach, expect, it, jest } from '@jest/globals'
import { GET, POST } from '../delegations/route'
import { DELETE } from '../delegations/[taskId]/route'
import { GET as agents } from '../agents/route'

const mockExecute = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const mockRead = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const mockAgents = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const mockAfter = jest.fn<() => Promise<void>>()
const mockGuards = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const taskId = '11111111-1111-4111-8111-111111111111'
const agentId = '22222222-2222-4222-8222-222222222222'
const otherId = '33333333-3333-4333-8333-333333333333'
const mockContext = {
  commandContext: { container: { resolve: (name: string) => name === 'commandBus' ? { execute: mockExecute } : { getDelegations: mockRead, listAgents: mockAgents } } },
  userId: 'actor', tenantId: 'tenant', organizationId: 'organization', userFeatures: ['tasks.*'],
}
jest.mock('../route-context', () => ({ withTaskRoute: (_request: Request, _features: string[], handler: (ctx: unknown) => Promise<Response>) => handler(mockContext) }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: (...args: unknown[]) => mockGuards(...args) }))

beforeEach(() => {
  mockExecute.mockReset().mockResolvedValue({ result: { taskId, delegationId: otherId } })
  mockRead.mockReset().mockResolvedValue([])
  mockAgents.mockReset().mockResolvedValue([])
  mockAfter.mockReset().mockResolvedValue(undefined)
  mockGuards.mockReset().mockResolvedValue({ ok: true, runAfterSuccess: mockAfter })
})

function post(body: unknown) {
  return POST(new Request('http://localhost/api/tasks/delegations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
}

it('performs one scoped delegation read for a deduplicated batch', async () => {
  expect((await GET(new Request(`http://localhost/api/tasks/delegations?taskIds=${taskId},${taskId},${otherId}`))).status).toBe(200)
  expect(mockRead).toHaveBeenCalledTimes(1)
  expect(mockRead).toHaveBeenCalledWith(mockContext.commandContext, [taskId, otherId])
})

it('rejects malformed IDs before loading data', async () => {
  await expect(GET(new Request('http://localhost/api/tasks/delegations?taskIds=bad'))).rejects.toThrow()
  expect(mockRead).not.toHaveBeenCalled()
})

it('honors a blocked mutation before invoking a command', async () => {
  mockGuards.mockResolvedValue({ ok: false, response: Response.json({ code: 'blocked' }, { status: 409 }) })
  expect((await post({ taskId, agentUserId: agentId })).status).toBe(409)
  expect(mockExecute).not.toHaveBeenCalled()
  expect(mockAfter).not.toHaveBeenCalled()
})

it('revalidates guard modifications and runs callbacks after a committed command', async () => {
  mockGuards.mockResolvedValue({ ok: true, modifiedPayload: { agentUserId: otherId }, runAfterSuccess: mockAfter })
  mockAfter.mockImplementation(async () => { expect(mockExecute).toHaveBeenCalledTimes(1) })
  expect((await post({ taskId, agentUserId: agentId, tenantId: 'spoofed' })).status).toBe(201)
  expect(mockExecute).toHaveBeenCalledWith('tasks.task.delegate', { input: { taskId, agentUserId: otherId }, ctx: mockContext.commandContext })
  expect(mockAfter).toHaveBeenCalledTimes(1)
})

it('refuses a guard rewrite of the guarded task identity', async () => {
  mockGuards.mockResolvedValue({ ok: true, modifiedPayload: { taskId: otherId }, runAfterSuccess: mockAfter })
  await expect(post({ taskId, agentUserId: agentId })).rejects.toThrow()
  expect(mockExecute).not.toHaveBeenCalled()
})

it('does not run success callbacks after a command failure', async () => {
  mockExecute.mockRejectedValue(new Error('rollback'))
  await expect(post({ taskId, agentUserId: agentId })).rejects.toThrow('rollback')
  expect(mockAfter).not.toHaveBeenCalled()
})

it('un-delegates only the task from the guarded route', async () => {
  const response = await DELETE(new Request(`http://localhost/api/tasks/delegations/${taskId}`, { method: 'DELETE' }), { params: Promise.resolve({ taskId }) })
  expect(response.status).toBe(200)
  expect(mockExecute).toHaveBeenCalledWith('tasks.task.undelegate', { input: { taskId }, ctx: mockContext.commandContext })
})

it('uses the scoped delegate service for agent options', async () => {
  expect((await agents(new Request('http://localhost/api/tasks/agents'))).status).toBe(200)
  expect(mockAgents).toHaveBeenCalledWith(mockContext.commandContext)
})
