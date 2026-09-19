import { describe, expect, it, jest } from '@jest/globals'
import { completeConnectionOnce } from '../connection-completion'
import { ConnectionConsentError, resolveConnectionConsent } from '../connection-consent'

describe('existing repository installation consent', () => {
  it('resolves the stored installation and rejects a forged or mismatched callback value', () => {
    expect(resolveConnectionConsent({ code: 'oauth-code' }, '123')).toEqual({
      kind: 'verify',
      code: 'oauth-code',
      installationId: '123',
    })
    expect(() => resolveConnectionConsent({ code: 'oauth-code', installationId: '999' }, '123'))
      .toThrow(new ConnectionConsentError('installationMismatch'))
    expect(() => resolveConnectionConsent({ code: 'oauth-code' }, null))
      .toThrow(new ConnectionConsentError('invalidReturn'))
  })

  it('retains the new-install and waiting return contracts', () => {
    expect(resolveConnectionConsent({ setupAction: 'install', installationId: '123', code: 'oauth-code' }, null)).toEqual({
      kind: 'verify',
      code: 'oauth-code',
      installationId: '123',
    })
    expect(resolveConnectionConsent({ setupAction: 'request' }, null)).toEqual({ kind: 'waiting' })
  })

  it('coalesces duplicate callback effects into one completion request', async () => {
    const operation = jest.fn(async () => ({ status: 'connected' as const, connectionId: 'connection-1', grantedRepositories: [] }))
    const first = completeConnectionOnce('state-1', operation)
    const second = completeConnectionOnce('state-1', operation)
    await expect(first).resolves.toEqual(await second)
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
