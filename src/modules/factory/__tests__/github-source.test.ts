import { expect, it, jest } from '@jest/globals'
import { resolveFactoryGitHub } from '../lib/github-source'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const env = { FACTORY_GITHUB_TOKEN: 'env-token', FACTORY_SITE_REPO: 'env/site', FACTORY_SITE_BASE_BRANCH: 'main' } as unknown as NodeJS.ProcessEnv

function container(forProject?: (input: unknown) => Promise<unknown>) {
  return {
    hasRegistration: (name: string) => name === 'repositoryAccess' && Boolean(forProject),
    resolve: () => ({ forProject }),
  } as never
}

it('uses the project repository and its App token when one is linked', async () => {
  const forProject = jest.fn(async (_input: unknown) => ({ repositoryId: 'r', fullName: 'acme/site', baseBranch: 'develop', token: 'ghs_app' }))
  await expect(resolveFactoryGitHub(container(forProject), scope, 'project-1', env)).resolves.toEqual({
    token: 'ghs_app', repo: 'acme/site', baseBranch: 'develop', apiUrl: 'https://api.github.com',
  })
  expect(forProject).toHaveBeenCalledWith({ ...scope, projectId: 'project-1' })
})

it('falls back to the env repo and token when the project has no linked repository', async () => {
  const expected = { token: 'env-token', repo: 'env/site', baseBranch: 'main', apiUrl: 'https://api.github.com' }
  await expect(resolveFactoryGitHub(container(async () => null), scope, 'project-1', env)).resolves.toEqual(expected)
  await expect(resolveFactoryGitHub(container(), scope, 'project-1', env)).resolves.toEqual(expected)
})

it('does not fall back when a linked repository cannot be used', async () => {
  const forProject = async () => { throw new Error('repositoryUnavailable') }
  await expect(resolveFactoryGitHub(container(forProject), scope, 'project-1', env)).rejects.toThrow('repositoryUnavailable')
})
