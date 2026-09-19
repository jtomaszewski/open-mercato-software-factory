import { describe, expect, it, jest } from '@jest/globals'
import { setup } from '../setup'
import { REPOSITORIES_RECOVERY_QUEUE } from '../lib/recovery-queue'

describe('repository recovery schedule', () => {
  it('registers the discovered scoped worker on every default seed', async () => {
    const register = jest.fn(async (_registration: Record<string, unknown>) => {})
    await setup.seedDefaults?.({
      container: { resolve: () => ({ register }) },
      tenantId: '00000000-0000-4000-8000-000000000001',
      organizationId: '00000000-0000-4000-8000-000000000002',
    } as never)

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      scopeType: 'organization',
      tenantId: '00000000-0000-4000-8000-000000000001',
      organizationId: '00000000-0000-4000-8000-000000000002',
      scheduleType: 'interval',
      scheduleValue: '1m',
      targetType: 'queue',
      targetQueue: REPOSITORIES_RECOVERY_QUEUE,
      isEnabled: true,
    }))
  })

  it('surfaces a missing scheduler registration instead of silently skipping recovery', async () => {
    await expect(setup.seedDefaults?.({
      container: { resolve: () => { throw new Error('scheduler missing') } },
      tenantId: '00000000-0000-4000-8000-000000000001',
      organizationId: '00000000-0000-4000-8000-000000000002',
    } as never)).rejects.toThrow('scheduler missing')
  })
})
