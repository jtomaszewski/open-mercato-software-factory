import { expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { delegateTaskCommand } from '../tasks'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const AGENT_ID = '22222222-2222-4222-8222-222222222222'

it('rejects a stale delegation request before any task or delegation write', async () => {
  const current = '2026-09-19T12:00:00.000Z'
  const execute = jest.fn<() => Promise<never>>()
  const lockTask = jest.fn(async () => ({
    taskId: TASK_ID, timeProjectId: 'project-id', tenantId: 'tenant-id', organizationId: 'org-id',
    parentTaskId: null, reference: 'TASK-1', title: 'Task', updatedAt: current,
    taskStatusId: 'status-id', statusSlug: 'backlog', isDone: false,
    assigneeStaffMemberId: 'member-id', assigneeUserId: 'human-id', childTaskIds: [],
  }))
  const transactionalEm = { persist: jest.fn(), flush: jest.fn() }
  const context = {
    auth: { sub: 'human-id', tenantId: 'tenant-id', orgId: 'org-id' },
    selectedOrganizationId: 'org-id', organizationIds: ['org-id'], organizationScope: null,
    transactionalEm,
    request: new Request('http://tasks.test', { headers: { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-09-19T11:00:00.000Z' } }),
    container: {
      hasRegistration: jest.fn(() => false),
      resolve: jest.fn((name: string) => {
        if (name === 'moduleConfigService') return { getRecord: async () => null }
        if (name === 'rbacService') return { userHasAllFeatures: async () => true }
        if (name === 'staffTimeTaskMutationService') return { lockTask }
        if (name === 'timeTrackingAccessResolver') return { resolveProjectAccess: async () => ({ canManageAll: true, projectIds: [] }) }
        if (name === 'commandBus') return { execute }
        throw new Error(`unexpected ${name}`)
      }),
    },
  } as unknown as CommandRuntimeContext

  await expect(delegateTaskCommand.execute({ taskId: TASK_ID, agentUserId: AGENT_ID }, context)).rejects.toMatchObject({ status: 409 })
  expect(execute).not.toHaveBeenCalled()
  expect(transactionalEm.persist).not.toHaveBeenCalled()
})
