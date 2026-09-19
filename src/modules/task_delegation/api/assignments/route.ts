import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { assignInputSchema, assignSchema } from '../../data/validators'
import type { AssignTaskInput, AssignTaskResult } from '../../commands/types'
import { withTaskRoute } from '../route-context'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['task_delegation.view'] },
}

/**
 * One assignment, whichever halves it carries. The `task_delegation.delegate` feature is checked by
 * the command itself, and only when an agent is part of the act, so a colleague without it can
 * still assign a person.
 */
export async function POST(request: Request) {
  return withTaskRoute(request, ['task_delegation.view'], async ({ commandContext, userId, tenantId, organizationId, userFeatures }) => {
    const input = assignSchema.parse(await readJsonSafe(request, {}))
    const guards = await runRouteMutationGuards({
      container: commandContext.container, req: request,
      auth: { userId, tenantId, organizationId, userFeatures },
      input: { resourceKind: 'staff.timesheets.time_task', resourceId: input.taskId, operation: 'custom', mutationPayload: input },
    })
    if (!guards.ok) return guards.response
    // A guard may rewrite the halves; rewriting which task is being assigned is refused.
    const guarded = assignInputSchema.extend({ taskId: z.literal(input.taskId) }).parse({ ...input, ...guards.modifiedPayload })
    const bus = commandContext.container.resolve<CommandBus>('commandBus')
    const executed = await bus.execute<AssignTaskInput, AssignTaskResult>('task_delegation.task.assign', { input: guarded, ctx: commandContext })
    await guards.runAfterSuccess()
    const { taskId, assigneeStaffMemberId, delegation } = executed.result
    return Response.json({ taskId, assigneeStaffMemberId, delegation })
  })
}

const errorSchema = z.object({ error: z.string(), code: z.string().optional() })
export const openApi: OpenApiRouteDoc = {
  tag: 'Tasks', summary: 'Task assignment', methods: {
    POST: {
      summary: 'Assign a task to a person, to a person and an agent, or to an agent alone',
      requestBody: { contentType: 'application/json', schema: assignInputSchema },
      responses: [{ status: 200, description: 'Assigned', schema: z.object({ taskId: z.string().uuid(), assigneeStaffMemberId: z.string().uuid().nullable(), delegation: z.object({ id: z.string().uuid() }).nullable() }) }],
      errors: [
        { status: 403, description: 'Missing scope, feature or project access', schema: errorSchema },
        { status: 409, description: 'Stale task version, an active delegation, a process-owned task or a refused transition', schema: errorSchema },
        { status: 422, description: 'Invalid agent, or an assignee cleared while delegating', schema: errorSchema },
        { status: 503, description: 'Factory process unavailable', schema: errorSchema },
      ],
    },
  },
}
