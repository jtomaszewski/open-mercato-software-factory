import { expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveProjectAccess, type ProjectAccessContext } from '@open-mercato/core/modules/staff/lib/time-tracking/access'
import { aiTools } from '../../ai-tools'
import { createTasksDelegationService } from '../delegationService'
import { delegateTaskCommand } from '../../commands/tasks'

const projectId = '30000000-0000-4000-8000-000000000001'
const taskId = '30000000-0000-4000-8000-000000000002'
const agentId = '30000000-0000-4000-8000-000000000003'
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async () => ({ id: 'member-id' }),
  findWithDecryption: async () => [{ timeProjectId: projectId, assignedStartDate: null, assignedEndDate: '2026-09-18' }],
}))

it('denies expired Staff membership consistently in AI tools, delegation reads and writes', async () => {
  const em = { persist: jest.fn(), flush: jest.fn() } as unknown as EntityManager
  const query = jest.fn(async () => ({ items: [{ id: taskId, time_project_id: projectId, updated_at: '2026-09-19T10:00:00Z' }] }))
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'rbacService') return { userHasAllFeatures: async (_user: string, features: string[]) => !features.includes('staff.timesheets.projects.manage') }
      if (name === 'moduleConfigService') return { getRecord: async (_module: string, key: string) => key === 'access.assignmentGraceDays' ? { value: 0 } : null }
      if (name === 'timeTrackingAccessResolver') return { resolveProjectAccess: (ctx: ProjectAccessContext) => resolveProjectAccess({ ...ctx, now: new Date('2026-09-19T12:00:00Z') }) }
      if (name === 'queryEngine') return { query }
      if (name === 'tasksDelegationService') return createTasksDelegationService({ em })
      if (name === 'staffTimeTaskMutationService') return { lockTask: async () => ({ taskId, timeProjectId: projectId, updatedAt: '2026-09-19T10:00:00Z', childTaskIds: [] }) }
      throw new Error(`unexpected service ${name}`)
    },
  } as unknown as CommandRuntimeContext['container']
  const ctx: CommandRuntimeContext = {
    container, auth: { sub: 'user-id', tenantId: 'tenant-id', orgId: 'org-id' },
    selectedOrganizationId: 'org-id', organizationIds: ['org-id'], organizationScope: null, transactionalEm: em,
  }
  const toolContext: McpToolContext = { container, userId: 'user-id', tenantId: 'tenant-id', organizationId: 'org-id', userFeatures: ['tasks.view'], isSuperAdmin: false }
  const staffAccess = await resolveProjectAccess({ em, userId: 'user-id', tenantId: 'tenant-id', organizationId: 'org-id', canManageAll: false, assignmentGraceDays: 0, now: new Date('2026-09-19T12:00:00Z') })
  expect(staffAccess.projectIds).toEqual([])
  await expect(aiTools.find((tool) => tool.name === 'tasks.get_delegation')!.handler({ taskId }, toolContext)).resolves.toEqual({ found: false })
  await expect(createTasksDelegationService({ em }).getDelegations(ctx, [taskId])).resolves.toEqual([])
  await expect(delegateTaskCommand.execute({ taskId, agentUserId: agentId }, ctx)).rejects.toMatchObject({ status: 403, body: { code: 'project_forbidden' } })
  expect(em.persist).not.toHaveBeenCalled()
})
