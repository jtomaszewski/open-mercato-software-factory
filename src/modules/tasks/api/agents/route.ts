import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { TasksDelegationService } from '../../lib/delegationService'
import { withTaskRoute } from '../route-context'
export const metadata = { GET: { requireAuth: true, requireFeatures: ['tasks.delegate'] } }
export async function GET(request: Request) {
  return withTaskRoute(request, ['tasks.delegate'], async ({ commandContext }) => {
    const service = commandContext.container.resolve<TasksDelegationService>('tasksDelegationService')
    return Response.json({ items: await service.listAgents(commandContext) })
  })
}
export const openApi: OpenApiRouteDoc = {
  tag: 'Tasks', summary: 'Available agent delegates', methods: {
    GET: { summary: 'List agent principals in the selected organization', responses: [{ status: 200, description: 'Available agents', schema: z.object({ items: z.array(z.object({ userId: z.string().uuid(), agentId: z.string(), name: z.string() })) }) }], errors: [{ status: 403, description: 'Missing scope or feature' }] },
  },
}
