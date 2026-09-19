import { describe, expect, it, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AgentPrincipal, ProcessDefinition } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'

type Rows = { principals: Record<string, unknown>[]; definitions: Record<string, unknown>[]; users: Record<string, unknown>[] }
const rows: Rows = { principals: [], definitions: [], users: [] }
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async (_em: unknown, entity: unknown) => {
    if (entity === AgentPrincipal) return rows.principals
    if (entity === ProcessDefinition) return rows.definitions
    if (entity === User) return rows.users
    return []
  },
}))

import { TaskDelegation } from '../../data/entities'
import { createTaskDelegationService, deriveTaskRunState } from '../delegationService'

const AGENT_USER = '33333333-3333-4333-8333-333333333333'

function listAgentsContext(): CommandRuntimeContext {
  const rbacService = { userHasAllFeatures: jest.fn(async () => true) }
  return {
    container: {
      hasRegistration: () => true,
      resolve: (name: string) => {
        if (name === 'rbacService') return rbacService
        throw new Error(`unexpected ${name}`)
      },
    },
    auth: { sub: 'user-id', tenantId: 'tenant-id', orgId: 'org-id' },
    selectedOrganizationId: 'org-id',
    organizationIds: ['org-id'],
    organizationScope: null,
  } as unknown as CommandRuntimeContext
}

const TASK_ID = '11111111-1111-4111-8111-111111111111'

function peopleContext(access: { canManageAll: boolean; projectIds: string[] }, denied: string[] = []): CommandRuntimeContext {
  const query = async (entity: string) => {
    if (entity === 'staff:staff_time_task') return { items: [{ id: TASK_ID, time_project_id: 'project-id', parent_task_id: null, updated_at: '2026-09-19T12:00:00.000Z', task_status_id: 'status-id', assignee_staff_member_id: null }] }
    if (entity === 'staff:staff_time_task_status') return { items: [{ slug: 'backlog' }] }
    if (entity === 'staff:staff_team_member') return { items: [{ id: 'member-1', display_name: 'Ola Nowak', user_id: 'user-1' }, { id: 'member-2', display_name: null, user_id: null }] }
    throw new Error(`unexpected entity ${entity}`)
  }
  return {
    container: {
      hasRegistration: () => true,
      resolve: (name: string) => {
        if (name === 'rbacService') {
          return { userHasAllFeatures: async (_id: string, features: string[]) => {
            if (features.some((feature) => denied.includes(feature))) return false
            return features.includes('staff.timesheets.projects.manage') ? access.canManageAll : true
          } }
        }
        if (name === 'queryEngine') return { query }
        if (name === 'timeTrackingAccessResolver') return { resolveProjectAccess: async () => access }
        if (name === 'moduleConfigService') return { getRecord: async () => null }
        throw new Error(`unexpected ${name}`)
      },
    },
    auth: { sub: 'user-id', tenantId: 'tenant-id', orgId: 'org-id' },
    selectedOrganizationId: 'org-id',
    organizationIds: ['org-id'],
    organizationScope: null,
  } as unknown as CommandRuntimeContext
}

function agentRows(options: { agentDefinitionId?: string; definitions?: Record<string, unknown>[] } = {}): void {
  rows.principals = [{ userId: AGENT_USER, agentDefinitionId: options.agentDefinitionId ?? 'developer' }]
  rows.definitions = options.definitions ?? [{ name: 'website_publishing.website_change', triggers: [{ kind: 'manual' }] }]
  rows.users = [{ id: AGENT_USER, name: 'Factory', email: 'factory@example.com' }]
}

function delegation(outcome: TaskDelegation['outcome']): TaskDelegation {
  const item = new TaskDelegation()
  item.outcome = outcome
  item.createdAt = new Date('2026-09-19T10:00:00Z')
  return item
}

