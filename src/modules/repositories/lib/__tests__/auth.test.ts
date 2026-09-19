import { describe, expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { requireRepositoryScope } from '../auth'

function context(input: { kind: 'human' | 'agent'; featureAllowed?: boolean }): CommandRuntimeContext {
  const em = { fork: () => em, findOne: jest.fn(async () => ({ id: '00000000-0000-4000-8000-000000000001', kind: input.kind })) }
  const rbac = { userHasAllFeatures: jest.fn(async () => input.featureAllowed !== false) }
  return {
    auth: { sub: '00000000-0000-4000-8000-000000000001', tenantId: '00000000-0000-4000-8000-000000000002', orgId: '00000000-0000-4000-8000-000000000003' },
    selectedOrganizationId: '00000000-0000-4000-8000-000000000003',
    organizationIds: ['00000000-0000-4000-8000-000000000003'],
    container: { resolve: (name: string) => name === 'em' ? em : rbac },
  } as unknown as CommandRuntimeContext
}

describe('repository command scope', () => {
  it('uses the wildcard-aware RBAC service and returns trusted scope', async () => {
    await expect(requireRepositoryScope(context({ kind: 'human' }), 'repositories.manage')).resolves.toEqual({
      userId: '00000000-0000-4000-8000-000000000001',
      tenantId: '00000000-0000-4000-8000-000000000002',
      organizationId: '00000000-0000-4000-8000-000000000003',
    })
  })

  it('applies the same human-principal check to read-route feature arrays', async () => {
    await expect(requireRepositoryScope(context({ kind: 'agent' }), ['repositories.view'])).rejects.toMatchObject({
      status: 403,
      body: { code: 'agent_forbidden' },
    })
  })

  it('denies agent principals even when RBAC grants the feature', async () => {
    await expect(requireRepositoryScope(context({ kind: 'agent' }), 'repositories.manage')).rejects.toMatchObject({ status: 403, body: { code: 'agent_forbidden' } })
  })

  it('denies a missing concrete feature', async () => {
    await expect(requireRepositoryScope(context({ kind: 'human', featureAllowed: false }), 'repositories.manage')).rejects.toMatchObject({ status: 403, body: { code: 'forbidden' } })
  })
})
