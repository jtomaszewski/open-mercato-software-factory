import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTaskRoute } from '../../../task_delegation/api/route-context'
import { listChangeRequests } from '../../lib/changeRequests'
import { changeRequestListSchema } from '../../data/validators'
import { changeRequestPageSchema, codeChangesErrorSchema, codeChangesTag } from '../openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['code_changes.view'] } }

export async function GET(request: Request) {
  return withTaskRoute(request, ['code_changes.view'], async ({ commandContext }) => {
    const query = changeRequestListSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return Response.json(await listChangeRequests(commandContext, query))
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: codeChangesTag, summary: 'Change requests', methods: {
    GET: {
      summary: 'List the change requests the caller may see, newest first',
      query: changeRequestListSchema,
      responses: [{ status: 200, description: 'One page of change requests', schema: changeRequestPageSchema }],
      errors: [
        { status: 400, description: 'Malformed query', schema: codeChangesErrorSchema },
        { status: 403, description: 'Missing scope or feature', schema: codeChangesErrorSchema },
      ],
    },
  },
}
