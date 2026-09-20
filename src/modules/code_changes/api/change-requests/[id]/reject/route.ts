import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTaskRoute } from '../../../../../task_delegation/api/route-context'
import { changeRequestRejectSchema } from '../../../../data/validators'
import type { ChangeRequestResult, DecideChangeRequestInput } from '../../../../commands/changeRequests'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = { POST: { requireAuth: true, requireFeatures: ['task_delegation.delegate'] } }

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  return withTaskRoute(request, ['task_delegation.delegate'], async ({ commandContext, userId, tenantId, organizationId, userFeatures }) => {
    const { id } = paramsSchema.parse(await route.params)
    const { reason } = changeRequestRejectSchema.parse(await readJsonSafe(request, {}))
    const guards = await runRouteMutationGuards({
      container: commandContext.container, req: request,
      auth: { userId, tenantId, organizationId, userFeatures },
      input: { resourceKind: 'code_changes.change_request', resourceId: id, operation: 'custom', mutationPayload: { id, reason } },
    })
    if (!guards.ok) return guards.response
    const executed = await commandContext.container.resolve<CommandBus>('commandBus')
      .execute<DecideChangeRequestInput, ChangeRequestResult>('code_changes.change_request.reject', { input: { id, reason }, ctx: commandContext })
    await guards.runAfterSuccess()
    return Response.json(executed.result)
  })
}

const errorSchema = z.object({ error: z.string(), code: z.string().optional() })
export const openApi: OpenApiRouteDoc = {
  tag: 'Code changes', summary: 'Reject a change request', methods: {
    POST: {
      summary: 'Close the change request without merging and return its task to the backlog (assignee only)',
      requestBody: { contentType: 'application/json', schema: changeRequestRejectSchema },
      responses: [{ status: 200, description: 'Rejected', schema: z.object({ id: z.string().uuid(), status: z.literal('rejected') }) }],
      errors: [
        { status: 403, description: 'Not the task assignee, or missing scope/feature', schema: errorSchema },
        { status: 404, description: 'Not found or not accessible', schema: errorSchema },
        { status: 409, description: 'Not open, not in review, or already merged', schema: errorSchema },
        { status: 422, description: 'A reason is required', schema: errorSchema },
      ],
    },
  },
}
