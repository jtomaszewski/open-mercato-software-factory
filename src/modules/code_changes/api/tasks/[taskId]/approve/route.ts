import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTaskRoute } from '../../../../../task_delegation/api/route-context'
import { approveTaskPullRequest } from '../../../../lib/approve'
import { findTaskChangeRequestId } from '../../../../lib/changeRequests'
import { gitHubForTaskProject } from '../../../../lib/github-source'
import { codeChangesErrorSchema, codeChangesTag } from '../../../openapi'

const paramsSchema = z.object({ taskId: z.string().uuid() })

export const metadata = { POST: { requireAuth: true, requireFeatures: ['task_delegation.delegate', 'code_changes.decide'] } }

/**
 * The task drawer's „Zatwierdź i publikuj”. It acts on a task because that is what the drawer
 * has, but the decision is the change request's: when the task has one, this runs the same
 * command the Code section runs, so one approval never leaves two different records of itself.
 * A task from before change requests existed still approves through the direct path.
 */
export async function POST(request: Request, route: { params: Promise<{ taskId: string }> }) {
  return withTaskRoute(request, ['task_delegation.delegate', 'code_changes.decide'], async ({ commandContext, userId, tenantId, organizationId, userFeatures }) => {
    const { taskId } = paramsSchema.parse(await route.params)
    const guards = await runRouteMutationGuards({
      container: commandContext.container, req: request,
      auth: { userId, tenantId, organizationId, userFeatures },
      input: { resourceKind: 'staff.timesheets.time_task', resourceId: taskId, operation: 'custom', mutationPayload: { taskId } },
    })
    if (!guards.ok) return guards.response
    const changeRequestId = await findTaskChangeRequestId(commandContext, taskId)
    if (changeRequestId) {
      await commandContext.container.resolve<CommandBus>('commandBus')
        .execute('code_changes.change_request.approve', { input: { id: changeRequestId }, ctx: commandContext })
      await guards.runAfterSuccess()
      return Response.json({ taskId, changeRequestId, merged: true })
    }
    const result = await approveTaskPullRequest(commandContext, taskId, gitHubForTaskProject(commandContext.container, { tenantId, organizationId }))
    await guards.runAfterSuccess()
    return Response.json(result)
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: codeChangesTag, summary: 'Approve the pull request of a delegated task', methods: {
    POST: {
      summary: 'Merge the PR linked on the task and close the task as Done (assignee only)',
      responses: [{ status: 200, description: 'Merged and closed', schema: z.object({ taskId: z.string().uuid(), merged: z.literal(true), changeRequestId: z.string().uuid().optional(), prUrl: z.string().optional(), alreadyMerged: z.boolean().optional() }) }],
      errors: [
        { status: 403, description: 'Not the task assignee, or missing scope/feature', schema: codeChangesErrorSchema },
        { status: 404, description: 'Task not found or not accessible', schema: codeChangesErrorSchema },
        { status: 409, description: 'Not delegated, no PR, not in review, PR closed, or GitHub refused the merge', schema: codeChangesErrorSchema },
      ],
    },
  },
}
