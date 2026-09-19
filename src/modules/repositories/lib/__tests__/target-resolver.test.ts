import { describe, expect, it, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CodeRepository, RepositoryConnection, RepositoryProjectLink } from '../../data/entities'
import { createRepositoryTargetResolver } from '../target-resolver'

jest.mock('../qualification-dispatch', () => ({ REPOSITORY_BROKER: 'repositoryBroker' }))

class Delegation {
  id!: string
  projectId!: string
}

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const projectId = '33333333-3333-4333-8333-333333333333'
const profile = { version: 1, commands: { install: 'i', build: 'b', test: 't' } }

function harness(options: { linked?: boolean; epoch?: number; frozenEpoch?: number; released?: boolean } = {}) {
  const repository = {
    id: '44444444-4444-4444-8444-444444444444', connectionId: '55555555-5555-4555-8555-555555555555',
    ...scope, fullName: 'open-mercato/example', baseBranch: 'main', kind: 'pr_only' as const, profile,
    githubRepositoryId: '12', configEpoch: options.epoch ?? 3, qualificationStatus: 'passed',
    qualificationEpoch: options.epoch ?? 3, status: 'active', accessStatus: 'granted', deletedAt: null,
  }
  const connection = { id: repository.connectionId, ...scope, installationId: '9', brokerAuthorizationId: '66666666-6666-4666-8666-666666666666', status: 'active', deletedAt: null }
  const link = { id: '77777777-7777-4777-8777-777777777777', ...scope, projectId, repositoryId: repository.id, isDefault: true, createdAt: new Date(), updatedAt: new Date() }
  const delegation = {
    id: '88888888-8888-4888-8888-888888888888', ...scope, projectId, repositoryId: repository.id,
    repositoryConfigEpoch: options.frozenEpoch ?? 3,
    repositoryProfileDigest: 'a473d380374e6a1eab39850dfc3d670167c66097735b9f3fe4ca800d397c09b2',
    releasedAt: options.released ? new Date() : null,
  }
  const find = jest.fn(async (entity: unknown) => entity === RepositoryProjectLink && options.linked !== false ? [link] : [])
  const findOne = jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === Delegation) return where.releasedAt === null && !options.released ? delegation : null
    if (entity === RepositoryProjectLink) return options.linked === false ? null : link
    if (entity === CodeRepository) return repository
    if (entity === RepositoryConnection) return connection
    return null
  })
  const manager = { find, findOne }
  const resolver = createRepositoryTargetResolver({ em: { fork: () => manager } as unknown as EntityManager, TaskDelegation: Delegation })
  return { resolver, repository, delegation }
}

describe('repository target resolver', () => {
  it('selects the sole usable project repository and returns broker target data', async () => {
    const { resolver, repository } = harness()
    await expect(resolver.resolveForProject({ ...scope, projectId })).resolves.toMatchObject({
      repositoryId: repository.id,
      fullName: repository.fullName,
      configEpoch: 3,
      installationId: '9',
      brokerAuthorizationId: '66666666-6666-4666-8666-666666666666',
    })
  })

  it('refuses an unlinked or changed frozen delegation target', async () => {
    await expect(harness({ linked: false }).resolver.resolveDelegationTarget({ ...scope, delegationId: '88888888-8888-4888-8888-888888888888' }))
      .rejects.toMatchObject({ status: 422, body: { code: 'repository_not_linked' } })
    await expect(harness({ epoch: 4, frozenEpoch: 3 }).resolver.resolveDelegationTarget({ ...scope, delegationId: '88888888-8888-4888-8888-888888888888' }))
      .rejects.toMatchObject({ status: 409, body: { code: 'repository_changed' } })
  })
})

it('resolves through the installed CLASSIC application container', async () => {
  const { createContainer, asValue, InjectionMode } = await import('awilix')
  const { register } = await import('../../di')
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue({ fork: () => ({ find: async () => [] }) }), TaskDelegation: asValue(Delegation) })
  register(container)
  await expect(container.resolve<ReturnType<typeof createRepositoryTargetResolver>>('repositoryTargetResolver').listProjectTargets({ ...scope, projectId })).resolves.toEqual([])
})
