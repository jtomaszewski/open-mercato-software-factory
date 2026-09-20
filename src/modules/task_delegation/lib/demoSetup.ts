import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { systemContext, type TaskDelegationScope } from './systemContext'
import { DEVELOPER_AGENT_DISPLAY_NAME, DEVELOPER_AGENT_ID, DEVELOPER_AGENT_IDS } from './agentIdentity'

/** @deprecated Prefer `TaskDelegationScope`; kept as an alias so existing importers keep working. */
export type TaskDelegationDemoScope = TaskDelegationScope

// Re-exported for the importers that already reach for these here.
export { DEVELOPER_AGENT_DISPLAY_NAME, DEVELOPER_AGENT_ID }

export type TaskDelegationDemoResult = {
  customerId: string
  staffMemberId: string | null
  projectId: string
  agentUserId: string | null
}

export const DEMO_CUSTOMER_NAME = 'Internal'
/**
 * The project the website work lands on. Named for what it is — the site — because its code is
 * what the board prints on every task reference ("WWW-1"), in front of the audience.
 */
export const DEMO_PROJECT_CODE = 'WWW'
export const DEMO_PROJECT_NAME = 'www'

type AgentPrincipalService = {
  resolve(scope: TaskDelegationDemoScope, agentDefinitionId: string): Promise<{ userId: string } | null>
  provision(scope: TaskDelegationDemoScope, input: { agentDefinitionId: string; displayName?: string; roleFeatures?: string[] }): Promise<{ userId: string }>
}

async function firstId(qe: QueryEngine, entity: string, filters: Record<string, unknown>, scope: TaskDelegationDemoScope): Promise<string | null> {
  const rows = await qe.query<{ id: string }>(entity, {
    fields: ['id'], filters, page: { page: 1, pageSize: 1 },
    tenantId: scope.tenantId, organizationId: scope.organizationId,
  })
  return rows.items[0]?.id ?? null
}

/** The organization's earliest human user: the admin `mercato init` created. */
async function resolveAdminUser(em: EntityManager, scope: TaskDelegationDemoScope, email?: string): Promise<User | null> {
  const users = await findWithDecryption(em, User, { ...scope, deletedAt: null }, { orderBy: { createdAt: 'asc' } }, scope)
  const humans = users.filter((user) => user.kind !== 'agent')
  const match = email ? humans.find((user) => user.email?.toLowerCase() === email.toLowerCase()) : humans[0]
  return match ?? null
}

/**
 * Seeds the delegation board (SPEC-002 Phase 1 step 1): an "Internal" customer company, a staff
 * member for the admin, a `DEMO` project on staff's default columns, and the `developer` agent
 * principal. Writes go through the owning modules' commands and services; every step is
 * find-or-create, so repeated runs change nothing and never overwrite operator edits.
 */
export async function seedTaskDelegationDemo(
  container: AwilixContainer,
  scope: TaskDelegationDemoScope,
  options: { adminEmail?: string } = {},
): Promise<TaskDelegationDemoResult> {
  const em = (container.resolve('em') as EntityManager).fork()
  const qe = container.resolve<QueryEngine>('queryEngine')
  const bus = container.resolve<CommandBus>('commandBus')
  const ctx = systemContext(container, scope)

  // display_name is encrypted at rest, so match on the decrypted rows rather than in SQL.
  const companies = await qe.query<{ id: string; display_name: string | null }>('customers:customer_entity', {
    fields: ['id', 'display_name'], filters: { kind: 'company' }, page: { page: 1, pageSize: 500 },
    tenantId: scope.tenantId, organizationId: scope.organizationId,
  })
  let customerId = companies.items.find((row) => row.display_name === DEMO_CUSTOMER_NAME)?.id ?? null
  if (!customerId) {
    const { result } = await bus.execute<Record<string, unknown>, { entityId: string }>('customers.companies.create', {
      input: { ...scope, displayName: DEMO_CUSTOMER_NAME }, ctx,
    })
    customerId = result.entityId
  }

  const admin = await resolveAdminUser(em, scope, options.adminEmail)
  const adminUserId = admin?.id ?? null
  let staffMemberId: string | null = null
  if (admin) {
    staffMemberId = await firstId(qe, 'staff:staff_team_member', { user_id: admin.id }, scope)
    if (!staffMemberId) {
      const { result } = await bus.execute<Record<string, unknown>, { memberId: string }>('staff.team-members.create', {
        input: { ...scope, displayName: admin.name || admin.email, userId: admin.id }, ctx,
      })
      staffMemberId = result.memberId
    }
  }

  let projectId = await firstId(qe, 'staff:staff_time_project', { code: DEMO_PROJECT_CODE }, scope)
  if (!projectId) {
    const { result } = await bus.execute<Record<string, unknown>, { timeProjectId: string }>('staff.timesheets.time_projects.create', {
      input: { ...scope, name: DEMO_PROJECT_NAME, code: DEMO_PROJECT_CODE, customerId, ownerUserId: adminUserId }, ctx,
    })
    projectId = result.timeProjectId
    if (staffMemberId) {
      await bus.execute('staff.timesheets.time_project_members.assign', {
        input: { ...scope, timeProjectId: projectId, staffMemberId, assignedStartDate: new Date() }, ctx,
      })
    }
  }

  let agentUserId: string | null = null
  const hasRegistration = (container as { hasRegistration?: (name: string) => boolean }).hasRegistration
  if (typeof hasRegistration === 'function' && hasRegistration.call(container, 'agentPrincipalService')) {
    const service = container.resolve<AgentPrincipalService>('agentPrincipalService')
    // A database seeded before the id was renamed already has this agent under its old id, with
    // its delegation history; reuse it rather than provisioning a second one beside it.
    for (const agentDefinitionId of DEVELOPER_AGENT_IDS) {
      const existing = await service.resolve(scope, agentDefinitionId)
      if (existing) {
        agentUserId = existing.userId
        break
      }
    }
    if (!agentUserId) {
      const principal = await service.provision(scope, {
        agentDefinitionId: DEVELOPER_AGENT_ID,
        displayName: DEVELOPER_AGENT_DISPLAY_NAME,
        roleFeatures: ['task_delegation.view', 'task_delegation.process'],
      })
      agentUserId = principal.userId
    }
  }

  return { customerId, staffMemberId, projectId, agentUserId }
}
