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

import { assignTaskCommand } from '../tasks'
import { emitTaskDelegationEvent } from '../../events'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const AGENT_USER = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const OTHER_MEMBER = '44444444-4444-4444-8444-444444444444'
const ALL_FEATURES = ['task_delegation.view', 'task_delegation.delegate', 'staff.timesheets.projects.manage']

type HarnessOptions = {
  assignee?: string | null
  statusSlug?: string
  features?: string[]
  activeDelegation?: Record<string, unknown> | null
  statusChange?: () => Promise<unknown>
  expectedUpdatedAt?: string
}

function harness(options: HarnessOptions = {}) {
  const steps: string[] = []
  const assigneeWrites: (string | null)[] = []
  const state = { assignee: options.assignee === undefined ? null : options.assignee, version: Date.parse('2026-09-19T12:00:00.000Z') }
  readTaskSnapshot.mockImplementation(async () => ({
    taskId: TASK_ID, timeProjectId: 'project-id', tenantId: 'tenant-id', organizationId: 'org-id',
    parentTaskId: null, updatedAt: new Date(state.version).toISOString(), taskStatusId: 'status-id',
    statusSlug: options.statusSlug ?? 'backlog',
    assigneeStaffMemberId: state.assignee,
    assigneeUserId: state.assignee ? `${state.assignee}-user` : null,
    childTaskIds: [],
  }))
  const em = {
    findOne: jest.fn(async () => options.activeDelegation ?? null),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'delegation-id', ...data })),
    persist: jest.fn(() => { steps.push('claim') }),
    flush: jest.fn(async () => { steps.push('flush') }),
    nativeDelete: jest.fn(async () => { steps.push('unclaim'); return 1 }),
  }
  const execute = jest.fn(async (commandId: string, args: { input: Record<string, unknown> }) => {
    steps.push(commandId)
    if (commandId === 'staff.timesheets.tasks.update') {
      const next = (args.input.assigneeStaffMemberId ?? null) as string | null
      assigneeWrites.push(next)
      state.assignee = next
      state.version += 1000
      return { result: {} }
    }
    if (commandId === 'staff.timesheets.tasks.status_change') {
      if (options.statusChange) return options.statusChange()
      state.version += 1000
    }
    return { result: {} }
  })
  const granted = new Set(options.features ?? ALL_FEATURES)
  const columns = ['backlog', 'queued', 'in-design', 'in-progress', 'in-review', 'done', 'closed'].map((slug) => ({ id: `${slug}-id`, slug }))
  const ctx = {
    auth: { sub: 'human-id', tenantId: 'tenant-id', orgId: 'org-id' },
    selectedOrganizationId: 'org-id', organizationIds: ['org-id'], organizationScope: null,
    request: options.expectedUpdatedAt
      ? new Request('http://tasks.test', { headers: { 'x-om-ext-optimistic-lock-expected-updated-at': options.expectedUpdatedAt } })
      : undefined,
    container: {
      hasRegistration: () => true,
      resolve: jest.fn((name: string) => {
        if (name === 'em') return { fork: () => em }
        if (name === 'rbacService') return { userHasAllFeatures: async (_id: string, required: string[]) => required.every((feature) => granted.has(feature)) }
        if (name === 'moduleConfigService') return { getRecord: async () => null }
        if (name === 'timeTrackingAccessResolver') return { resolveProjectAccess: async () => ({ canManageAll: granted.has('staff.timesheets.projects.manage'), projectIds: ['project-id'] }) }
        if (name === 'repositoryTargetResolver') return { resolveForProject: async () => ({ repositoryId: '55555555-5555-4555-8555-555555555555', configEpoch: 1, profileDigest: 'a'.repeat(64) }) }
        if (name === 'queryEngine') return { query: async (entity: string) => entity === 'staff:staff_team_member' ? { items: [{ id: 'actor-member', user_id: 'human-id' }] } : { items: columns } }
        if (name === 'commandBus') return { execute }
        throw new Error(`unexpected ${name}`)
      }),
    },
  } as unknown as CommandRuntimeContext
  return { ctx, em, steps, assigneeWrites, execute }
}

