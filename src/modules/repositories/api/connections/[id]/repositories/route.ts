import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { RepositoryConnection } from '../../../../data/entities'
import { installationGrantSchema } from '../../../../data/validators'
import { REPOSITORY_GITHUB_APP, type GitHubApp } from '../../../../lib/github-app'
import { withRepositoryRoute } from '../../../route-context'
import { repositoriesTag, repositoryErrorSchema } from '../../../openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['repositories.view'] } }

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRepositoryRoute(request, ['repositories.view'], async ({ commandContext, tenantId, organizationId }) => {
    const { id } = await context.params
    const connection = await commandContext.container.resolve<EntityManager>('em').findOne(RepositoryConnection, { id, tenantId, organizationId, deletedAt: null })
    if (!connection) return Response.json({ error: 'repositories.errors.connectionNotFound' }, { status: 404 })
    const grant = await commandContext.container.resolve<GitHubApp>(REPOSITORY_GITHUB_APP).getInstallationGrant(connection.installationId, connection.authorizedRepositoryIds)
    return Response.json({ installationId: grant.installationId, accountLogin: grant.accountLogin, repositories: grant.repositories })
  })
}

export const openApi: OpenApiRouteDoc = { tag: repositoriesTag, summary: 'Read current GitHub grants', methods: {
  GET: { summary: 'Refresh repositories granted to a connected installation', responses: [{ status: 200, description: 'Current grant', schema: installationGrantSchema }], errors: [{ status: 404, description: 'Connection not found', schema: repositoryErrorSchema }, { status: 502, description: 'GitHub unavailable', schema: repositoryErrorSchema }] },
} }
