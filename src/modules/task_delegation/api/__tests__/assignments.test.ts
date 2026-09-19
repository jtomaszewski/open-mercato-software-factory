import { beforeEach, expect, it, jest } from '@jest/globals'
import { POST } from '../assignments/route'
import { GET as assignablePeople } from '../assignable-people/route'

const mockExecute = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const mockPeople = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const mockAfter = jest.fn<() => Promise<void>>()
const mockGuards = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const taskId = '11111111-1111-4111-8111-111111111111'
const agentUserId = '22222222-2222-4222-8222-222222222222'
const memberId = '33333333-3333-4333-8333-333333333333'
const otherId = '44444444-4444-4444-8444-444444444444'
const mockContext = {
  commandContext: { container: { resolve: (name: string) => name === 'commandBus' ? { execute: mockExecute } : { listAssignablePeople: mockPeople } } },
  userId: 'actor', tenantId: 'tenant', organizationId: 'organization', userFeatures: ['task_delegation.view'],
}
jest.mock('../route-context', () => ({ withTaskRoute: (_request: Request, _features: string[], handler: (ctx: unknown) => Promise<Response>) => handler(mockContext) }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: (...args: unknown[]) => mockGuards(...args) }))

beforeEach(() => {
  mockExecute.mockReset().mockResolvedValue({ result: { taskId, assigneeStaffMemberId: memberId, delegation: { id: otherId }, previousAssigneeStaffMemberId: null, assigneeChanged: true } })
  mockPeople.mockReset().mockResolvedValue([])
  mockAfter.mockReset().mockResolvedValue(undefined)
  mockGuards.mockReset().mockResolvedValue({ ok: true, runAfterSuccess: mockAfter })
})

function post(body: unknown) {
  return POST(new Request('http://localhost/api/task_delegation/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
}

it('runs one assign command for both halves and answers the public shape only', async () => {
  const response = await post({ taskId, assigneeStaffMemberId: memberId, agentUserId })
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ taskId, assigneeStaffMemberId: memberId, delegation: { id: otherId } })
  expect(mockExecute).toHaveBeenCalledWith('task_delegation.task.assign', { input: { taskId, assigneeStaffMemberId: memberId, agentUserId }, ctx: mockContext.commandContext })
  expect(mockAfter).toHaveBeenCalledTimes(1)
})

it('refuses a body that assigns neither a person nor an agent', async () => {
  await expect(post({ taskId })).rejects.toThrow()
  expect(mockExecute).not.toHaveBeenCalled()
})

it('honors a blocked mutation before invoking the command', async () => {
  mockGuards.mockResolvedValue({ ok: false, response: Response.json({ code: 'blocked' }, { status: 409 }) })
  expect((await post({ taskId, assigneeStaffMemberId: memberId })).status).toBe(409)
  expect(mockExecute).not.toHaveBeenCalled()
  expect(mockAfter).not.toHaveBeenCalled()
})

it('refuses a guard rewrite of the assigned task', async () => {
  mockGuards.mockResolvedValue({ ok: true, modifiedPayload: { taskId: otherId }, runAfterSuccess: mockAfter })
  await expect(post({ taskId, assigneeStaffMemberId: memberId })).rejects.toThrow()
  expect(mockExecute).not.toHaveBeenCalled()
})

it('does not run success callbacks after a failed assignment', async () => {
  mockExecute.mockRejectedValue(new Error('rollback'))
  await expect(post({ taskId, assigneeStaffMemberId: memberId })).rejects.toThrow('rollback')
  expect(mockAfter).not.toHaveBeenCalled()
})

it('reads assignable people for one task through the scoped service', async () => {
  expect((await assignablePeople(new Request(`http://localhost/api/task_delegation/assignable-people?taskId=${taskId}`))).status).toBe(200)
  expect(mockPeople).toHaveBeenCalledWith(mockContext.commandContext, taskId)
})

it('rejects a malformed task id before loading people', async () => {
  await expect(assignablePeople(new Request('http://localhost/api/task_delegation/assignable-people?taskId=bad'))).rejects.toThrow()
  expect(mockPeople).not.toHaveBeenCalled()
})
