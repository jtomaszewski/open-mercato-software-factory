import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTaskRoute } from '../../../../../task_delegation/api/route-context'
import type { ChangeRequestResult, DecideChangeRequestInput } from '../../../../commands/changeRequests'
import { changeRequestDecisionSchema, codeChangesErrorSchema, codeChangesTag } from '../../../openapi'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = { POST: { requireAuth: true, requireFeatures: ['code_changes.decide'] } }

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  return withTaskRoute(request, ['code_changes.decide'], async ({ commandContext, userId, tenantId, organizationId, userFeatures }) => {
    const { id } = paramsSchema.parse(await route.params)
    const guards = await runRouteMutationGuards({
      container: commandContext.container, req: request,
      auth: { userId, tenantId, organizationId, userFeatures },
      input: { resourceKind: 'code_changes.change_request', resourceId: id, operation: 'custom', mutationPayload: { id } },
    })
    if (!guards.ok) return guards.response
    const executed = await commandContext.container.resolve<CommandBus>('commandBus')
      .execute<DecideChangeRequestInput, ChangeRequestResult>('code_changes.change_request.approve', { input: { id }, ctx: commandContext })
    await guards.runAfterSuccess()
    return Response.json(executed.result)
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: codeChangesTag, summary: 'Approve a change request', methods: {
    POST: {
      summary: 'Merge the change request and close its task as Done (assignee only)',
      responses: [{ status: 200, description: 'Approved', schema: changeRequestDecisionSchema }],
      errors: [
        { status: 403, description: 'Not the task assignee, or missing scope/feature', schema: codeChangesErrorSchema },
        { status: 404, description: 'Not found or not accessible', schema: codeChangesErrorSchema },
        { status: 409, description: 'Not open, not in review, pull request closed, or GitHub refused the merge', schema: codeChangesErrorSchema },
      ],
    },
  },
}
