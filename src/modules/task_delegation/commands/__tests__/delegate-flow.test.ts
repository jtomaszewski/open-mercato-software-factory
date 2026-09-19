import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AgentPrincipal, ProcessDefinition } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'

const readTaskSnapshot = jest.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>()
jest.mock('../../lib/taskSnapshot', () => ({ readTaskSnapshot }))
jest.mock('../../events', () => ({ emitTaskDelegationEvent: jest.fn(async () => {}) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (_em: unknown, entity: unknown) => {
    if (entity === User) return { id: 'agent-user' }
    if (entity === AgentPrincipal) return { agentDefinitionId: 'factory' }
    if (entity === ProcessDefinition) return { id: 'definition-id', triggers: [{ kind: 'manual' }] }
    return null
  },
}))

import { delegateTaskCommand, undelegateTaskCommand } from '../tasks'
import { emitTaskDelegationEvent } from '../../events'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const AGENT_ID = '22222222-2222-4222-8222-222222222222'

function harness(options: { statusChange?: () => Promise<unknown>; statusSlug?: string; active?: Record<string, unknown> | null } = {}) {
  const steps: string[] = []
  readTaskSnapshot.mockResolvedValue({
    taskId: TASK_ID, timeProjectId: 'project-id', tenantId: 'tenant-id', organizationId: 'org-id',
    parentTaskId: null, updatedAt: '2026-09-19T12:00:00.000Z', taskStatusId: 'status-id',
    statusSlug: options.statusSlug ?? 'backlog', assigneeStaffMemberId: 'member-id', assigneeUserId: 'human-id', childTaskIds: [],
  })
  const em = {
    findOne: jest.fn(async () => options.active ?? null),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'delegation-id', ...data })),
    persist: jest.fn(() => { steps.push('claim') }),
    flush: jest.fn(async () => { steps.push('flush') }),
    nativeDelete: jest.fn(async () => { steps.push('unclaim'); return 1 }),
  }
  const execute = jest.fn(async (commandId: string) => {
    steps.push(commandId)
    if (commandId === 'staff.timesheets.tasks.status_change' && options.statusChange) return options.statusChange()
    return { result: {} }
  })
  const columns = ['backlog', 'in-progress', 'in-review', 'done'].map((slug) => ({ id: `${slug}-id`, slug }))
  const ctx = {
    auth: { sub: 'human-id', tenantId: 'tenant-id', orgId: 'org-id' },
    selectedOrganizationId: 'org-id', organizationIds: ['org-id'], organizationScope: null,
    container: {
      hasRegistration: () => true,
      resolve: jest.fn((name: string) => {
        if (name === 'em') return { fork: () => em }
        if (name === 'rbacService') return { userHasAllFeatures: async () => true }
        if (name === 'moduleConfigService') return { getRecord: async () => null }
        if (name === 'timeTrackingAccessResolver') return { resolveProjectAccess: async () => ({ canManageAll: true, projectIds: [] }) }
        if (name === 'queryEngine') return { query: async (_entity: string, query: { filters: { slug?: string } }) => ({ items: columns.filter((column) => !query.filters.slug || column.slug === query.filters.slug) }) }
        if (name === 'commandBus') return { execute }
        throw new Error(`unexpected ${name}`)
      }),
    },
  } as unknown as CommandRuntimeContext
  return { ctx, em, steps }
}

beforeEach(() => {
  readTaskSnapshot.mockReset()
  jest.mocked(emitTaskDelegationEvent).mockClear()
})

describe('delegate without a shared transaction', () => {
  it('claims the delegation before moving the task, then announces it', async () => {
    const { ctx, steps } = harness()
    await expect(delegateTaskCommand.execute({ taskId: TASK_ID, agentUserId: AGENT_ID }, ctx)).resolves.toEqual({ taskId: TASK_ID, delegationId: 'delegation-id' })
    expect(steps).toEqual(['claim', 'flush', 'staff.timesheets.tasks.status_change'])
    expect(emitTaskDelegationEvent).toHaveBeenCalledWith('task_delegation.task.delegated', expect.objectContaining({ delegationId: 'delegation-id' }), expect.anything())
  })

  it('drops the claim and announces nothing when the staff move fails', async () => {
    const failure = Object.assign(new Error('stale'), { status: 409 })
    const { ctx, steps } = harness({ statusChange: async () => { throw failure } })
    await expect(delegateTaskCommand.execute({ taskId: TASK_ID, agentUserId: AGENT_ID }, ctx)).rejects.toBe(failure)
    expect(steps).toEqual(['claim', 'flush', 'staff.timesheets.tasks.status_change', 'unclaim'])
    expect(emitTaskDelegationEvent).not.toHaveBeenCalled()
  })
})

describe('undelegate without a shared transaction', () => {
  it('moves the task back before releasing the delegation', async () => {
    const active = { id: 'delegation-id', taskId: TASK_ID, processInstanceId: null, releasedAt: null }
    const { ctx, steps } = harness({ statusSlug: 'in-progress', active })
    await expect(undelegateTaskCommand.execute({ taskId: TASK_ID }, ctx)).resolves.toMatchObject({ released: true })
    expect(steps).toEqual(['staff.timesheets.tasks.status_change', 'flush'])
    expect(active.releasedAt).toBeInstanceOf(Date)
  })

  it('only releases when a previous attempt already moved the task to Backlog', async () => {
    const active = { id: 'delegation-id', taskId: TASK_ID, processInstanceId: null, releasedAt: null }
    const { ctx, steps } = harness({ statusSlug: 'backlog', active })
    await undelegateTaskCommand.execute({ taskId: TASK_ID }, ctx)
    expect(steps).toEqual(['flush'])
  })
})
