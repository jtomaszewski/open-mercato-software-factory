import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { RepositoryConnection } from '../../../../data/entities'
import { REPOSITORY_BROKER } from '../../../../lib/qualification-dispatch'
import type { RepositoryBroker } from '../../../../lib/broker'
import { withRepositoryRoute } from '../../../route-context'
import { repositoriesTag, repositoryErrorSchema } from '../../../openapi'

const querySchema = z.object({ githubRepositoryId: z.string().regex(/^\d{1,32}$/) })
export const metadata = { GET: { requireAuth: true, requireFeatures: ['repositories.view'] } }

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRepositoryRoute(request, ['repositories.view'], async ({ commandContext, tenantId, organizationId }) => {
    const { id } = await context.params
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const connection = await commandContext.container.resolve<EntityManager>('em').findOne(RepositoryConnection, { id, tenantId, organizationId, deletedAt: null })
    if (!connection) return Response.json({ error: 'repositories.errors.connectionNotFound' }, { status: 404 })
    const broker = commandContext.container.resolve<RepositoryBroker>(REPOSITORY_BROKER)
    const grant = await broker.refreshInstallation({ installationId: connection.installationId, authorizationId: connection.brokerAuthorizationId })
    if (!grant.repositories.some((repository) => repository.id === query.githubRepositoryId)) {
      return Response.json({ error: 'repositories.errors.repositoryNotGranted' }, { status: 404 })
    }
    return Response.json({ branches: await broker.listBranches({ installationId: connection.installationId, authorizationId: connection.brokerAuthorizationId, githubRepositoryId: query.githubRepositoryId }) })
  })
}

export const openApi: OpenApiRouteDoc = { tag: repositoriesTag, summary: 'Read repository branches', methods: {
  GET: { summary: 'List branches for a currently granted repository', query: querySchema, responses: [{ status: 200, description: 'Branches', schema: z.object({ branches: z.array(z.string()) }) }], errors: [{ status: 404, description: 'Connection or grant not found', schema: repositoryErrorSchema }, { status: 502, description: 'Broker unavailable', schema: repositoryErrorSchema }] },
} }
