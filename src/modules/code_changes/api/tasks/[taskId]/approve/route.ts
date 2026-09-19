import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTaskRoute } from '../../../../../task_delegation/api/route-context'
import { approveTaskPullRequest } from '../../../../lib/approve'
import { gitHubForTaskProject } from '../../../../lib/github-source'

const paramsSchema = z.object({ taskId: z.string().uuid() })

export const metadata = { POST: { requireAuth: true, requireFeatures: ['task_delegation.delegate'] } }

export async function POST(request: Request, route: { params: Promise<{ taskId: string }> }) {
  return withTaskRoute(request, ['task_delegation.delegate'], async ({ commandContext, userId, tenantId, organizationId, userFeatures }) => {
    const { taskId } = paramsSchema.parse(await route.params)
    const guards = await runRouteMutationGuards({
      container: commandContext.container, req: request,
      auth: { userId, tenantId, organizationId, userFeatures },
      input: { resourceKind: 'staff.timesheets.time_task', resourceId: taskId, operation: 'custom', mutationPayload: { taskId } },
    })
    if (!guards.ok) return guards.response
    const result = await approveTaskPullRequest(commandContext, taskId, gitHubForTaskProject(commandContext.container, { tenantId, organizationId }))
    await guards.runAfterSuccess()
    return Response.json(result)
  })
}

const errorSchema = z.object({ error: z.string(), code: z.string().optional() })
export const openApi: OpenApiRouteDoc = {
  tag: 'Code changes', summary: 'Approve the pull request of a delegated task', methods: {
    POST: {
      summary: 'Merge the PR linked on the task and close the task as Done (assignee only)',
      responses: [{ status: 200, description: 'Merged and closed', schema: z.object({ taskId: z.string().uuid(), prUrl: z.string(), merged: z.literal(true), alreadyMerged: z.boolean() }) }],
      errors: [
        { status: 403, description: 'Not the task assignee, or missing scope/feature', schema: errorSchema },
        { status: 404, description: 'Task not found or not accessible', schema: errorSchema },
        { status: 409, description: 'Not delegated, no PR, not in review, PR closed, or GitHub refused the merge', schema: errorSchema },
      ],
    },
  },
}
