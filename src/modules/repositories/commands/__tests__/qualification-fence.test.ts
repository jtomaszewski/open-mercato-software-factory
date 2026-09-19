import { describe, expect, it } from '@jest/globals'
import { beginFreshQualificationAttempt, canApplyQualificationCallback } from '../../lib/qualification-fence'

const repository = {
  id: 'repository-1',
  connectionId: 'connection-1',
  configEpoch: 4,
  qualificationAttemptId: 'attempt-2',
  qualificationStatus: 'running' as const,
}

describe('qualification callback fence', () => {
  it('accepts only the current connection, epoch, attempt, and running state', () => {
    expect(canApplyQualificationCallback(repository, { connectionId: 'connection-1', epoch: 4, attemptId: 'attempt-2' })).toBe(true)
    expect(canApplyQualificationCallback(repository, { connectionId: 'connection-1', epoch: 3, attemptId: 'attempt-2' })).toBe(false)
    expect(canApplyQualificationCallback(repository, { connectionId: 'connection-1', epoch: 4, attemptId: 'attempt-1' })).toBe(false)
    expect(canApplyQualificationCallback({ ...repository, qualificationStatus: 'passed' }, { connectionId: 'connection-1', epoch: 4, attemptId: 'attempt-2' })).toBe(false)

    const startedAt = new Date('2026-09-19T12:00:00.000Z')
    const fresh = beginFreshQualificationAttempt(repository, 'attempt-3', startedAt)
    expect(fresh).toEqual({ repositoryId: 'repository-1', attemptId: 'attempt-3', epoch: 4 })
    expect(repository).toMatchObject({
      qualificationStatus: 'running',
      qualificationEpoch: 4,
      qualificationAttemptId: 'attempt-3',
      qualificationStartedAt: startedAt,
      qualificationReport: null,
    })
    expect(canApplyQualificationCallback(repository, { connectionId: 'connection-1', epoch: 4, attemptId: 'attempt-2' })).toBe(false)
    expect(canApplyQualificationCallback(repository, { connectionId: 'connection-1', epoch: 4, attemptId: 'attempt-3' })).toBe(true)
  })
})
