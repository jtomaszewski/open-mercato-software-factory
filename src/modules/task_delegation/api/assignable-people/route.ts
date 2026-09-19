import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { TaskDelegationService } from '../../lib/delegationService'
import { withTaskRoute } from '../route-context'

// `staff.view` rides along because the population this returns is `staff`'s team directory, gated
// by that feature on `staff`'s own endpoint; this route must not widen who may read it.
export const metadata = { GET: { requireAuth: true, requireFeatures: ['task_delegation.view', 'staff.view'] } }

const querySchema = z.object({ taskId: z.string().uuid() })

export async function GET(request: Request) {
  return withTaskRoute(request, ['task_delegation.view'], async ({ commandContext }) => {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const service = commandContext.container.resolve<TaskDelegationService>('taskDelegationService')
    return Response.json({ items: await service.listAssignablePeople(commandContext, query.taskId) })
  })
}

const errorSchema = z.object({ error: z.string(), code: z.string().optional() })
export const openApi: OpenApiRouteDoc = {
  tag: 'Tasks', summary: 'People assignable on a task', methods: {
    GET: {
      summary: 'List the staff members the caller may assign on the task\'s project (first 200 active members by name; the picker filters them client-side)',
      query: querySchema,
      responses: [{ status: 200, description: 'Assignable people', schema: z.object({ items: z.array(z.object({ staffMemberId: z.string().uuid(), name: z.string(), userId: z.string().uuid().nullable() })) }) }],
      errors: [
        { status: 400, description: 'Malformed task id', schema: errorSchema },
        { status: 403, description: 'Missing scope, feature or project access', schema: errorSchema },
        { status: 404, description: 'Task not found in scope', schema: errorSchema },
      ],
    },
  },
}
