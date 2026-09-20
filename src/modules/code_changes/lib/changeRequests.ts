import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { requireFeature } from '../../task_delegation/lib/auth'
import { resolveAccess } from '../../task_delegation/lib/delegationService'
import { ChangeRequest, type ChangeRequestStatus } from '../data/entities'

/** One change request as every surface renders it — never the entity, never a raw column set. */
export type ChangeRequestDto = {
  id: string
  taskId: string
  delegationId: string | null
  projectId: string
  projectName: string | null
  title: string
  summary: string | null
  repoFullName: string
  baseBranch: string
  branch: string | null
  number: number | null
  url: string | null
  headSha: string | null
  mergeCommitSha: string | null
  status: ChangeRequestStatus
  statusReason: string | null
  decidedAt: string | null
  decidedByName: string | null
  createdAt: string
  updatedAt: string
}

export type ChangeRequestQuery = { page: number; pageSize: number; status?: ChangeRequestStatus; search?: string }
export type ChangeRequestPage = { items: ChangeRequestDto[]; total: number; page: number; pageSize: number; totalPages: number }

type ProjectRead = { id: string; name: string | null }
type MemberRead = { id: string; display_name: string | null; user_id: string | null }

const MAX_DECIDER_LOOKUP = 100

export function toChangeRequestDto(entity: ChangeRequest, names: { project: string | null; decidedBy: string | null }): ChangeRequestDto {
  return {
    id: entity.id,
    taskId: entity.taskId,
    delegationId: entity.delegationId ?? null,
    projectId: entity.projectId,
    projectName: names.project,
    title: entity.title,
    summary: entity.summary ?? null,
    repoFullName: entity.repoFullName,
    baseBranch: entity.baseBranch,
    branch: entity.branch ?? null,
    number: entity.number ?? null,
    url: entity.url ?? null,
    headSha: entity.headSha ?? null,
    mergeCommitSha: entity.mergeCommitSha ?? null,
    status: entity.status,
    statusReason: entity.statusReason ?? null,
    decidedAt: entity.decidedAt?.toISOString() ?? null,
    decidedByName: names.decidedBy,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  }
}

/** Display names for the projects and deciders of a page of change requests, in two reads. */
async function resolveNames(ctx: CommandRuntimeContext, scope: { tenantId: string; organizationId: string }, entities: ChangeRequest[]) {
  const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
  const projectIds = [...new Set(entities.map((entity) => entity.projectId))]
  const deciderIds = [...new Set(entities.map((entity) => entity.decidedBy).filter((id): id is string => Boolean(id)))]
  const [projects, members] = await Promise.all([
    projectIds.length
      ? queryEngine.query<ProjectRead>('staff:staff_time_project', {
        fields: ['id', 'name'], filters: { id: { $in: projectIds } }, page: { page: 1, pageSize: projectIds.length }, ...scope,
      })
      : null,
    deciderIds.length
      ? queryEngine.query<MemberRead>('staff:staff_team_member', {
        fields: ['id', 'display_name', 'user_id'], filters: { user_id: { $in: deciderIds } }, page: { page: 1, pageSize: MAX_DECIDER_LOOKUP }, ...scope,
      })
      : null,
  ])
  return {
    project: new Map((projects?.items ?? []).map((project) => [project.id, project.name ?? null])),
    // Keyed by user id: the decider is a person acting on the board, and their board name is the
    // one the reader already knows them by.
    decider: new Map((members?.items ?? [])
      .filter((member): member is MemberRead & { user_id: string } => Boolean(member.user_id))
      .map((member) => [member.user_id, member.display_name ?? null])),
  }
}

/**
 * The change requests the caller may see, newest first.
 *
 * Scoped by the change request's own `project_id` against staff's project access, so the list can
 * never show a change to a project the caller cannot open on the board.
 */
export async function listChangeRequests(ctx: CommandRuntimeContext, query: ChangeRequestQuery): Promise<ChangeRequestPage> {
  const scope = await requireFeature(ctx, 'code_changes.view')
  const em = ctx.container.resolve<EntityManager>('em')
  const access = await resolveAccess(ctx, em, scope)
  const decryptScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const empty: ChangeRequestPage = { items: [], total: 0, page: query.page, pageSize: query.pageSize, totalPages: 1 }
  if (!access.canManageAll && !access.projectIds.length) return empty

  const where: FilterQuery<ChangeRequest> = { ...decryptScope, deletedAt: null }
  if (!access.canManageAll) Object.assign(where, { projectId: { $in: access.projectIds } })
  if (query.status) Object.assign(where, { status: query.status })
  const search = query.search?.trim()
  // The title is our own column (the task title snapshotted when the change was proposed), so the
  // search is one query here rather than a detour through staff.
  if (search) Object.assign(where, { title: { $ilike: `%${search.replace(/[%_]/g, '\\$&')}%` } })

  const [entities, total] = await em.findAndCount(ChangeRequest, where, {
    orderBy: { createdAt: 'desc' },
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  })
  if (!entities.length) return { ...empty, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }
  const names = await resolveNames(ctx, decryptScope, entities)
  return {
    items: entities.map((entity) => toChangeRequestDto(entity, {
      project: names.project.get(entity.projectId) ?? null,
      decidedBy: entity.decidedBy ? names.decider.get(entity.decidedBy) ?? null : null,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  }
}

/**
 * One change request. A change request on a project the caller cannot open answers 404, not 403,
 * so the endpoint never confirms that one exists outside their access.
 */
export async function readChangeRequest(ctx: CommandRuntimeContext, id: string): Promise<ChangeRequestDto> {
  const scope = await requireFeature(ctx, 'code_changes.view')
  const em = ctx.container.resolve<EntityManager>('em')
  const decryptScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const { translate } = await resolveTranslations()
  const notFound = () => new CrudHttpError(404, {
    code: 'change_request_not_found',
    error: translate('code_changes.changeRequests.errors.notFound', 'Change request not found.'),
  })
  const entity = await em.findOne(ChangeRequest, { ...decryptScope, id, deletedAt: null })
  if (!entity) throw notFound()
  const access = await resolveAccess(ctx, em, scope)
  if (!access.canManageAll && !access.projectIds.includes(entity.projectId)) throw notFound()
  const names = await resolveNames(ctx, decryptScope, [entity])
  return toChangeRequestDto(entity, {
    project: names.project.get(entity.projectId) ?? null,
    decidedBy: entity.decidedBy ? names.decider.get(entity.decidedBy) ?? null : null,
  })
}

/**
 * The change request of a task, when it has one.
 *
 * The task drawer's approve button predates this entity and still acts on a task id; routing it
 * through here is what keeps one approval from producing two different records of itself.
 */
export async function findTaskChangeRequestId(ctx: CommandRuntimeContext, taskId: string): Promise<string | null> {
  const scope = await requireFeature(ctx, 'code_changes.view')
  const entity = await ctx.container.resolve<EntityManager>('em').findOne(
    ChangeRequest,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, taskId, deletedAt: null },
    { orderBy: { createdAt: 'desc' } },
  )
  return entity?.id ?? null
}
