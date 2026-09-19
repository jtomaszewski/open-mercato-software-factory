import type { CodeRepository } from '../data/entities'

type QualificationAttemptState = Pick<CodeRepository,
  'id' | 'configEpoch' | 'qualificationStatus' | 'qualificationEpoch' | 'qualificationAttemptId'
  | 'qualificationStartedAt' | 'qualificationReport'>

export function beginFreshQualificationAttempt(
  repository: QualificationAttemptState,
  attemptId: string,
  startedAt: Date,
): { repositoryId: string; attemptId: string; epoch: number } {
  repository.qualificationStatus = 'running'
  repository.qualificationEpoch = repository.configEpoch
  repository.qualificationAttemptId = attemptId
  repository.qualificationStartedAt = startedAt
  repository.qualificationReport = null
  return { repositoryId: repository.id, attemptId, epoch: repository.configEpoch }
}

export function canApplyQualificationCallback(repository: Pick<CodeRepository, 'qualificationStatus' | 'qualificationAttemptId' | 'configEpoch' | 'connectionId'>, input: {
  connectionId: string
  epoch: number
  attemptId: string
}): boolean {
  return repository.connectionId === input.connectionId
    && repository.configEpoch === input.epoch
    && repository.qualificationAttemptId === input.attemptId
    && repository.qualificationStatus === 'running'
}
