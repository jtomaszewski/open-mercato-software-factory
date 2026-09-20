import type { AwilixContainer } from 'awilix'
import type { RepositoryAccess } from '../../repositories/lib/repository-access'
import { GitHubClient, readEnv, readGitHubConfigFromEnv, type GitHubConfig } from './github'

/**
 * The resolved repository, plus which registered record it came from.
 *
 * `repositoryId` is null when the environment answered instead of the registry — the change is
 * still real, it just has no `Code repositories` row to point back at.
 */
export type TaskGitHub = GitHubConfig & { repositoryId: string | null }

/**
 * Where a task's repository and GitHub token come from: the task project's repository registered
 * in Code repositories (short-lived GitHub App token), else the environment
 * (`CODE_CHANGES_REPO` + `CODE_CHANGES_GITHUB_TOKEN`) when the project has no linked repository.
 */
export async function resolveTaskGitHub(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
  projectId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TaskGitHub> {
  const fallback = (): TaskGitHub => ({ ...readGitHubConfigFromEnv(env), repositoryId: null })
  if (!container.hasRegistration('repositoryAccess')) return fallback()
  const access = await container.resolve<RepositoryAccess>('repositoryAccess').forProject({ ...scope, projectId })
  if (!access) return fallback()
  return {
    token: access.token,
    repo: access.fullName,
    baseBranch: access.baseBranch,
    apiUrl: readEnv(env, 'GITHUB_API_URL', 'GITHUB_API_URL') || 'https://api.github.com',
    repositoryId: access.repositoryId,
  }
}

/** A GitHub client per task project, for the review and approve routes. */
export function gitHubForTaskProject(container: AwilixContainer, scope: { tenantId: string; organizationId: string }) {
  return async (projectId: string) => new GitHubClient(await resolveTaskGitHub(container, scope, projectId))
}
