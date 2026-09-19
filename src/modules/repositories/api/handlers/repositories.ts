import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { CodeRepository } from '../../data/entities'
import { repositoryListSchema, repositoryRegisterSchema } from '../../data/validators'
import { withRepositoryRoute } from '../route-context'
import { repositoriesTag, repositoryErrorSchema, repositoryMutationResponseSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['repositories.view'] },
  POST: { requireAuth: true, requireFeatures: ['repositories.manage'] },
}

function serialize(repository: CodeRepository) {
  return {
    id: repository.id,
    connectionId: repository.connectionId,
    githubRepositoryId: repository.githubRepositoryId,
    fullName: repository.fullName,
    baseBranch: repository.baseBranch,
    kind: repository.kind,
    profile: repository.profile,
    configEpoch: repository.configEpoch,
    qualificationStatus: repository.qualificationStatus,
    qualificationEpoch: repository.qualificationEpoch ?? null,
    qualificationReport: repository.qualificationReport ?? null,
    qualificationAttemptId: repository.qualificationAttemptId ?? null,
    qualificationStartedAt: repository.qualificationStartedAt?.toISOString() ?? null,
    status: repository.status,
    accessStatus: repository.accessStatus,
    updatedAt: repository.updatedAt.toISOString(),
  }
}

export async function GET(request: Request) {
  return withRepositoryRoute(request, ['repositories.view'], async ({ commandContext, tenantId, organizationId }) => {
    const query = repositoryListSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const where: FilterQuery<CodeRepository> = { tenantId, organizationId, deletedAt: null }
    if (query.kind) where.kind = query.kind
    if (query.status) where.status = query.status
    if (query.search) where.fullName = { $ilike: `%${query.search.replace(/[%_]/g, '\\$&')}%` }
    const [items, total] = await commandContext.container.resolve<EntityManager>('em').findAndCount(CodeRepository, where, {
      orderBy: { fullName: 'asc' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    })
    return Response.json({ items: items.map(serialize), total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) })
  })
}

export async function POST(request: Request) {
  return withRepositoryRoute(request, ['repositories.manage'], async ({ commandContext }) => {
    const input = repositoryRegisterSchema.parse(await readJsonSafe(request, {}))
    const result = await commandContext.container.resolve<CommandBus>('commandBus').execute('repositories.repository.register', { input, ctx: commandContext })
    return Response.json(result.result, { status: 201 })
  })
}

export const openApi: OpenApiRouteDoc = { tag: repositoriesTag, summary: 'Registered code repositories', methods: {
  GET: { summary: 'List scoped code repositories', query: repositoryListSchema, responses: [{ status: 200, description: 'Repository page' }], errors: [{ status: 403, description: 'Forbidden', schema: repositoryErrorSchema }] },
  POST: { summary: 'Register one granted repository and start qualification', requestBody: { contentType: 'application/json', schema: repositoryRegisterSchema }, responses: [{ status: 201, description: 'Registered', schema: repositoryMutationResponseSchema }], errors: [{ status: 409, description: 'Already registered', schema: repositoryErrorSchema }, { status: 422, description: 'Grant or branch invalid', schema: repositoryErrorSchema }, { status: 502, description: 'Broker unavailable', schema: repositoryErrorSchema }] },
} }

export { serialize as serializeRepository }
