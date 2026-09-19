import { describe, expect, it, jest } from '@jest/globals'

jest.mock('@mikro-orm/postgresql', () => ({ LockMode: { PESSIMISTIC_WRITE: 'pessimistic_write' } }))

import { dispatchPersistedQualificationAttempt, type PersistedQualificationAttempt } from '../../lib/qualification-dispatch'
import { CodeRepository, RepositoryQualificationDispatch } from '../../data/entities'

describe('qualification dispatch recovery', () => {
  it('keeps an ambiguously failed attempt running and callback-eligible for retry', async () => {
    const repository = Object.assign(new CodeRepository(), {
      id: '00000000-0000-4000-8000-000000000001',
      configEpoch: 3,
      qualificationAttemptId: '00000000-0000-4000-8000-000000000002',
      qualificationStatus: 'running' as const,
      deletedAt: null,
    })
    const dispatch = Object.assign(new RepositoryQualificationDispatch(), {
      repositoryId: repository.id,
      attemptId: repository.qualificationAttemptId,
      epoch: repository.configEpoch,
      status: 'pending' as const,
    })
    type FakeEntityManager = {
      transactional<T>(operation: (tx: FakeEntityManager) => Promise<T>): Promise<T>
      findOne(entity: unknown): Promise<CodeRepository | RepositoryQualificationDispatch | null>
      flush(): Promise<void>
    }
    const em: FakeEntityManager = {
      async transactional<T>(operation: (tx: typeof em) => Promise<T>): Promise<T> { return operation(em) },
      async findOne(entity: unknown) {
        if (entity === RepositoryQualificationDispatch) return dispatch
        if (entity === CodeRepository) return repository
        return null
      },
      async flush() {},
    }
    const attempt: PersistedQualificationAttempt = {
      repositoryId: repository.id,
      attemptId: dispatch.attemptId,
      epoch: dispatch.epoch,
      request: {
        installationId: '123',
        authorizationId: '00000000-0000-4000-8000-000000000003',
        repositoryId: repository.id,
        githubRepositoryId: '456',
        baseBranch: 'main',
        epoch: dispatch.epoch,
        attemptId: dispatch.attemptId,
        kind: 'pr_only',
        profile: { version: 1, commands: { install: 'yarn', build: 'yarn build', test: 'yarn test' } },
      },
    }
    const broker = { qualify: async () => { throw new Error('ambiguous transport failure') } }

    await expect(dispatchPersistedQualificationAttempt(broker as never, em as never, attempt)).rejects.toThrow('ambiguous transport failure')
    expect(dispatch.status).toBe('failed')
    expect(repository.qualificationStatus).toBe('running')
  })
})