describe('tasks delegation service', () => {
  it('reads terminal task outcomes without a process lookup', () => {
    expect(deriveTaskRunState(delegation('done'), null, new Date('2026-09-19T10:02:00Z'))).toBe('complete')
    expect(deriveTaskRunState(delegation('rejected'), null, new Date('2026-09-19T10:02:00Z'))).toBe('rejected')
    expect(deriveTaskRunState(delegation('failed'), null, new Date('2026-09-19T10:02:00Z'))).toBe('failed')
  })

  it('returns no agents when the optional orchestrator module is disabled', async () => {
    const rbacService = { userHasAllFeatures: jest.fn(async () => true) }
    const container = {
      hasRegistration: jest.fn(() => false),
      resolve: jest.fn((name: string) => {
        if (name === 'rbacService') return rbacService
        throw new Error(`unexpected ${name}`)
      }),
    }
    const ctx = {
      container,
      auth: { sub: 'user-id', tenantId: 'tenant-id', orgId: 'org-id' },
      selectedOrganizationId: 'org-id',
      organizationIds: ['org-id'],
      organizationScope: null,
    } as unknown as CommandRuntimeContext
    const service = createTaskDelegationService({ em: {} as EntityManager })
    await expect(service.listAgents(ctx)).resolves.toEqual([])
  })

  it('offers one entry per role when the same agent exists under its current and legacy id', async () => {
    // A mixed rollout can leave both rows behind; the picker must show the role once, under the
    // current id, not the same "Software Engineer" twice.
    agentRows()
    rows.principals = [
      { userId: 'legacy-agent-user', agentDefinitionId: 'factory' },
      { userId: AGENT_USER, agentDefinitionId: 'developer' },
    ]
    rows.users = [
      { id: 'legacy-agent-user', name: 'Factory', email: 'legacy@example.com' },
      { id: AGENT_USER, name: 'Factory', email: 'factory@example.com' },
    ]
    const service = createTaskDelegationService({ em: {} as EntityManager })
    await expect(service.listAgents(listAgentsContext())).resolves.toMatchObject([
      { userId: AGENT_USER, agentId: 'developer' },
    ])
  })

  it('offers a rostered role with its own copy alongside the principal name', async () => {
    agentRows()
    const service = createTaskDelegationService({ em: {} as EntityManager })
    await expect(service.listAgents(listAgentsContext())).resolves.toEqual([{
      userId: AGENT_USER,
      agentId: 'developer',
      name: 'Factory',
      label: 'Software Engineer',
      description: 'Researches, plans and opens a PR',
    }])
  })

  it('does not offer a provisioned principal that no roster row names', async () => {
    agentRows({ agentDefinitionId: 'researcher' })
    const service = createTaskDelegationService({ em: {} as EntityManager })
    await expect(service.listAgents(listAgentsContext())).resolves.toEqual([])
  })

  it('does not offer a roster row whose process cannot be started', async () => {
    agentRows({ definitions: [] })
    const service = createTaskDelegationService({ em: {} as EntityManager })
    await expect(service.listAgents(listAgentsContext())).resolves.toEqual([])
    agentRows({ definitions: [{ name: 'website_publishing.website_change', triggers: [{ kind: 'event' }] }] })
    await expect(service.listAgents(listAgentsContext())).resolves.toEqual([])
  })

  it('lists the active staff members of the caller scope for the picker', async () => {
    const service = createTaskDelegationService({ em: {} as EntityManager })
    await expect(service.listAssignablePeople(peopleContext({ canManageAll: true, projectIds: [] }), TASK_ID)).resolves.toEqual([
      { staffMemberId: 'member-1', name: 'Ola Nowak', userId: 'user-1' },
      { staffMemberId: 'member-2', name: 'member-2', userId: null },
    ])
  })

  it('refuses to enumerate staff to a caller without staff.view', async () => {
    const service = createTaskDelegationService({ em: {} as EntityManager })
    await expect(service.listAssignablePeople(peopleContext({ canManageAll: true, projectIds: [] }, ['staff.view']), TASK_ID))
      .rejects.toMatchObject({ status: 403 })
  })

  it('refuses the people of a task whose project the caller cannot reach', async () => {
    const service = createTaskDelegationService({ em: {} as EntityManager })
    await expect(service.listAssignablePeople(peopleContext({ canManageAll: false, projectIds: ['other-project'] }), TASK_ID))
      .rejects.toMatchObject({ status: 403, body: { code: 'project_forbidden' } })
  })
})
