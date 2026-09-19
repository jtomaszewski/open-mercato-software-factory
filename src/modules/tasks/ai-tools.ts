import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { SortDir, type QueryEngine, type Where } from '@open-mercato/shared/lib/query/types'
import type { TimeTrackingAccessResolver } from '@open-mercato/core/modules/staff/di'
import { requireFeature, readTaskAssignmentGraceDays, type RbacServiceLike } from './lib/auth'
import type { TasksDelegationService } from './lib/delegationService'

const getInput = z.object({ taskId: z.string().uuid().optional(), reference: z.string().trim().min(1).max(100).optional() })
  .refine((input) => Boolean(input.taskId) !== Boolean(input.reference))
const searchInput = z.object({ projectId: z.string().uuid(), query: z.string().trim().max(200).optional(), status: z.string().trim().min(1).max(100).optional() })
type Task = { id: string; time_project_id: string; parent_task_id?: string | null; title: string; reference: string; description?: string | null }
const fields = ['id', 'time_project_id', 'parent_task_id', 'title', 'reference', 'description', 'task_status_id', 'assignee_staff_member_id', 'updated_at']

async function readContext(context: McpToolContext) {
  const ctx: CommandRuntimeContext = {
    container: context.container,
    auth: context.userId ? { sub: context.userId, tenantId: context.tenantId, orgId: context.organizationId } : null,
    selectedOrganizationId: context.organizationId,
    organizationIds: context.organizationId ? [context.organizationId] : [], organizationScope: null,
  }
  const scope = await requireFeature(ctx, 'tasks.view')
  const canManageAll = await context.container.resolve<RbacServiceLike>('rbacService')
    .userHasAllFeatures(scope.userId, ['staff.timesheets.projects.manage'], scope)
  const access = await context.container.resolve<TimeTrackingAccessResolver>('timeTrackingAccessResolver').resolveProjectAccess({
    em: context.container.resolve<EntityManager>('em'), ...scope, canManageAll,
    assignmentGraceDays: await readTaskAssignmentGraceDays(ctx, scope.tenantId),
  })
  return { ctx, scope: { tenantId: scope.tenantId, organizationId: scope.organizationId }, access, query: context.container.resolve<QueryEngine>('queryEngine') }
}

export const aiTools: AiToolDefinition[] = [
  defineAiTool<unknown, unknown>({
    name: 'tasks_get', description: 'Read an accessible task by ID or reference, its parent, latest 100 comments and delegation links.',
    inputSchema: getInput, requiredFeatures: ['tasks.view'], isMutation: false,
    async handler(raw, context) {
      const input = getInput.parse(raw)
      const { ctx, scope, access, query } = await readContext(context)
      const tasks = await query.query<Task>('staff:staff_time_task', {
        ...scope, fields, filters: { ...(input.taskId ? { id: input.taskId } : { reference: input.reference }), deleted_at: null }, page: { page: 1, pageSize: 1 },
      })
      const task = tasks.items[0]
      if (!task || (!access.canManageAll && !access.projectIds.includes(task.time_project_id))) return null
      const parent = task.parent_task_id ? await query.query<Task>('staff:staff_time_task', {
        ...scope, fields, filters: { id: task.parent_task_id, time_project_id: task.time_project_id, deleted_at: null }, page: { page: 1, pageSize: 1 },
      }) : null
      const comments = await query.query<{ id: string; body: string; author_user_id: string | null; created_at: string }>('staff:staff_time_task_comment', {
        ...scope, fields: ['id', 'body', 'author_user_id', 'created_at'], filters: { task_id: task.id, deleted_at: null },
        sort: [{ field: 'created_at', dir: SortDir.Desc }], page: { page: 1, pageSize: 100 },
      })
      const delegations = await context.container.resolve<TasksDelegationService>('tasksDelegationService').getDelegations(ctx, [task.id])
      return { task, parent: parent?.items[0] ?? null, comments: comments.items, delegation: delegations[0]?.delegation ?? null }
    },
  }),
  defineAiTool<unknown, unknown>({
    name: 'tasks_search', description: 'Find up to 50 accessible project tasks, optionally filtered by title and status column slug.',
    inputSchema: searchInput, requiredFeatures: ['tasks.view'], isMutation: false,
    async handler(raw, context) {
      const input = searchInput.parse(raw)
      const { scope, access, query } = await readContext(context)
      if (!access.canManageAll && !access.projectIds.includes(input.projectId)) return { items: [], total: 0 }
      const filters: Where = { time_project_id: input.projectId, deleted_at: null }
      if (input.query) filters.title = { $ilike: `%${input.query.replace(/[%_\\]/g, '\\$&')}%` }
      if (input.status) {
        const statuses = await query.query<{ id: string }>('staff:staff_time_task_status', {
          ...scope, fields: ['id'], filters: { time_project_id: input.projectId, slug: input.status, deleted_at: null }, page: { page: 1, pageSize: 1 },
        })
        if (!statuses.items[0]) return { items: [], total: 0 }
        filters.task_status_id = statuses.items[0].id
      }
      const result = await query.query<Task>('staff:staff_time_task', { ...scope, fields, filters, page: { page: 1, pageSize: 50 } })
      return { items: result.items, total: result.total }
    },
  }),
]
