import { describe, expect, it, jest } from '@jest/globals'

jest.mock('@mikro-orm/postgresql', () => ({ LockMode: { PESSIMISTIC_WRITE: 'pessimistic_write' } }))

import { repositoryCommands } from '../repositories'
import { consumeStagedConnectionGrant, stageVerifiedConnectionGrant } from '../../lib/verified-connection-grant'
import { CodeRepository, RepositoryConnection, RepositoryConnectState, RepositoryQualificationDispatch } from '../../data/entities'

type ConnectionTestEntityManager = {
  fork(): ConnectionTestEntityManager
  transactional<T>(operation: (tx: ConnectionTestEntityManager) => Promise<T>): Promise<T>
  findOne: ReturnType<typeof jest.fn>
  persist: ReturnType<typeof jest.fn>
  flush: ReturnType<typeof jest.fn>
}

describe('verified connection handoff', () => {
  it('is single-use and cannot be fabricated from installation fields', () => {
    const grant = { installationId: '123', authorizationId: '00000000-0000-4000-8000-000000000001', accountLogin: 'acme', repositories: [{ id: '456', fullName: 'acme/site', defaultBranch: 'main' }] }
    const verificationId = stageVerifiedConnectionGrant(grant)
    expect(consumeStagedConnectionGrant(verificationId)).toEqual(grant)
    expect(() => consumeStagedConnectionGrant(verificationId)).toThrow()
    expect(() => consumeStagedConnectionGrant('00000000-0000-4000-8000-000000000000')).toThrow()
  })

  it('does not replace another organization authorization when binding is rejected', async () => {
    const originalAuthorizationId = '00000000-0000-4000-8000-000000000010'
    const connection = Object.assign(new RepositoryConnection(), {
      id: '00000000-0000-4000-8000-000000000011',
      tenantId: '00000000-0000-4000-8000-000000000012',
      organizationId: '00000000-0000-4000-8000-000000000013',
      installationId: '123',
      brokerAuthorizationId: originalAuthorizationId,
      accountLogin: 'other-org',
      connectedBy: '00000000-0000-4000-8000-000000000014',
      deletedAt: null,
    })
    const state = Object.assign(new RepositoryConnectState(), {
      id: '00000000-0000-4000-8000-000000000015',
      tenantId: '00000000-0000-4000-8000-000000000020',
      organizationId: '00000000-0000-4000-8000-000000000021',
      userId: '00000000-0000-4000-8000-000000000022',
      nonceHash: 'a'.repeat(64),
      expectedInstallationId: '123',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    })
    const em: ConnectionTestEntityManager = {
      fork: () => em,
      transactional: async <T>(operation: (tx: ConnectionTestEntityManager) => Promise<T>) => operation(em),
      findOne: jest.fn(async (entity: { name?: string }) => {
        if (entity.name === 'User') return { id: state.userId, kind: 'human' }
        if (entity === RepositoryConnectState) return state
        if (entity === RepositoryConnection) return connection
        return null
      }),
      persist: jest.fn(),
      flush: jest.fn(async () => {}),
    }
    const context = {
      auth: { sub: state.userId, tenantId: state.tenantId, orgId: state.organizationId },
      selectedOrganizationId: state.organizationId,
      organizationIds: [state.organizationId],
      container: { resolve: (name: string) => name === 'em' ? em : { userHasAllFeatures: async () => true } },
    }
    const verificationId = stageVerifiedConnectionGrant({
      installationId: '123',
      authorizationId: '00000000-0000-4000-8000-000000000099',
      accountLogin: 'forged-replacement',
      repositories: [],
    })

    await expect(repositoryCommands.completeConnectionCommand.execute({ stateId: state.id, verificationId }, context as never))
      .rejects.toMatchObject({ status: 409, body: { code: 'installationBound' } })
    expect(connection.brokerAuthorizationId).toBe(originalAuthorizationId)
    expect(connection.accountLogin).toBe('other-org')
    expect(state.usedAt).toBeNull()
  })

  it('replaces a running attempt when reconnect consent changes the authorization binding', async () => {
    const tenantId = '00000000-0000-4000-8000-000000000030'
    const organizationId = '00000000-0000-4000-8000-000000000031'
    const userId = '00000000-0000-4000-8000-000000000032'
    const connection = Object.assign(new RepositoryConnection(), {
      id: '00000000-0000-4000-8000-000000000033', tenantId, organizationId,
      installationId: '123', brokerAuthorizationId: '00000000-0000-4000-8000-000000000034',
      accountLogin: 'acme', connectedBy: userId, status: 'active' as const, deletedAt: null,
    })
    const state = Object.assign(new RepositoryConnectState(), {
      id: '00000000-0000-4000-8000-000000000035', tenantId, organizationId, userId,
      nonceHash: 'b'.repeat(64), expectedInstallationId: '123', expiresAt: new Date(Date.now() + 60_000), usedAt: null,
    })
    const repository = Object.assign(new CodeRepository(), {
      id: '00000000-0000-4000-8000-000000000036', tenantId, organizationId, connectionId: connection.id,
      githubRepositoryId: '456', fullName: 'acme/site', baseBranch: 'main', kind: 'pr_only' as const,
      profile: { version: 1, commands: { install: 'yarn', build: 'yarn build', test: 'yarn test' } },
      status: 'active' as const, accessStatus: 'granted' as const, configEpoch: 1,
      qualificationStatus: 'running' as const,
      qualificationAttemptId: '00000000-0000-4000-8000-000000000037',
      qualificationStartedAt: new Date(),
      deletedAt: null,
    })
    const originalAttemptId = repository.qualificationAttemptId
    const dispatches: RepositoryQualificationDispatch[] = [Object.assign(new RepositoryQualificationDispatch(), {
      id: '00000000-0000-4000-8000-000000000038',
      repositoryId: repository.id,
      attemptId: originalAttemptId,
      epoch: repository.configEpoch,
      status: 'failed' as const,
    })]
    type ReconnectEntityManager = {
      fork(): ReconnectEntityManager
      transactional<T>(operation: (tx: ReconnectEntityManager) => Promise<T>): Promise<T>
      findOne(entity: unknown, where: Record<string, unknown>): Promise<unknown>
      find(entity: unknown): Promise<unknown[]>
      create<T extends object>(entity: new () => T, input: object): T
      persist(values: unknown | unknown[]): void
      flush(): Promise<void>
    }
    const em: ReconnectEntityManager = {
      fork: () => em,
      transactional: async <T>(operation: (tx: typeof em) => Promise<T>) => operation(em),
      async findOne(entity: unknown, where: Record<string, unknown>) {
        if ((entity as { name?: string }).name === 'User') return { id: userId, kind: 'human' }
        if (entity === RepositoryConnectState) return state
        if (entity === RepositoryConnection) return connection
        if (entity === RepositoryQualificationDispatch) return dispatches.find((item) => item.attemptId === where.attemptId) ?? null
        return null
      },
      async find(entity: unknown) { return entity === CodeRepository ? [repository] : [] },
      create<T extends object>(entity: new () => T, input: object): T { return Object.assign(new entity(), input) },
      persist(values: unknown | unknown[]) {
        for (const value of Array.isArray(values) ? values : [values]) {
          if (value instanceof RepositoryQualificationDispatch) dispatches.push(value)
        }
      },
      async flush() {},
    }
    const qualifiedAuthorizationIds: string[] = []
    const broker = { qualify: async (request: { authorizationId: string }) => { qualifiedAuthorizationIds.push(request.authorizationId) } }
    const context = {
      auth: { sub: userId, tenantId, orgId: organizationId }, selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      container: { resolve: (name: string) => name === 'em' ? em : name === 'repositoryBroker' ? broker : { userHasAllFeatures: async () => true } },
    }
    const verificationId = stageVerifiedConnectionGrant({
      installationId: '123', authorizationId: '00000000-0000-4000-8000-000000000039', accountLogin: 'acme',
      repositories: [{ id: '456', fullName: 'acme/site', defaultBranch: 'main' }],
    })

    await repositoryCommands.completeConnectionCommand.execute({ stateId: state.id, verificationId }, context as never)

    expect(repository.accessStatus).toBe('granted')
    expect(repository.status).toBe('active')
    expect(repository.qualificationStatus).toBe('running')
    expect(repository.qualificationAttemptId).not.toBe(originalAttemptId)
    expect(dispatches).toHaveLength(2)
    expect(qualifiedAuthorizationIds).toEqual(['00000000-0000-4000-8000-000000000039'])
  })
})
