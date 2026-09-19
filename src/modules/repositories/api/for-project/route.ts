import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { RepositoryTargetResolver } from '../../lib/target-resolver'
import { withRepositoryRoute } from '../route-context'
import { requireRouteProjectAccess } from '../project-access'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['task_delegation.delegate'] } }
const querySchema = z.object({ projectId: z.string().uuid() })

export async function GET(request: Request) {
  return withRepositoryRoute(request, ['task_delegation.delegate'], async (context) => {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    await requireRouteProjectAccess(context, query.projectId)
    const items = await context.commandContext.container.resolve<RepositoryTargetResolver>('repositoryTargetResolver').listProjectTargets({
      tenantId: context.tenantId, organizationId: context.organizationId, projectId: query.projectId,
    })
    return Response.json({ items })
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Repositories', summary: 'Project repositories', methods: {
    GET: { summary: 'List repository targets linked to a staff project', responses: [{ status: 200, description: 'Project repository targets', schema: z.object({ items: z.array(z.object({ id: z.string().uuid(), fullName: z.string(), kind: z.enum(['pr_only', 'static_site']), isDefault: z.boolean(), usable: z.boolean(), reason: z.string().optional(), updatedAt: z.string().datetime() })) }) }], errors: [{ status: 403, description: 'Missing project access', schema: z.object({ error: z.string(), code: z.string().optional() }) }, { status: 404, description: 'Project not found', schema: z.object({ error: z.string(), code: z.string().optional() }) }] },
  },
}
