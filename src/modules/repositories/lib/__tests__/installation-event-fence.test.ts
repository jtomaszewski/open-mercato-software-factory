import { describe, expect, it } from '@jest/globals'
import { isRepositoryConnectionBindingCurrent, snapshotRepositoryConnectionBinding } from '../installation-event-fence'

function binding() {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    updatedAt: new Date('2026-09-19T12:00:00.000Z'),
    brokerAuthorizationId: '00000000-0000-4000-8000-000000000002',
  }
}

describe('installation event refresh fence', () => {
  it('rejects a deferred refresh after a concurrent suspension changes the connection version', async () => {
    const current = binding()
    const observed = snapshotRepositoryConnectionBinding(current)
    let finishRefresh = () => {}
    const brokerRefresh = new Promise<void>((resolve) => { finishRefresh = resolve })
    const applyRefresh = brokerRefresh.then(() => isRepositoryConnectionBindingCurrent(current, observed))

    current.updatedAt = new Date('2026-09-19T12:00:01.000Z')
    finishRefresh()

    await expect(applyRefresh).resolves.toBe(false)
  })

  it('rejects a deferred refresh after the authorization binding changes', () => {
    const current = binding()
    const observed = snapshotRepositoryConnectionBinding(current)
    current.brokerAuthorizationId = '00000000-0000-4000-8000-000000000003'
    expect(isRepositoryConnectionBindingCurrent(current, observed)).toBe(false)
  })
})
