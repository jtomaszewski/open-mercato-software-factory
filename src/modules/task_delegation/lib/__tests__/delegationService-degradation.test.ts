import { expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation } from '../../data/entities'
import { createTaskDelegationService } from '../delegationService'

const findMany = jest.fn<(entity: unknown) => Promise<unknown[]>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (_em: unknown, entity: unknown) => findMany(entity),
}))
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ warn: jest.fn() }) }),
}))

it('keeps authorized delegation data when optional process reads fail', async () => {
  const delegation = Object.assign(new TaskDelegation(), {
    id: 'delegation-id', taskId: 'task-id', delegateUserId: 'agent-id', processInstanceId: 'process-id',
    links: [], outcome: null, closeReason: null, releasedAt: null,
    createdAt: new Date('2026-09-19T10:00:00Z'), updatedAt: new Date('2026-09-19T10:00:00Z'),
  })
  findMany.mockImplementation(async (entity) => {
    if (entity === TaskDelegation) return [delegation]
    if (entity === ProcessInstance) throw new Error('optional table unavailable')
    if (entity === User) return [{ id: 'agent-id', name: 'Software Engineer' }]
    return []
  })
  const container = {
    hasRegistration: () => true,
    resolve: (name: string) => {
      if (name === 'moduleConfigService') return { getRecord: async () => null }
      if (name === 'rbacService') return { userHasAllFeatures: async () => true }
      if (name === 'timeTrackingAccessResolver') return { resolveProjectAccess: async () => ({ canManageAll: true, projectIds: [] }) }
      if (name === 'queryEngine') return { query: async () => ({ items: [{ id: 'task-id', time_project_id: 'project-id', updated_at: '2026-09-19T10:00:00Z' }] }) }
      throw new Error(`unexpected ${name}`)
    },
  }
  const ctx = {
    container, auth: { sub: 'user-id', tenantId: 'tenant-id', orgId: 'org-id' },
    selectedOrganizationId: 'org-id', organizationIds: ['org-id'], organizationScope: null,
  } as unknown as CommandRuntimeContext
  const result = await createTaskDelegationService({ em: {} as EntityManager }).getDelegations(ctx, ['task-id'])
  expect(result[0]).toMatchObject({
    taskId: 'task-id',
    // `startedAt` is the delegation's creation time; the board chip counts "Pracuje · N min" from it.
    delegation: { id: 'delegation-id', runState: null, startedAt: '2026-09-19T10:00:00.000Z' },
  })
})
