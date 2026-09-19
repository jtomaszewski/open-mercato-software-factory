import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { CodeRepository, RepositoryConnection, RepositoryProjectLink } from '../../data/entities'
import { createRepositoryAccess } from '../repository-access'
import type { GitHubApp } from '../github-app'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
let links: Array<Partial<RepositoryProjectLink>>
let repository: Partial<CodeRepository> | null
let connection: Partial<RepositoryConnection> | null
const repositoryToken = jest.fn<GitHubApp['repositoryToken']>()

const manager = {
  find: async (entity: unknown) => (entity === RepositoryProjectLink ? links : []),
  findOne: async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === CodeRepository) return repository && repository.id === where.id ? repository : null
    if (entity === RepositoryConnection) return connection && connection.id === where.id ? connection : null
    return null
  },
}
const access = createRepositoryAccess({ em: { fork: () => manager } as never, repositoryGitHubApp: { repositoryToken } as unknown as GitHubApp })

beforeEach(() => {
  links = [{ repositoryId: 'repo-1', isDefault: false }]
  repository = { id: 'repo-1', connectionId: 'conn-1', githubRepositoryId: '42', fullName: 'acme/old-name', baseBranch: 'main', status: 'active' }
  connection = { id: 'conn-1', installationId: '99', status: 'active', authorizedRepositoryIds: ['42'] }
  repositoryToken.mockReset().mockResolvedValue({ token: 'ghs_1', fullName: 'acme/site', expiresAt: '2026-09-19T20:00:00Z' })
})

describe('repository access for a project', () => {
  it('returns null when the project has no linked repository', async () => {
    links = []
    await expect(access.forProject({ ...scope, projectId: 'p' })).resolves.toBeNull()
    expect(repositoryToken).not.toHaveBeenCalled()
  })

  it('issues a token for the only linked repository, with its current GitHub name', async () => {
    await expect(access.forProject({ ...scope, projectId: 'p' })).resolves.toEqual({ repositoryId: 'repo-1', fullName: 'acme/site', baseBranch: 'main', token: 'ghs_1' })
    expect(repositoryToken).toHaveBeenCalledWith('99', '42')
  })

  it('picks the default among several links and refuses to guess without one', async () => {
    links = [{ repositoryId: 'other', isDefault: false }, { repositoryId: 'repo-1', isDefault: true }]
    await expect(access.forProject({ ...scope, projectId: 'p' })).resolves.toMatchObject({ repositoryId: 'repo-1' })
    links = [{ repositoryId: 'other', isDefault: false }, { repositoryId: 'repo-1', isDefault: false }]
    await expect(access.forProject({ ...scope, projectId: 'p' })).rejects.toMatchObject({ status: 409, body: { code: 'defaultRepositoryRequired' } })
  })

  it('fails closed for a disabled repository, a removed connection or a repository outside the consent', async () => {
    repository = { ...repository!, status: 'disabled' }
    await expect(access.forProject({ ...scope, projectId: 'p' })).rejects.toMatchObject({ body: { code: 'repositoryUnavailable' } })
    repository = { ...repository, status: 'active' }
    connection = { ...connection!, status: 'removed' }
    await expect(access.forProject({ ...scope, projectId: 'p' })).rejects.toMatchObject({ body: { code: 'repositoryUnavailable' } })
    connection = { ...connection, status: 'active', authorizedRepositoryIds: ['7'] }
    await expect(access.forProject({ ...scope, projectId: 'p' })).rejects.toMatchObject({ body: { code: 'repositoryUnavailable' } })
    expect(repositoryToken).not.toHaveBeenCalled()
  })
})
