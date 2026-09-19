import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'

const readTaskSnapshot = jest.fn<(em: unknown, scope: unknown, input: Record<string, unknown>) => Promise<Record<string, unknown>>>()
jest.mock('../../lib/taskSnapshot', () => ({ readTaskSnapshot }))

import { interceptors } from '../interceptors'
import { authorizeInternalTaskTransition } from '../../lib/columnContext'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const DELEGATION_ID = '22222222-2222-4222-8222-222222222222'

function harness(options?: { active?: boolean; from?: string; to?: string }) {
  readTaskSnapshot.mockResolvedValue({
    taskId: TASK_ID, timeProjectId: 'project-id', tenantId: 'tenant-id', organizationId: 'org-id',
    parentTaskId: null, updatedAt: new Date().toISOString(),
    taskStatusId: 'status-id', statusSlug: options?.from ?? 'in-progress',
    assigneeStaffMemberId: 'member-id', assigneeUserId: 'human-id', childTaskIds: [],
  })
  const delegation: Record<string, unknown> = { id: DELEGATION_ID, taskId: TASK_ID, releasedAt: null }
  const em = {
    find: jest.fn(async (_entity: unknown, _where: unknown) => options?.active === false ? [] : [delegation]),
    findOne: jest.fn(async () => delegation),
    flush: jest.fn(async () => {}),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: () => em }
      if (name === 'queryEngine') return { query: async () => ({ items: [{ slug: options?.to ?? 'done' }] }) }
      throw new Error(`unexpected ${name}`)
    }),
  }
  const auth = { sub: 'human-id', tenantId: 'tenant-id', orgId: 'org-id' }
  const context = (commandId: string, metadata?: Record<string, unknown>) => ({
    commandId, auth, selectedOrganizationId: 'org-id', container, metadata,
  }) as unknown as CommandInterceptorContext
  return { context, auth, em, delegation }
}

const guard = (command: string) => interceptors.find((item) => item.targetCommand === `staff.timesheets.tasks.${command}`)!

beforeEach(() => { readTaskSnapshot.mockReset() })

describe('tasks process-owned interceptors', () => {
  it('does not let a wildcard-authorized human bypass an active delegation', async () => {
    const { context } = harness()
    await expect(guard('delete').beforeExecute?.({ id: TASK_ID }, context('staff.timesheets.tasks.delete')))
      .resolves.toMatchObject({ ok: false, status: 409, body: { code: 'process_owned' } })
  })

  it('filters delegations by tenant and organization only, never by the acting user', async () => {
    const { context, em } = harness()
    await guard('delete').beforeExecute?.({ id: TASK_ID }, context('staff.timesheets.tasks.delete'))
    expect(em.find).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-id', organizationId: 'org-id', taskId: { $in: [TASK_ID] }, releasedAt: null,
    })
  })

  it('fails closed without a tenant, organization and user', async () => {
    const { context } = harness()
    await expect(guard('delete').beforeExecute?.({ id: TASK_ID }, { ...context('staff.timesheets.tasks.delete'), auth: null, selectedOrganizationId: null }))
      .resolves.toMatchObject({ ok: false, body: { code: 'process_owned' } })
  })

  it('resolves undo target from the audit resource instead of commandPayload.id', async () => {
    const { context } = harness()
    await guard('delete').beforeUndo?.({ input: { undo: { before: { id: TASK_ID } } }, logEntry: { resourceId: TASK_ID }, undoToken: 'token' }, context('staff.timesheets.tasks.delete'))
    expect(readTaskSnapshot).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: 'tenant-id', organizationId: 'org-id' }), { taskId: TASK_ID, includeChildren: true, includeDeleted: true })
  })

  it('lets the delegate command move a process-owned task only through the same auth object', async () => {
    const { context, auth } = harness({ from: 'backlog', to: 'in-progress' })
    authorizeInternalTaskTransition({ ...auth }, TASK_ID, 'in-progress')
    await expect(guard('status_change').beforeExecute?.({ id: TASK_ID, taskStatusId: 'in-progress-id' }, context('staff.timesheets.tasks.status_change')))
      .resolves.toMatchObject({ ok: false })
    authorizeInternalTaskTransition(auth, TASK_ID, 'in-progress')
    await expect(guard('status_change').beforeExecute?.({ id: TASK_ID, taskStatusId: 'in-progress-id' }, context('staff.timesheets.tasks.status_change')))
      .resolves.toMatchObject({ ok: true })
  })
})

describe('PUT status transitions', () => {
  it('allows the accountable assignee to close review with terminal release metadata', async () => {
    const { context } = harness({ from: 'in-review', to: 'done' })
    await expect(guard('update').beforeExecute?.({ id: TASK_ID, taskStatusId: 'done-id' }, context('staff.timesheets.tasks.update')))
      .resolves.toMatchObject({ ok: true, metadata: { releaseDelegationId: DELEGATION_ID, releaseOutcome: 'done' } })
  })

  it('releases the delegation after staff commits the assignee close', async () => {
    const { context, em, delegation } = harness({ from: 'in-review', to: 'backlog' })
    await guard('update').afterExecute?.({ id: TASK_ID }, {}, context('staff.timesheets.tasks.update', { releaseDelegationId: DELEGATION_ID, releaseOutcome: 'rejected' }))
    expect(delegation).toMatchObject({ outcome: 'rejected', releasedAt: expect.any(Date) })
    expect(em.flush).toHaveBeenCalled()
  })

  it('does not allow a status update to smuggle title changes onto a delegated task', async () => {
    const { context } = harness({ from: 'in-review', to: 'done' })
    await expect(guard('update').beforeExecute?.({ id: TASK_ID, taskStatusId: 'done-id', title: 'Changed' }, context('staff.timesheets.tasks.update')))
      .resolves.toMatchObject({ ok: false, status: 409 })
  })

  it('accepts an unchanged process column through PUT', async () => {
    const { context } = harness({ from: 'in-progress', to: 'in-progress' })
    await expect(guard('update').beforeExecute?.({ id: TASK_ID, taskStatusId: 'in-progress-id' }, context('staff.timesheets.tasks.update')))
      .resolves.toMatchObject({ ok: true })
  })
})
