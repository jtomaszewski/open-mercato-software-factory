import type { AwilixContainer } from 'awilix'
import type { RepositoryAccess } from '../../repositories/lib/repository-access'
import { GitHubClient, readGitHubConfigFromEnv, type GitHubConfig } from './github'

/**
 * Where the factory's site repository and GitHub token come from for a task: the project's
 * repository registered in Code repositories (short-lived GitHub App token), else the environment
 * (`FACTORY_SITE_REPO` + `FACTORY_GITHUB_TOKEN`) when the project has no linked repository.
 */
export async function resolveFactoryGitHub(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
  projectId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GitHubConfig> {
  const fallback = () => readGitHubConfigFromEnv(env)
  if (!container.hasRegistration('repositoryAccess')) return fallback()
  const access = await container.resolve<RepositoryAccess>('repositoryAccess').forProject({ ...scope, projectId })
  if (!access) return fallback()
  return {
    token: access.token,
    repo: access.fullName,
    baseBranch: access.baseBranch,
    apiUrl: env.FACTORY_GITHUB_API_URL?.trim() || 'https://api.github.com',
  }
}

/** A GitHub client per task project, for the review and approve routes. */
export function factoryGitHubFor(container: AwilixContainer, scope: { tenantId: string; organizationId: string }) {
  return async (projectId: string) => new GitHubClient(await resolveFactoryGitHub(container, scope, projectId))
}
