import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CodeRepository } from '../../data/entities'
import { repositoryUpdateSchema, versionedActionSchema } from '../../data/validators'
import { withRepositoryRoute } from '../route-context'
import { repositoriesTag, repositoryErrorSchema, repositoryMutationResponseSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['repositories.view'] },
  PUT: { requireAuth: true, requireFeatures: ['repositories.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['repositories.manage'] },
}

function serialize(repository: CodeRepository) {
  return {
    id: repository.id,
    connectionId: repository.connectionId,
    githubRepositoryId: repository.githubRepositoryId,
    fullName: repository.fullName,
    baseBranch: repository.baseBranch,
    status: repository.status,
    updatedAt: repository.updatedAt.toISOString(),
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRepositoryRoute(request, ['repositories.view'], async ({ commandContext, tenantId, organizationId }) => {
    const { id } = await context.params
    const repository = await commandContext.container.resolve<EntityManager>('em').findOne(CodeRepository, { id, tenantId, organizationId, deletedAt: null })
    if (!repository) return Response.json({ error: 'repositories.errors.notFound' }, { status: 404 })
    return Response.json(serialize(repository))
  })
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRepositoryRoute(request, ['repositories.manage'], async ({ commandContext }) => {
    const { id } = await context.params
    const input = repositoryUpdateSchema.parse(await readJsonSafe(request, {}))
    const result = await commandContext.container.resolve<CommandBus>('commandBus').execute('repositories.repository.update', { input: { id, ...input }, ctx: commandContext })
    return Response.json(result.result)
  })
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRepositoryRoute(request, ['repositories.manage'], async ({ commandContext }) => {
    const { id } = await context.params
    const input = versionedActionSchema.parse(await readJsonSafe(request, {}))
    const result = await commandContext.container.resolve<CommandBus>('commandBus').execute('repositories.repository.remove', { input: { id, ...input }, ctx: commandContext })
    return Response.json(result.result)
  })
}

export const openApi: OpenApiRouteDoc = { tag: repositoriesTag, summary: 'Repository detail', methods: {
  GET: { summary: 'Read one scoped repository', responses: [{ status: 200, description: 'Repository detail' }], errors: [{ status: 404, description: 'Not found', schema: repositoryErrorSchema }] },
  PUT: { summary: 'Change the repository base branch', requestBody: { contentType: 'application/json', schema: repositoryUpdateSchema }, responses: [{ status: 200, description: 'Updated', schema: repositoryMutationResponseSchema }], errors: [{ status: 409, description: 'Version conflict', schema: repositoryErrorSchema }, { status: 422, description: 'Branch invalid', schema: repositoryErrorSchema }] },
  DELETE: { summary: 'Remove a disabled repository', requestBody: { contentType: 'application/json', schema: versionedActionSchema }, responses: [{ status: 200, description: 'Removed', schema: repositoryMutationResponseSchema }], errors: [{ status: 409, description: 'Disable first or stale version', schema: repositoryErrorSchema }] },
} }