beforeEach(() => {
  readTaskSnapshot.mockReset()
  jest.mocked(emitTaskDelegationEvent).mockClear()
})

describe('one assignment, whichever halves it carries', () => {
  it('assigns a person alone without touching the delegation path', async () => {
    const { ctx, steps, assigneeWrites } = harness({ assignee: OTHER_MEMBER })
    await expect(assignTaskCommand.execute({ taskId: TASK_ID, assigneeStaffMemberId: MEMBER }, ctx)).resolves.toMatchObject({
      taskId: TASK_ID, assigneeStaffMemberId: MEMBER, delegation: null, previousAssigneeStaffMemberId: OTHER_MEMBER, assigneeChanged: true,
    })
    expect(steps).toEqual(['staff.timesheets.tasks.update'])
    expect(assigneeWrites).toEqual([MEMBER])
    expect(emitTaskDelegationEvent).toHaveBeenCalledWith('task_delegation.task.changed', expect.objectContaining({ taskId: TASK_ID }), expect.anything())
  })

  it('records the actor as the accountable owner when only an agent is picked', async () => {
    const { ctx, steps } = harness({ assignee: null })
    await expect(assignTaskCommand.execute({ taskId: TASK_ID, agentUserId: AGENT_USER }, ctx)).resolves.toMatchObject({
      assigneeStaffMemberId: 'actor-member', delegation: { id: 'delegation-id' },
    })
    expect(steps).toEqual(['staff.timesheets.tasks.update', 'claim', 'flush', 'staff.timesheets.tasks.status_change'])
  })

  it('assigns a person and an agent as one act, person first', async () => {
    const { ctx, steps, assigneeWrites } = harness({ assignee: null })
    await expect(assignTaskCommand.execute({ taskId: TASK_ID, assigneeStaffMemberId: MEMBER, agentUserId: AGENT_USER }, ctx)).resolves.toMatchObject({
      assigneeStaffMemberId: MEMBER, delegation: { id: 'delegation-id' }, assigneeChanged: true,
    })
    expect(steps).toEqual(['staff.timesheets.tasks.update', 'claim', 'flush', 'staff.timesheets.tasks.status_change'])
    expect(assigneeWrites).toEqual([MEMBER])
  })

  it('compensates the assignee back when the delegation half fails', async () => {
    const failure = Object.assign(new Error('stale'), { status: 409 })
    const { ctx, steps, assigneeWrites } = harness({ assignee: OTHER_MEMBER, statusChange: async () => { throw failure } })
    await expect(assignTaskCommand.execute({ taskId: TASK_ID, assigneeStaffMemberId: MEMBER, agentUserId: AGENT_USER }, ctx)).rejects.toBe(failure)
    expect(steps).toEqual(['staff.timesheets.tasks.update', 'claim', 'flush', 'staff.timesheets.tasks.status_change', 'unclaim', 'staff.timesheets.tasks.update'])
    expect(assigneeWrites).toEqual([MEMBER, OTHER_MEMBER])
  })

  it('surfaces why the delegation failed even when the compensation fails too', async () => {
    const failure = Object.assign(new Error('stale'), { status: 409 })
    const { ctx, execute } = harness({ assignee: OTHER_MEMBER, statusChange: async () => { throw failure } })
    let updates = 0
    jest.mocked(execute).mockImplementation(async (commandId: string) => {
      if (commandId === 'staff.timesheets.tasks.update' && ++updates === 2) throw new Error('process_owned')
      if (commandId === 'staff.timesheets.tasks.status_change') throw failure
      return { result: {} }
    })
    await expect(assignTaskCommand.execute({ taskId: TASK_ID, assigneeStaffMemberId: MEMBER, agentUserId: AGENT_USER }, ctx)).rejects.toBe(failure)
  })

  it('refuses a stale task version before writing anything', async () => {
    const { ctx, steps } = harness({ assignee: OTHER_MEMBER, expectedUpdatedAt: '2026-09-19T11:00:00.000Z' })
    await expect(assignTaskCommand.execute({ taskId: TASK_ID, assigneeStaffMemberId: MEMBER }, ctx)).rejects.toMatchObject({ status: 409 })
    expect(steps).toEqual([])
  })

  it('refuses to clear the human owner while an agent is picked', async () => {
    const { ctx, steps } = harness({ assignee: OTHER_MEMBER })
    await expect(assignTaskCommand.execute({ taskId: TASK_ID, assigneeStaffMemberId: null, agentUserId: AGENT_USER }, ctx))
      .rejects.toMatchObject({ status: 422, body: { code: 'assignee_required' } })
    expect(steps).toEqual([])
  })
})

