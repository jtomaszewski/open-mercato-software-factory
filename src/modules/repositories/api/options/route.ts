import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CodeRepository } from '../../data/entities'
import { withRepositoryRoute } from '../route-context'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['repositories.view'] } }
const querySchema = z.object({ search: z.string().trim().max(200).optional(), page: z.coerce.number().int().min(1).default(1) })

export async function GET(request: Request) {
  return withRepositoryRoute(request, ['repositories.view'], async ({ commandContext, tenantId, organizationId }) => {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const where: FilterQuery<CodeRepository> = { tenantId, organizationId, deletedAt: null }
    if (query.search) where.fullName = { $ilike: `%${query.search}%` }
    const [rows, totalCount] = await commandContext.container.resolve<EntityManager>('em').fork().findAndCount(CodeRepository, where, {
      orderBy: { fullName: 'asc' }, limit: 50, offset: (query.page - 1) * 50,
    })
    return Response.json({ items: rows.map((repository) => ({ id: repository.id, fullName: repository.fullName, kind: repository.kind, qualificationStatus: repository.qualificationStatus })), totalCount })
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Repositories', summary: 'Repository options', methods: {
    GET: { summary: 'List repositories available for project linking', responses: [{ status: 200, description: 'Repository options', schema: z.object({ items: z.array(z.object({ id: z.string().uuid(), fullName: z.string(), kind: z.enum(['pr_only', 'static_site']), qualificationStatus: z.string() })), totalCount: z.number().int() }) }] },
  },
}
