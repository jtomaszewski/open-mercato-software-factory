import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { z } from 'zod'
import { CodeRepository, RepositoryConnection, RepositoryProjectLink } from '../../data/entities'
import { GitHubAppError, type GitHubApp, type RepositoryHeadCommit } from '../../lib/github-app'
import { withRepositoryRoute } from '../route-context'
import { repositoriesTag, repositoryErrorSchema } from '../openapi'

const logger = createLogger('repositories').child({ component: 'overview' })

export type RepositoryOverviewItem = {
  id: string
  fullName: string
  baseBranch: string
  status: 'active' | 'disabled'
  accountLogin: string | null
  projectNames: string[]
  head: RepositoryHeadCommit | null
  /** Why the head commit is missing — the card says so instead of pretending the repo is empty. */
  headError: string | null
}

export const metadata = { GET: { requireAuth: true, requireFeatures: ['repositories.view'] } }

/**
 * Every registered repository with the version it is currently on.
 *
 * "Version" is the head commit of the repository's base branch: the thing a released site is
 * actually built from, and the only version marker every repository has. One GitHub read per
 * repository, all in flight together, and a repository whose read fails still renders — with the
 * reason — because a card missing from an overview looks like a repository that was removed.
 */
export async function GET(request: Request) {
  return withRepositoryRoute(request, ['repositories.view'], async ({ commandContext, tenantId, organizationId }) => {
    const em = commandContext.container.resolve<EntityManager>('em')
    const scope = { tenantId, organizationId }
    const repositories = await em.find(CodeRepository, { ...scope, deletedAt: null }, { orderBy: { fullName: 'asc' } })
    if (!repositories.length) return Response.json({ items: [] })

    const connections = await em.find(RepositoryConnection, { ...scope, id: { $in: [...new Set(repositories.map((item) => item.connectionId))] } })
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]))
    const links = await em.find(RepositoryProjectLink, { ...scope, repositoryId: { $in: repositories.map((item) => item.id) } })
    const projectIds = [...new Set(links.map((link) => link.projectId))]
    const projects = projectIds.length
      ? await commandContext.container.resolve<QueryEngine>('queryEngine').query<{ id: string; name: string | null }>('staff:staff_time_project', {
        fields: ['id', 'name'], filters: { id: { $in: projectIds } }, page: { page: 1, pageSize: projectIds.length }, ...scope,
      })
      : null
    const projectName = new Map((projects?.items ?? []).map((project) => [project.id, project.name ?? project.id]))
    const app = commandContext.container.resolve<GitHubApp>('repositoryGitHubApp')

    const items = await Promise.all(repositories.map(async (repository): Promise<RepositoryOverviewItem> => {
      const connection = connectionById.get(repository.connectionId) ?? null
      const base: Omit<RepositoryOverviewItem, 'head' | 'headError'> = {
        id: repository.id,
        fullName: repository.fullName,
        baseBranch: repository.baseBranch,
        status: repository.status,
        accountLogin: connection?.accountLogin ?? null,
        projectNames: links.filter((link) => link.repositoryId === repository.id).map((link) => projectName.get(link.projectId) ?? link.projectId),
      }
      const readable = repository.status === 'active'
        && connection?.status === 'active'
        && connection.authorizedRepositoryIds.includes(repository.githubRepositoryId)
      if (!readable) return { ...base, head: null, headError: 'repositoryUnavailable' }
      try {
        return { ...base, head: await app.headCommit(connection.installationId, repository.githubRepositoryId, repository.baseBranch), headError: null }
      } catch (error) {
        logger.warn('repository head unavailable', {
          organizationId, repositoryId: repository.id,
          error: error instanceof Error ? error.message : String(error),
        })
        return { ...base, head: null, headError: error instanceof GitHubAppError ? error.code : 'unavailable' }
      }
    }))
    return Response.json({ items })
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: repositoriesTag, summary: 'Repository overview', methods: {
    GET: {
      summary: 'Every registered repository with its linked projects and the head commit of its base branch',
      responses: [{ status: 200, description: 'Overview items' }],
      errors: [{ status: 403, description: 'Forbidden', schema: repositoryErrorSchema }],
    },
  },
}

export const overviewItemSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  baseBranch: z.string(),
  status: z.enum(['active', 'disabled']),
  accountLogin: z.string().nullable(),
  projectNames: z.array(z.string()),
  head: z.object({
    sha: z.string(),
    subject: z.string(),
    authorName: z.string().nullable(),
    committedAt: z.string().nullable(),
    htmlUrl: z.string().nullable(),
  }).nullable(),
  headError: z.string().nullable(),
})
