import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CodeRepository, RepositoryConnection, RepositoryProjectLink } from '../data/entities'
import type { GitHubApp } from './github-app'

export const REPOSITORY_ACCESS = 'repositoryAccess'

/** Credentials for the one repository a project works on; the token expires in about an hour. */
export type ProjectRepositoryAccess = {
  repositoryId: string
  fullName: string
  baseBranch: string
  token: string
}

export type RepositoryAccess = {
  /**
   * The project's repository with a fresh installation token: its default link, or its only
   * link. Null when the project has no linked repository. Throws when a link exists but cannot be
   * used (disabled, connection removed, access revoked, several links and no default), so callers
   * never silently fall back to another repository.
   */
  forProject(input: { tenantId: string; organizationId: string; projectId: string }): Promise<ProjectRepositoryAccess | null>
}

function accessError(code: string): CrudHttpError {
  return new CrudHttpError(409, { code, error: `repositories.errors.${code}` })
}

export function createRepositoryAccess({ em, repositoryGitHubApp }: { em: EntityManager; repositoryGitHubApp: GitHubApp }): RepositoryAccess {
  return {
    async forProject({ tenantId, organizationId, projectId }) {
      const manager = em.fork()
      const links = await manager.find(RepositoryProjectLink, { tenantId, organizationId, projectId })
      if (links.length === 0) return null
      const link = links.find((item) => item.isDefault) ?? (links.length === 1 ? links[0] : undefined)
      if (!link) throw accessError('defaultRepositoryRequired')
      const repository = await manager.findOne(CodeRepository, { id: link.repositoryId, tenantId, organizationId, deletedAt: null })
      if (!repository || repository.status !== 'active') throw accessError('repositoryUnavailable')
      const connection = await manager.findOne(RepositoryConnection, { id: repository.connectionId, tenantId, organizationId, deletedAt: null })
      if (!connection || connection.status !== 'active' || !connection.authorizedRepositoryIds.includes(repository.githubRepositoryId)) {
        throw accessError('repositoryUnavailable')
      }
      const issued = await repositoryGitHubApp.repositoryToken(connection.installationId, repository.githubRepositoryId)
      return { repositoryId: repository.id, fullName: issued.fullName, baseBranch: repository.baseBranch, token: issued.token }
    },
  }
}
