import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { delegateSchema, delegationQuerySchema } from '../../data/validators'
import type { TasksDelegationService } from '../../lib/delegationService'
import type { DelegateTaskInput, DelegateTaskResult } from '../../commands/types'
import { withTaskRoute } from '../route-context'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
  POST: { requireAuth: true, requireFeatures: ['tasks.delegate'] },
}

export async function GET(request: Request) {
  return withTaskRoute(request, ['tasks.view'], async ({ commandContext }) => {
    const query = delegationQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const service = commandContext.container.resolve<TasksDelegationService>('tasksDelegationService')
    return Response.json({ items: await service.getDelegations(commandContext, query.taskIds) })
  })
}

export async function POST(request: Request) {
  return withTaskRoute(request, ['tasks.delegate'], async ({ commandContext, userId, tenantId, organizationId, userFeatures }) => {
    const input = delegateSchema.parse(await readJsonSafe(request, {}))
    const guards = await runRouteMutationGuards({
      container: commandContext.container, req: request,
      auth: { userId, tenantId, organizationId, userFeatures },
      input: { resourceKind: 'staff.timesheets.time_task', resourceId: input.taskId, operation: 'custom', mutationPayload: input },
    })
    if (!guards.ok) return guards.response
    const guarded = delegateSchema.extend({ taskId: z.literal(input.taskId) }).parse({ ...input, ...guards.modifiedPayload })
    const bus = commandContext.container.resolve<CommandBus>('commandBus')
    const executed = await bus.execute<DelegateTaskInput, DelegateTaskResult>('tasks.task.delegate', { input: guarded, ctx: commandContext })
    await guards.runAfterSuccess()
    return Response.json(executed.result, { status: 201 })
  })
}

const errorSchema = z.object({ error: z.string(), code: z.string().optional() })
export const openApi: OpenApiRouteDoc = {
  tag: 'Tasks', summary: 'Agent task delegations', methods: {
    GET: { summary: 'Read scoped delegations for up to 100 task IDs', query: z.object({ taskIds: z.string().min(1) }), responses: [{ status: 200, description: 'Latest delegation and current task version per authorized task' }], errors: [{ status: 400, description: 'Malformed task IDs', schema: errorSchema }, { status: 403, description: 'Missing scope or feature', schema: errorSchema }] },
    POST: { summary: 'Delegate a backlog task to an agent', requestBody: { contentType: 'application/json', schema: delegateSchema }, responses: [{ status: 201, description: 'Delegated', schema: z.object({ taskId: z.string().uuid(), delegationId: z.string().uuid() }) }], errors: [{ status: 403, description: 'Forbidden', schema: errorSchema }, { status: 409, description: 'Stale task, active delegation or invalid transition', schema: errorSchema }, { status: 422, description: 'Invalid agent or missing assignee', schema: errorSchema }, { status: 503, description: 'Factory process unavailable', schema: errorSchema }] },
  },
}