describe('the assignment ACL matrix', () => {
  it('lets a colleague without task_delegation.delegate assign a person', async () => {
    const { ctx } = harness({ assignee: null, features: ['task_delegation.view', 'staff.timesheets.projects.manage'] })
    await expect(assignTaskCommand.execute({ taskId: TASK_ID, assigneeStaffMemberId: MEMBER }, ctx)).resolves.toMatchObject({ assigneeStaffMemberId: MEMBER })
  })

  it('refuses the same caller an agent', async () => {
    const { ctx, steps } = harness({ assignee: MEMBER, features: ['task_delegation.view', 'staff.timesheets.projects.manage'] })
    await expect(assignTaskCommand.execute({ taskId: TASK_ID, agentUserId: AGENT_USER }, ctx)).rejects.toMatchObject({ status: 403 })
    expect(steps).toEqual([])
  })

  it('refuses a caller without task_delegation.view at all', async () => {
    const { ctx } = harness({ assignee: MEMBER, features: ['staff.timesheets.projects.manage'] })
    await expect(assignTaskCommand.execute({ taskId: TASK_ID, assigneeStaffMemberId: OTHER_MEMBER }, ctx)).rejects.toMatchObject({ status: 403 })
  })
})

describe('undo restores both halves', () => {
  it('un-delegates and puts the previous assignee back', async () => {
    const active = { id: 'delegation-id', taskId: TASK_ID, processInstanceId: null, releasedAt: null }
    const { ctx, steps, assigneeWrites } = harness({ assignee: MEMBER, statusSlug: 'queued', activeDelegation: active })
    await assignTaskCommand.undo?.({
      ctx,
      logEntry: { payload: { undo: { taskId: TASK_ID, previousAssigneeStaffMemberId: OTHER_MEMBER, assigneeChanged: true, delegationId: 'delegation-id' } } },
    } as never)
    expect(steps).toEqual(['staff.timesheets.tasks.status_change', 'flush', 'staff.timesheets.tasks.update'])
    expect(assigneeWrites).toEqual([OTHER_MEMBER])
    expect(active.releasedAt).toBeInstanceOf(Date)
    // The restored owner is announced, exactly as the assignment was.
    expect(emitTaskDelegationEvent).toHaveBeenCalledWith('task_delegation.task.changed', expect.objectContaining({ taskId: TASK_ID }), expect.anything())
  })

  it('leaves the assignee alone when the act only added an agent', async () => {
    const active = { id: 'delegation-id', taskId: TASK_ID, processInstanceId: null, releasedAt: null }
    const { ctx, assigneeWrites } = harness({ assignee: MEMBER, statusSlug: 'queued', activeDelegation: active })
    await assignTaskCommand.undo?.({
      ctx,
      logEntry: { payload: { undo: { taskId: TASK_ID, previousAssigneeStaffMemberId: null, assigneeChanged: false, delegationId: 'delegation-id' } } },
    } as never)
    expect(assigneeWrites).toEqual([])
  })
})
