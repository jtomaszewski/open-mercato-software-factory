import { describe, expect, it } from '@jest/globals'
import { applyAuthoritativeProviderGrant, shouldRequalifyAfterProviderGrant } from '../provider-state'

describe('provider grant reconciliation', () => {
  it('never re-enables a repository disabled by an administrator', () => {
    const repository = { githubRepositoryId: '12', fullName: 'old/name', accessStatus: 'unavailable' as const, status: 'disabled' as const }
    const previousAccessStatus = repository.accessStatus
    applyAuthoritativeProviderGrant(repository, { id: '12', fullName: 'new/name' })
    expect(repository).toEqual({ githubRepositoryId: '12', fullName: 'new/name', accessStatus: 'granted', status: 'disabled' })
    expect(shouldRequalifyAfterProviderGrant(previousAccessStatus, repository.accessStatus)).toBe(true)
  })

  it('marks a missing authoritative grant unavailable without changing admin state', () => {
    const repository = { githubRepositoryId: '12', fullName: 'org/repo', accessStatus: 'granted' as const, status: 'active' as const }
    applyAuthoritativeProviderGrant(repository, null)
    expect(repository.accessStatus).toBe('unavailable')
    expect(repository.status).toBe('active')
  })

  it('requalifies only when authoritative consent restores a previously unavailable grant', () => {
    expect(shouldRequalifyAfterProviderGrant('unavailable', 'granted')).toBe(true)
    expect(shouldRequalifyAfterProviderGrant('granted', 'granted')).toBe(false)
    expect(shouldRequalifyAfterProviderGrant('unavailable', 'unavailable')).toBe(false)
  })
})
