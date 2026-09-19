import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { versionedActionSchema } from '../../data/validators'
import { withRepositoryRoute } from '../route-context'
import { repositoriesTag, repositoryErrorSchema, repositoryMutationResponseSchema } from '../openapi'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['repositories.manage'] } }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRepositoryRoute(request, ['repositories.manage'], async ({ commandContext }) => {
    const { id } = await context.params
    const input = versionedActionSchema.parse(await readJsonSafe(request, {}))
    const result = await commandContext.container.resolve<CommandBus>('commandBus').execute('repositories.repository.qualify', { input: { id, ...input }, ctx: commandContext })
    return Response.json(result.result, { status: 202 })
  })
}

export const openApi: OpenApiRouteDoc = { tag: repositoriesTag, summary: 'Qualify repository', methods: {
  POST: { summary: 'Start a fresh qualification attempt', requestBody: { contentType: 'application/json', schema: versionedActionSchema }, responses: [{ status: 202, description: 'Qualification accepted', schema: repositoryMutationResponseSchema }], errors: [{ status: 409, description: 'Running or unavailable', schema: repositoryErrorSchema }, { status: 502, description: 'Broker unavailable', schema: repositoryErrorSchema }] },
} }
