import { randomUUID } from 'node:crypto'
import { LockMode, type EntityManager } from '@mikro-orm/postgresql'
import { CodeRepository, RepositoryConnection, RepositoryQualificationDispatch } from '../data/entities'
import { RepositoryBrokerError, type RepositoryBroker } from './broker'
import { beginFreshQualificationAttempt } from './qualification-fence'

export const REPOSITORY_BROKER = 'repositoryBroker' as const

export type PersistedQualificationAttempt = {
  repositoryId: string
  attemptId: string
  epoch: number
  request: Parameters<RepositoryBroker['qualify']>[0]
}

export function queueFreshQualificationAttempt(
  em: EntityManager,
  connection: RepositoryConnection,
  repository: CodeRepository,
  startedAt = new Date(),
): PersistedQualificationAttempt {
  const attemptId = randomUUID()
  const attempt = beginFreshQualificationAttempt(repository, attemptId, startedAt)
  em.persist([repository, em.create(RepositoryQualificationDispatch, attempt)])
  return persistedQualificationAttempt(connection, repository, attemptId)
}

export function persistedQualificationAttempt(
  connection: RepositoryConnection,
  repository: CodeRepository,
  attemptId: string,
): PersistedQualificationAttempt {
  return {
    repositoryId: repository.id,
    attemptId,
    epoch: repository.configEpoch,
    request: {
      installationId: connection.installationId,
      authorizationId: connection.brokerAuthorizationId,
      repositoryId: repository.id,
      githubRepositoryId: repository.githubRepositoryId,
      baseBranch: repository.baseBranch,
      epoch: repository.configEpoch,
      attemptId,
      kind: repository.kind,
      profile: repository.profile,
    },
  }
}

export async function dispatchPersistedQualificationAttempt(
  broker: RepositoryBroker,
  em: EntityManager,
  attempt: PersistedQualificationAttempt,
): Promise<void> {
  try {
    await broker.qualify(attempt.request)
    const dispatch = await em.findOne(RepositoryQualificationDispatch, {
      repositoryId: attempt.repositoryId,
      attemptId: attempt.attemptId,
      epoch: attempt.epoch,
    })
    if (!dispatch) throw new Error('[internal] Persisted repository qualification dispatch not found')
    dispatch.status = 'accepted'
    dispatch.lastErrorCode = null
    await em.flush()
  } catch (error) {
    await em.transactional(async (tx) => {
      const dispatch = await tx.findOne(RepositoryQualificationDispatch, {
        repositoryId: attempt.repositoryId,
        attemptId: attempt.attemptId,
        epoch: attempt.epoch,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (dispatch) {
        dispatch.status = 'failed'
        dispatch.lastErrorCode = error instanceof RepositoryBrokerError ? error.code : 'unavailable'
      }
      await tx.flush()
    })
    throw error
  }
}
