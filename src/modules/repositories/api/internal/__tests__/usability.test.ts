import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const resolveDelegationTarget = jest.fn<() => Promise<Record<string, unknown>>>()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'em') return { fork: () => ({ transactional: async (work: (tx: unknown) => Promise<unknown>) => work({}) }) }
      if (name === 'repositoryTargetResolver') return { resolveDelegationTarget }
      throw new Error(`unexpected ${name}`)
    },
  }),
}))
jest.mock('../auth', () => ({ authenticateAndClaimBrokerRequest: async () => true }))

import { GET } from '../usability/route'

const target = {
  repositoryId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  configEpoch: 4,
  profileDigest: 'a'.repeat(64),
  installationId: '123',
  brokerAuthorizationId: '33333333-3333-4333-8333-333333333333',
  githubRepositoryId: '456',
  baseBranch: 'main',
}

function request(overrides: Record<string, string> = {}) {
  const query = new URLSearchParams({
    delegationId: '44444444-4444-4444-8444-444444444444',
    repositoryId: target.repositoryId,
    epoch: String(target.configEpoch),
    profileDigest: target.profileDigest,
    installationId: target.installationId,
    authorizationId: target.brokerAuthorizationId,
    githubRepositoryId: target.githubRepositoryId,
    baseBranch: target.baseBranch,
    ...overrides,
  })
  return new Request(`https://om.test/api/repositories/internal/usability?${query}`)
}

beforeEach(() => { resolveDelegationTarget.mockReset().mockResolvedValue(target) })

describe('broker usability target binding', () => {
  it('accepts the exact frozen repository and provider tuple', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ usable: true })
  })

  it.each([
    ['installationId', '999'],
    ['authorizationId', '55555555-5555-4555-8555-555555555555'],
    ['githubRepositoryId', '999'],
    ['baseBranch', 'release'],
  ])('refuses a stale %s tuple', async (field, value) => {
    const response = await GET(request({ [field]: value }))
    await expect(response.json()).resolves.toEqual({ usable: false, reason: 'repository_changed' })
  })
})
