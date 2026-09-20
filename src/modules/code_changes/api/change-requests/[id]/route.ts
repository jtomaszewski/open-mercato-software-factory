import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTaskRoute } from '../../../../task_delegation/api/route-context'
import { readTaskRun } from '../../../../task_delegation/lib/runsQuery'
import { readChangeRequest } from '../../../lib/changeRequests'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = { GET: { requireAuth: true, requireFeatures: ['task_delegation.view'] } }

export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  return withTaskRoute(request, ['task_delegation.view'], async ({ commandContext }) => {
    const { id } = paramsSchema.parse(await route.params)
    const changeRequest = await readChangeRequest(commandContext, id)
    // How the change was produced is a second story with its own failure mode (the orchestrator
    // may be unreadable); it never keeps the change request itself off the page.
    const run = changeRequest.delegationId
      ? await readTaskRun(commandContext, changeRequest.delegationId).catch(() => null)
      : null
    return Response.json({ changeRequest, run })
  })
}

const errorSchema = z.object({ error: z.string(), code: z.string().optional() })
export const openApi: OpenApiRouteDoc = {
  tag: 'Code changes', summary: 'One change request', methods: {
    GET: {
      summary: 'The change request and, when it came from an agent run, how that run went',
      responses: [{ status: 200, description: 'Change request with its run' }],
      errors: [
        { status: 403, description: 'Missing scope or feature', schema: errorSchema },
        { status: 404, description: 'Not found or not accessible', schema: errorSchema },
      ],
    },
  },
}
