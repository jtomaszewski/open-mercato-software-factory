import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { TaskDelegationService } from '../../lib/delegationService'
import { withTaskRoute } from '../route-context'
export const metadata = { GET: { requireAuth: true, requireFeatures: ['task_delegation.delegate'] } }
export async function GET(request: Request) {
  return withTaskRoute(request, ['task_delegation.delegate'], async ({ commandContext }) => {
    const service = commandContext.container.resolve<TaskDelegationService>('taskDelegationService')
    return Response.json({ items: await service.listAgents(commandContext) })
  })
}
export const openApi: OpenApiRouteDoc = {
  tag: 'Tasks', summary: 'Available agent delegates', methods: {
    GET: { summary: 'List rostered agent roles with a provisioned principal and a startable process', responses: [{ status: 200, description: 'Available agents', schema: z.object({ items: z.array(z.object({ userId: z.string().uuid(), agentId: z.string(), name: z.string(), label: z.string(), description: z.string() })) }) }], errors: [{ status: 403, description: 'Missing scope or feature' }] },
  },
}
