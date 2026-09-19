import { describe, expect, it, jest } from '@jest/globals'

jest.mock('@mikro-orm/postgresql', () => ({ LockMode: { PESSIMISTIC_WRITE: 'pessimistic_write' } }))

import { repositoryCommands } from '../repositories'
import { CodeRepository, RepositoryConnection, RepositoryQualificationDispatch } from '../../data/entities'

const ORIGINAL_UPDATED_AT = new Date('2026-09-19T12:00:00.000Z')

type FakeEntityManager = {
  fork(): FakeEntityManager
  transactional<T>(operation: (tx: FakeEntityManager) => Promise<T>): Promise<T>
  findOne(entity: { name?: string }, where: Record<string, unknown>): Promise<unknown>
  create<T extends object>(entity: new () => T, input: object): T
  persist(values: unknown | unknown[]): void
  flush(): Promise<void>
}

function createHarness() {
  const repository = Object.assign(new CodeRepository(), {
    id: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-000000000002',
    organizationId: '00000000-0000-4000-8000-000000000003',
    connectionId: '00000000-0000-4000-8000-000000000004',
    githubRepositoryId: '123',
    fullName: 'acme/site',
    baseBranch: 'main',
    kind: 'pr_only' as const,
    profile: { version: 1, commands: { install: 'yarn', build: 'yarn build', test: 'yarn test' } },
    updatedAt: ORIGINAL_UPDATED_AT,
    deletedAt: null,
  })
  const connection = Object.assign(new RepositoryConnection(), {
    id: repository.connectionId,
    tenantId: repository.tenantId,
    organizationId: repository.organizationId,
    installationId: '456',
    brokerAuthorizationId: '00000000-0000-4000-8000-000000000005',
    accountLogin: 'acme',
    connectedBy: '00000000-0000-4000-8000-000000000006',
    deletedAt: null,
  })
  const dispatches: RepositoryQualificationDispatch[] = []
  let transactionTail = Promise.resolve()
  let transactionActive = false
  let refreshCount = 0
  let releaseRefresh = () => {}
  const bothRefreshing = new Promise<void>((resolve) => { releaseRefresh = resolve })

  const em: FakeEntityManager = {
    fork: () => em,
    async transactional<T>(operation: (tx: FakeEntityManager) => Promise<T>): Promise<T> {
      let releaseTransaction = () => {}
      const previous = transactionTail
      transactionTail = new Promise<void>((resolve) => { releaseTransaction = resolve })
      await previous
      transactionActive = true
      try {
        return await operation(em)
      } finally {
        transactionActive = false
        releaseTransaction()
      }
    },
    async findOne(entity: { name?: string }, where: Record<string, unknown>) {
      if (entity.name === 'User') return { id: connection.connectedBy, kind: 'human' }
      if (entity === CodeRepository) {
        if (where.id !== repository.id || repository.deletedAt) return null
        return repository
      }
      if (entity === RepositoryConnection) return connection
      if (entity === RepositoryQualificationDispatch) {
        return dispatches.find((dispatch) => dispatch.attemptId === where.attemptId) ?? null
      }
      return null
    },
    create<T extends object>(entity: new () => T, input: object): T {
      return Object.assign(new entity(), input)
    },
    persist(values: unknown | unknown[]) {
      for (const value of Array.isArray(values) ? values : [values]) {
        if (value instanceof RepositoryQualificationDispatch && !dispatches.includes(value)) dispatches.push(value)
      }
    },
    async flush() {
      if (transactionActive && repository.baseBranch !== 'main' && repository.updatedAt === ORIGINAL_UPDATED_AT) {
        repository.updatedAt = new Date('2026-09-19T12:00:01.000Z')
      }
    },
  }

  const broker = {
    isConfigured: () => true,
    buildInstallUrl: () => '',
    buildAuthorizeUrl: () => '',
    verifyInstallation: async () => { throw new Error('unused') },
    async refreshInstallation() {
      refreshCount += 1
      if (refreshCount === 2) releaseRefresh()
      await bothRefreshing
      return {
        installationId: connection.installationId,
        authorizationId: connection.brokerAuthorizationId,
        accountLogin: connection.accountLogin,
        repositories: [{ id: repository.githubRepositoryId, fullName: repository.fullName, defaultBranch: repository.baseBranch }],
      }
    },
    async listBranches() { return ['main', 'develop', 'release'] },
    async qualify() {},
  }
  const container = {
    resolve(name: string) {
      if (name === 'em') return em
      if (name === 'repositoryBroker') return broker
      if (name === 'rbacService') return { userHasAllFeatures: async () => true }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
  const context = {
    container,
    auth: { sub: connection.connectedBy, tenantId: repository.tenantId, orgId: repository.organizationId },
    selectedOrganizationId: repository.organizationId,
    organizationIds: [repository.organizationId],
    request: new Request('http://repositories.internal/', { method: 'PUT' }),
  }
  return { context, repository }
}

describe('repository optimistic locking', () => {
  it('allows only one of two concurrent updates carrying the same version', async () => {
    const { context } = createHarness()
    const first = repositoryCommands.updateRepositoryCommand.execute({
      id: '00000000-0000-4000-8000-000000000001',
      baseBranch: 'develop',
      kind: 'pr_only',
      profile: { version: 1, commands: { install: 'yarn', build: 'yarn build', test: 'yarn test' } },
      updatedAt: ORIGINAL_UPDATED_AT.toISOString(),
    }, context as never)
    const second = repositoryCommands.updateRepositoryCommand.execute({
      id: '00000000-0000-4000-8000-000000000001',
      baseBranch: 'release',
      kind: 'pr_only',
      profile: { version: 1, commands: { install: 'yarn', build: 'yarn build', test: 'yarn test' } },
      updatedAt: ORIGINAL_UPDATED_AT.toISOString(),
    }, context as never)

    const results = await Promise.allSettled([first, second])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
  })

  it('refuses status undo after a later edit changed the post-write version', async () => {
    const { context, repository } = createHarness()
    const changedUpdatedAt = new Date('2026-09-19T12:00:01.000Z')
    repository.status = 'disabled'
    repository.updatedAt = new Date('2026-09-19T12:00:02.000Z')

    await expect(repositoryCommands.disableRepositoryCommand.undo?.({
      input: { id: repository.id, updatedAt: changedUpdatedAt.toISOString() },
      ctx: context as never,
      logEntry: {
        commandPayload: {
          undo: {
            before: { id: repository.id, status: 'active', updatedAt: ORIGINAL_UPDATED_AT.toISOString() },
            changedUpdatedAt: changedUpdatedAt.toISOString(),
          },
        },
      },
    })).rejects.toMatchObject({ status: 409 })
    expect(repository.status).toBe('disabled')
  })
})
