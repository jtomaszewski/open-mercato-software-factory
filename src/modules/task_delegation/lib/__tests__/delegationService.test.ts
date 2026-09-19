import { describe, expect, it, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { TaskDelegation } from '../../data/entities'
import { createTaskDelegationService, deriveTaskRunState } from '../delegationService'

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
})
