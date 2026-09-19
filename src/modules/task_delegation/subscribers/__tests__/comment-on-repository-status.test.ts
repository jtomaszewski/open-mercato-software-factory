import { beforeEach, expect, it, jest } from '@jest/globals'
import { TaskDelegation, TaskProcessWrite } from '../../data/entities'
import commentOnRepositoryStatus from '../comment-on-repository-status'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const REPOSITORY_ID = '33333333-3333-4333-8333-333333333333'
const DELEGATION_ID = '44444444-4444-4444-8444-444444444444'
const TASK_ID = '55555555-5555-4555-8555-555555555555'
const PROCESS_ID = '66666666-6666-4666-8666-666666666666'

const execute = jest.fn<(...args: unknown[]) => Promise<{ result: { commentId: string } }>>()
const find = jest.fn<(...args: unknown[]) => Promise<unknown[]>>()
const findOne = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const flush = jest.fn<() => Promise<void>>()
const persist = jest.fn<(value: unknown) => void>()
const create = jest.fn<(_entity: unknown, value: Record<string, unknown>) => Record<string, unknown>>()

const delegation = {
  id: DELEGATION_ID,
  taskId: TASK_ID,
  processInstanceId: PROCESS_ID,
  repositoryId: REPOSITORY_ID,
  repositoryConfigEpoch: 7,
  releasedAt: null,
}

function context() {
  const em = { fork: () => em, find, findOne, flush, persist, create }
  return {
    hasRegistration: () => true,
    resolve: (name: string) => name === 'em' ? em : { execute },
  }
}

const disabledPayload = {
  repositoryId: REPOSITORY_ID,
  status: 'disabled',
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
} as const

beforeEach(() => {
  execute.mockReset().mockResolvedValue({ result: { commentId: 'comment-id' } })
  find.mockReset().mockResolvedValue([delegation])
  findOne.mockReset().mockResolvedValue(null)
  flush.mockReset().mockResolvedValue(undefined)
  persist.mockReset()
  create.mockReset().mockImplementation((_entity, value) => value)
})

it('comments once on each active delegation bound to a disabled repository', async () => {
  await commentOnRepositoryStatus(disabledPayload, context() as never)

  expect(find).toHaveBeenCalledWith(TaskDelegation, {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    repositoryId: REPOSITORY_ID,
    releasedAt: null,
  })
  expect(execute).toHaveBeenCalledWith('staff.timesheets.task_comments.create', {
    input: {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      taskId: TASK_ID,
      body: 'The linked repository became unavailable because it was disabled. This delegation cannot publish until repository access is restored.',
    },
    ctx: expect.objectContaining({
      auth: null,
      selectedOrganizationId: ORGANIZATION_ID,
      systemActor: true,
    }),
  })
  expect(create).toHaveBeenCalledWith(TaskProcessWrite, expect.objectContaining({
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    taskId: TASK_ID,
    processInstanceId: PROCESS_ID,
    stepId: `repository-status:${DELEGATION_ID}:disabled:7`,
    commandId: 'staff.timesheets.task_comments.create',
  }))
  expect(flush).toHaveBeenCalledTimes(1)
})

it('does not repeat a comment when the status and frozen repository epoch were already recorded', async () => {
  findOne.mockResolvedValue({ id: 'existing-write' })

  await commentOnRepositoryStatus(disabledPayload, context() as never)

  expect(findOne).toHaveBeenCalledWith(TaskProcessWrite, {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    taskId: TASK_ID,
    processInstanceId: PROCESS_ID,
    stepId: `repository-status:${DELEGATION_ID}:disabled:7`,
  })
  expect(execute).not.toHaveBeenCalled()
  expect(persist).not.toHaveBeenCalled()
})

it('uses the delegation id as the idempotency namespace before a process is attached', async () => {
  find.mockResolvedValue([{ ...delegation, processInstanceId: null }])

  await commentOnRepositoryStatus(disabledPayload, context() as never)

  expect(create).toHaveBeenCalledWith(TaskProcessWrite, expect.objectContaining({
    processInstanceId: DELEGATION_ID,
  }))
  expect(execute).toHaveBeenCalledTimes(1)
})

it('does not write for an active repository or an incomplete event', async () => {
  await commentOnRepositoryStatus({ ...disabledPayload, status: 'active' }, context() as never)
  await commentOnRepositoryStatus({ ...disabledPayload, organizationId: undefined }, context() as never)

  expect(find).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})
