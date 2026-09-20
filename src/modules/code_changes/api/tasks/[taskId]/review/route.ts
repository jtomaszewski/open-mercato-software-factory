import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTaskRoute } from '../../../../../task_delegation/api/route-context'
import { readTaskReview } from '../../../../lib/review'
import { gitHubForTaskProject } from '../../../../lib/github-source'
import { codeChangesErrorSchema, codeChangesTag } from '../../../openapi'

const paramsSchema = z.object({ taskId: z.string().uuid() })

export const metadata = { GET: { requireAuth: true, requireFeatures: ['task_delegation.view', 'code_changes.view'] } }

export async function GET(request: Request, route: { params: Promise<{ taskId: string }> }) {
  return withTaskRoute(request, ['task_delegation.view', 'code_changes.view'], async ({ commandContext, tenantId, organizationId }) => {
    const { taskId } = paramsSchema.parse(await route.params)
    const review = await readTaskReview(commandContext, taskId, gitHubForTaskProject(commandContext.container, { tenantId, organizationId }))
    return Response.json({ review })
  })
}

const fileSchema = z.object({ filename: z.string(), status: z.string(), additions: z.number(), deletions: z.number(), patch: z.string().nullable() })
const checkSchema = z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable(), url: z.string().nullable() })
export const openApi: OpenApiRouteDoc = {
  tag: codeChangesTag, summary: 'Review data of the pull request linked on a task', methods: {
    GET: {
      summary: 'Changed files, checks and preview of the task PR (null when the task has none)',
      responses: [{
        status: 200,
        description: 'Review data or null',
        schema: z.object({
          review: z.object({
            taskId: z.string().uuid(),
            delegationActive: z.boolean(),
            pr: z.object({ number: z.number(), url: z.string(), state: z.enum(['open', 'closed']), merged: z.boolean(), headSha: z.string() }),
            previewUrl: z.string().nullable(),
            checks: z.array(checkSchema),
            files: z.array(fileSchema),
          }).nullable(),
        }),
      }],
      errors: [{ status: 403, description: 'Missing scope or feature', schema: codeChangesErrorSchema }, { status: 404, description: 'Task not found or not accessible', schema: codeChangesErrorSchema }],
    },
  },
}
