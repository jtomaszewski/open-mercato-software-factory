import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { connectionCompleteSchema, installationGrantSchema } from '../../../data/validators'
import { withRepositoryRoute } from '../../route-context'
import { repositoriesTag, repositoryErrorSchema } from '../../openapi'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['repositories.manage'] } }

export async function POST(request: Request) {
  return withRepositoryRoute(request, ['repositories.manage'], async ({ commandContext }) => {
    const input = connectionCompleteSchema.parse(await readJsonSafe(request, {}))
    const executed = await commandContext.container.resolve<CommandBus>('commandBus').execute<typeof input, { status: 'waiting' | 'connected' }>(
      'repositories.connection.complete', { input, ctx: commandContext },
    )
    return Response.json(executed.result, { status: executed.result.status === 'connected' ? 201 : 200 })
  })
}

export const openApi: OpenApiRouteDoc = { tag: repositoriesTag, summary: 'Complete GitHub App consent', methods: {
  POST: { summary: 'Verify OAuth consent and bind a GitHub installation', requestBody: { contentType: 'application/json', schema: connectionCompleteSchema }, responses: [{ status: 201, description: 'Installation connected', schema: z.object({ status: z.literal('connected'), connectionId: z.string().uuid(), grantedRepositories: installationGrantSchema.shape.repositories }) }, { status: 200, description: 'Waiting for organization owner approval', schema: z.object({ status: z.literal('waiting') }) }], errors: [{ status: 400, description: 'Expired or reused state', schema: repositoryErrorSchema }, { status: 409, description: 'Installation already bound', schema: repositoryErrorSchema }, { status: 502, description: 'GitHub verification failed', schema: repositoryErrorSchema }] },
} }
