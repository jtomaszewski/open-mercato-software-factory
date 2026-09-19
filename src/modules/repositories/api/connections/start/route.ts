import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { connectionStartSchema } from '../../../data/validators'
import { withRepositoryRoute } from '../../route-context'
import { repositoriesTag, repositoryErrorSchema } from '../../openapi'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['repositories.manage'] } }

export async function POST(request: Request) {
  return withRepositoryRoute(request, ['repositories.manage'], async ({ commandContext }) => {
    const input = connectionStartSchema.parse(await readJsonSafe(request, {}))
    const bus = commandContext.container.resolve<CommandBus>('commandBus')
    const executed = await bus.execute<typeof input, { redirectUrl: string }>('repositories.connection.start', { input, ctx: commandContext })
    return Response.json(executed.result, { status: 201 })
  })
}

export const openApi: OpenApiRouteDoc = { tag: repositoriesTag, summary: 'Start GitHub App consent', methods: {
  POST: { summary: 'Create a single-use consent state and return the GitHub App consent URL', requestBody: { contentType: 'application/json', schema: connectionStartSchema }, responses: [{ status: 201, description: 'Consent URL', schema: z.object({ redirectUrl: z.string().url() }) }], errors: [{ status: 403, description: 'Forbidden', schema: repositoryErrorSchema }, { status: 503, description: 'Broker is not configured', schema: repositoryErrorSchema }] },
} }
