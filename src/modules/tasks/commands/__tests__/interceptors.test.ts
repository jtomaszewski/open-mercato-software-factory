import { describe, expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { interceptors } from '../interceptors'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const DELEGATION_ID = '22222222-2222-4222-8222-222222222222'

function harness(options?: { active?: boolean; from?: string; to?: string }) {
  const lockTask = jest.fn<(ctx: CommandRuntimeContext, input: Record<string, unknown>) => Promise<Record<string, unknown>>>(async () => ({
    taskId: TASK_ID, timeProjectId: 'project-id', tenantId: 'tenant-id', organizationId: 'org-id',
    parentTaskId: null, reference: 'TASK-1', title: 'Task', updatedAt: new Date().toISOString(),
    taskStatusId: 'status-id', statusSlug: options?.from ?? 'in-progress', isDone: false,
    assigneeStaffMemberId: 'member-id', assigneeUserId: 'human-id', childTaskIds: [],
  }))
  const em = { find: jest.fn(async () => options?.active === false ? [] : [{ id: DELEGATION_ID, taskId: TASK_ID }]) }
  const rbacService = { userHasAllFeatures: jest.fn(async () => true) }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'staffTimeTaskMutationService') return { lockTask }
      if (name === 'queryEngine') return { query: async () => ({ items: [{ slug: options?.to ?? 'done' }] }) }
      if (name === 'rbacService') return rbacService
      throw new Error(`unexpected ${name}`)
    }),
  }
  const commandContext = {
    container, auth: { sub: 'human-id', tenantId: 'tenant-id', orgId: 'org-id', kind: 'human' },
    selectedOrganizationId: 'org-id', organizationIds: ['org-id'], organizationScope: null,
    transactionalEm: em,
  } as unknown as CommandRuntimeContext
  return { commandContext, lockTask, em }
}

describe('tasks process-owned interceptors', () => {
  it('does not let a wildcard-authorized human bypass an active delegation', async () => {
    const { commandContext } = harness()
    const interceptor = interceptors.find((item) => item.targetCommand === 'staff.timesheets.tasks.delete')!
    await expect(interceptor.beforeExecute?.({ id: TASK_ID }, {
      commandId: interceptor.targetCommand, auth: commandContext.auth, selectedOrganizationId: 'org-id',
      container: commandContext.container, commandContext,
    })).resolves.toMatchObject({ ok: false, status: 409, body: { code: 'process_owned' } })
  })

  it('resolves undo target from the audit resource instead of commandPayload.id', async () => {
    const { commandContext, lockTask } = harness()
    const interceptor = interceptors.find((item) => item.targetCommand === 'staff.timesheets.tasks.delete')!
    await interceptor.beforeUndo?.({ input: { undo: { before: { id: TASK_ID } } }, logEntry: { resourceId: TASK_ID }, undoToken: 'token' }, {
      commandId: interceptor.targetCommand, auth: commandContext.auth, selectedOrganizationId: 'org-id',
      container: commandContext.container, commandContext,
    })
    expect(lockTask).toHaveBeenCalledWith(commandContext, { taskId: TASK_ID, includeChildren: true, includeDeleted: true })
  })
})

describe('PUT status transitions', () => {
  it('allows the accountable assignee to close review with terminal release metadata', async () => {
    const { commandContext } = harness({ from: 'in-review', to: 'done' })
    const guard = interceptors.find((entry) => entry.targetCommand === 'staff.timesheets.tasks.update')!
    await expect(guard.beforeExecute?.({ id: TASK_ID, taskStatusId: 'done-id' }, {
      selectedOrganizationId: 'org-id', commandId: guard.targetCommand, auth: commandContext.auth, container: commandContext.container, commandContext,
    })).resolves.toMatchObject({ ok: true, metadata: { releaseDelegationId: DELEGATION_ID, releaseOutcome: 'done' } })
  })
  it('does not allow a status update to smuggle title changes onto a delegated task', async () => {
    const { commandContext } = harness({ from: 'in-review', to: 'done' })
    const guard = interceptors.find((entry) => entry.targetCommand === 'staff.timesheets.tasks.update')!
    await expect(guard.beforeExecute?.({ id: TASK_ID, taskStatusId: 'done-id', title: 'Changed' }, {
      selectedOrganizationId: 'org-id', commandId: guard.targetCommand, auth: commandContext.auth, container: commandContext.container, commandContext,
    })).resolves.toMatchObject({ ok: false, status: 409 })
  })
  it('accepts an unchanged process column through PUT', async () => {
    const { commandContext } = harness({ from: 'queued', to: 'queued' })
    const guard = interceptors.find((entry) => entry.targetCommand === 'staff.timesheets.tasks.update')!
    await expect(guard.beforeExecute?.({ id: TASK_ID, taskStatusId: 'queued-id' }, {
      selectedOrganizationId: 'org-id', commandId: guard.targetCommand, auth: commandContext.auth, container: commandContext.container, commandContext,
    })).resolves.toMatchObject({ ok: true })
  })
})
