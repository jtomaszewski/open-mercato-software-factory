import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTaskRoute } from '../../../task_delegation/api/route-context'
import { listChangeRequests } from '../../lib/changeRequests'
import { changeRequestListSchema } from '../../data/validators'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['task_delegation.view'] } }

export async function GET(request: Request) {
  return withTaskRoute(request, ['task_delegation.view'], async ({ commandContext }) => {
    const query = changeRequestListSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return Response.json(await listChangeRequests(commandContext, query))
  })
}

const errorSchema = z.object({ error: z.string(), code: z.string().optional() })
export const openApi: OpenApiRouteDoc = {
  tag: 'Code changes', summary: 'Change requests', methods: {
    GET: {
      summary: 'List the change requests the caller may see, newest first',
      query: changeRequestListSchema,
      responses: [{ status: 200, description: 'One page of change requests' }],
      errors: [
        { status: 400, description: 'Malformed query', schema: errorSchema },
        { status: 403, description: 'Missing scope or feature', schema: errorSchema },
      ],
    },
  },
}
