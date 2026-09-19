import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CodeRepository, RepositoryProjectLink } from '../../data/entities'
import { projectLinkRemoveSchema, projectLinkSchema, type ProjectLinkInput, type ProjectLinkRemoveInput } from '../../data/validators'
import { withRepositoryRoute } from '../route-context'
import { requireRouteProjectAccess } from '../project-access'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['repositories.link'] },
  POST: { requireAuth: true, requireFeatures: ['repositories.link'] },
  DELETE: { requireAuth: true, requireFeatures: ['repositories.link'] },
}

const querySchema = z.object({ projectId: z.string().uuid() })

export async function GET(request: Request) {
  return withRepositoryRoute(request, ['repositories.link'], async (context) => {
    const { projectId } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    await requireRouteProjectAccess(context, projectId)
    const em = context.commandContext.container.resolve<EntityManager>('em').fork()
    const links = await em.find(RepositoryProjectLink, { tenantId: context.tenantId, organizationId: context.organizationId, projectId }, { orderBy: { createdAt: 'asc' } })
    const items = await Promise.all(links.map(async (link) => {
      const repository = await em.findOne(CodeRepository, { id: link.repositoryId, tenantId: context.tenantId, organizationId: context.organizationId, deletedAt: null })
      return repository ? { id: link.id, projectId, repositoryId: repository.id, fullName: repository.fullName, kind: repository.kind, isDefault: link.isDefault, updatedAt: link.updatedAt.toISOString() } : null
    }))
    return Response.json({ items: items.filter((item): item is NonNullable<typeof item> => item !== null) })
  })
}

export async function POST(request: Request) {
  return withRepositoryRoute(request, ['repositories.link'], async (context) => {
    const input = projectLinkSchema.parse(await readJsonSafe(request, {}))
    await requireRouteProjectAccess(context, input.projectId)
    const result = await context.commandContext.container.resolve<CommandBus>('commandBus').execute<ProjectLinkInput, Record<string, unknown>>('repositories.project_link.set', { input, ctx: context.commandContext })
    const { undoState: _undoState, ...response } = result.result
    return Response.json(response)
  })
}

export async function DELETE(request: Request) {
  return withRepositoryRoute(request, ['repositories.link'], async (context) => {
    const input = projectLinkRemoveSchema.parse(await readJsonSafe(request, {}))
    await requireRouteProjectAccess(context, input.projectId)
    const result = await context.commandContext.container.resolve<CommandBus>('commandBus').execute<ProjectLinkRemoveInput, Record<string, unknown>>('repositories.project_link.remove', { input, ctx: context.commandContext })
    const { undoState: _undoState, ...response } = result.result
    return Response.json(response)
  })
}

const projectLinkResponseSchema = z.object({ id: z.string().uuid(), projectId: z.string().uuid(), repositoryId: z.string().uuid(), isDefault: z.boolean(), updatedAt: z.string().datetime() })
const errorSchema = z.object({ error: z.string(), code: z.string().optional() })
export const openApi: OpenApiRouteDoc = {
  tag: 'Repositories', summary: 'Project repository links', methods: {
    GET: { summary: 'List repository links for a staff project', responses: [{ status: 200, description: 'Project repository links', schema: z.object({ items: z.array(projectLinkResponseSchema.extend({ fullName: z.string(), kind: z.enum(['pr_only', 'static_site']) })) }) }], errors: [{ status: 403, description: 'Missing project access', schema: errorSchema }, { status: 404, description: 'Project not found', schema: errorSchema }] },
    POST: { summary: 'Set a project repository link', requestBody: { contentType: 'application/json', schema: projectLinkSchema }, responses: [{ status: 200, description: 'Project repository link', schema: projectLinkResponseSchema }], errors: [{ status: 403, description: 'Missing project access', schema: errorSchema }, { status: 404, description: 'Project or repository not found', schema: errorSchema }, { status: 409, description: 'Stale link or concurrent default change', schema: errorSchema }] },
    DELETE: { summary: 'Remove a project repository link', requestBody: { contentType: 'application/json', schema: projectLinkRemoveSchema }, responses: [{ status: 200, description: 'Removed project repository link', schema: projectLinkResponseSchema }], errors: [{ status: 403, description: 'Missing project access', schema: errorSchema }, { status: 404, description: 'Project link not found', schema: errorSchema }, { status: 409, description: 'Stale project link', schema: errorSchema }] },
  },
}
