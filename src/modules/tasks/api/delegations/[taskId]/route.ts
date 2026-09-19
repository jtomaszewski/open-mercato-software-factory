import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { undelegateSchema } from '../../../data/validators'
import type { UndelegateTaskInput, UndelegateTaskResult } from '../../../commands/types'
import { withTaskRoute } from '../../route-context'

export const metadata = { DELETE: { requireAuth: true, requireFeatures: ['tasks.delegate'] } }
export async function DELETE(request: Request, route: { params: Promise<{ taskId: string }> }) {
  return withTaskRoute(request, ['tasks.delegate'], async ({ commandContext, userId, tenantId, organizationId, userFeatures }) => {
    const input = undelegateSchema.parse(await route.params)
    const guards = await runRouteMutationGuards({
      container: commandContext.container, req: request,
      auth: { userId, tenantId, organizationId, userFeatures },
      input: { resourceKind: 'staff.timesheets.time_task', resourceId: input.taskId, operation: 'custom', mutationPayload: input },
    })
    if (!guards.ok) return guards.response
    const guarded = undelegateSchema.extend({ taskId: z.literal(input.taskId) }).parse({ ...input, ...guards.modifiedPayload })
    const bus = commandContext.container.resolve<CommandBus>('commandBus')
    const executed = await bus.execute<UndelegateTaskInput, UndelegateTaskResult>('tasks.task.undelegate', { input: guarded, ctx: commandContext })
    await guards.runAfterSuccess()
    return Response.json(executed.result)
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Tasks', summary: 'Remove task delegation', methods: {
    DELETE: { summary: 'Release a task before its sizing decision', responses: [{ status: 200, description: 'Delegation released or already absent' }], errors: [{ status: 403, description: 'Forbidden' }, { status: 409, description: 'Stale task or sizing decision already reached' }] },
  },
}
