import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TimeTrackingAccessResolver } from '@open-mercato/core/modules/staff/di'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AgentPrincipal, ProcessDefinition, ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation, type TaskDelegationLink } from '../data/entities'
import { findRosterEntry, rosterAgentDefinitionIds, rosterProcessNames } from './agentRoster'
import { requireFeature, readTaskAssignmentGraceDays, type TaskScope } from './auth'
import { readTaskSnapshot } from './taskSnapshot'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'

export const TASK_DELEGATION_SERVICE = 'taskDelegationService' as const
const logger = createLogger('task_delegation').child({ component: 'delegation-service' })
export type TaskDelegationRunState = 'starting' | 'stalled' | 'running' | 'awaiting_decision' | 'failed' | 'rejected' | 'complete'
export type TaskDelegationDto = {
  id: string
  delegateUserId: string
  delegateName: string
  releasedAt: string | null
  updatedAt: string
  /** When the delegation was created — what "Pracuje · 12 min" counts from. Additive field. */
  startedAt: string
  processInstanceId: string | null
  links: TaskDelegationLink[]
  outcome: 'done' | 'rejected' | 'failed' | null
  closeReason: string | null
  runState: TaskDelegationRunState | null
}
export type TaskDelegationReadItem = {
  taskId: string
  taskUpdatedAt: string
  assigneeStaffMemberId: string | null
  assigneeName: string | null
  delegation: TaskDelegationDto | null
}
export type TaskAssignablePersonDto = { staffMemberId: string; name: string; userId: string | null }
export type TaskDelegationAgentDto = { userId: string; agentId: string; name: string; label: string; description: string }

export type TaskDelegationService = {
  getDelegations(ctx: CommandRuntimeContext, taskIds: readonly string[]): Promise<TaskDelegationReadItem[]>
  listAgents(ctx: CommandRuntimeContext): Promise<TaskDelegationAgentDto[]>
  listAssignablePeople(ctx: CommandRuntimeContext, taskId: string): Promise<TaskAssignablePersonDto[]>
}

type StaffTaskRead = { id: string; time_project_id: string; updated_at: Date | string; assignee_staff_member_id: string | null }
type StaffMemberRead = { id: string; display_name: string | null; user_id: string | null }

/** The page the picker's *People* section reads; staff's own drawer reads a comparable slice. */
const ASSIGNABLE_PEOPLE_PAGE_SIZE = 200

export function deriveTaskRunState(delegation: TaskDelegation, process: ProcessInstance | null, now: Date): TaskDelegationRunState {
  if (delegation.outcome === 'failed') return 'failed'
  if (delegation.outcome === 'rejected') return 'rejected'
  if (delegation.outcome === 'done') return 'complete'
  if (!delegation.processInstanceId || !process) {
    return now.getTime() - delegation.createdAt.getTime() > 60_000 ? 'stalled' : 'starting'
  }
  if (process.status === 'failed' || process.status === 'cancelled') return 'failed'
  if (process.status === 'completed' || process.status === 'auto_completed') return 'complete'
  if (process.pendingProposalCount > 0 || process.status === 'waiting_on_you' || process.status === 'question_open' || process.status === 'docs_requested') {
    return 'awaiting_decision'
  }
  return 'running'
}

/**
 * The projects the caller may act on, resolved through staff's own access resolver rather than
 * through a membership table of ours.
 */
async function resolveAccess(ctx: CommandRuntimeContext, em: EntityManager, scope: TaskScope): Promise<{ canManageAll: boolean; projectIds: string[] }> {
  const accessResolver = ctx.container.resolve<TimeTrackingAccessResolver>('timeTrackingAccessResolver')
  const canManageAll = await ctx.container.resolve<{ userHasAllFeatures: (id: string, f: string[], s: { tenantId: string; organizationId: string }) => Promise<boolean> }>('rbacService')
    .userHasAllFeatures(scope.userId, ['staff.timesheets.projects.manage'], scope)
  return accessResolver.resolveProjectAccess({
    em, tenantId: scope.tenantId, organizationId: scope.organizationId, userId: scope.userId,
    canManageAll, assignmentGraceDays: await readTaskAssignmentGraceDays(ctx, scope.tenantId),
  })
}

export function createTaskDelegationService({ em }: { em: EntityManager }): TaskDelegationService {
  return {
    async getDelegations(ctx, taskIds) {
      const scope = await requireFeature(ctx, 'task_delegation.view')
      const ids = [...new Set(taskIds)].filter(Boolean)
      if (ids.length === 0) return []
      const access = await resolveAccess(ctx, em, scope)
      const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
      const tasks = await queryEngine.query<StaffTaskRead>('staff:staff_time_task', {
        fields: ['id', 'time_project_id', 'updated_at', 'assignee_staff_member_id'], filters: { id: { $in: ids } }, page: { page: 1, pageSize: 100 },
        tenantId: scope.tenantId, organizationId: scope.organizationId,
      })
      const allowed = tasks.items.filter((task) => access.canManageAll || access.projectIds.includes(task.time_project_id))
      const allowedIds = allowed.map((task) => task.id)
      if (allowedIds.length === 0) return []
      const decryptScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
      const delegations = await findWithDecryption(em, TaskDelegation, { ...decryptScope, taskId: { $in: allowedIds } }, { orderBy: { createdAt: 'desc' } }, decryptScope)
      const latest = new Map<string, TaskDelegation>()
      for (const delegation of delegations) if (!latest.has(delegation.taskId)) latest.set(delegation.taskId, delegation)
      const processIds = [...new Set(delegations.map((item) => item.processInstanceId).filter((id): id is string => Boolean(id)))]
      const hasOrchestrator = typeof (ctx.container as { hasRegistration?: (name: string) => boolean }).hasRegistration === 'function'
        && ctx.container.hasRegistration('ProcessInstance')
      let processes: ProcessInstance[] = []
      let processReadsAvailable = hasOrchestrator
      if (hasOrchestrator && processIds.length) {
        try {
          processes = await findWithDecryption(em, ProcessInstance, { ...decryptScope, id: { $in: processIds } }, {}, decryptScope)
        } catch (error) {
          processReadsAvailable = false
          logger.warn('optional process state unavailable', {
            organizationId: scope.organizationId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      const processById = new Map(processes.map((process) => [process.id, process]))
      const delegateIds = [...new Set(delegations.map((item) => item.delegateUserId))]
      const users = delegateIds.length ? await findWithDecryption(em, User, { ...decryptScope, id: { $in: delegateIds }, deletedAt: null }, {}, decryptScope) : []
      const userById = new Map(users.map((user) => [user.id, user]))
      const now = new Date()
      const { translate } = await resolveTranslations()
      // The picker's trigger shows who owns the task, so the read that feeds it carries the human
      // half too — additive fields, the delegation shape below is unchanged.
      const memberIds = [...new Set(allowed.map((task) => task.assignee_staff_member_id).filter((id): id is string => Boolean(id)))]
      const members = memberIds.length
        ? await queryEngine.query<StaffMemberRead>('staff:staff_team_member', {
          fields: ['id', 'display_name', 'user_id'], filters: { id: { $in: memberIds } }, page: { page: 1, pageSize: 100 },
          tenantId: scope.tenantId, organizationId: scope.organizationId,
        })
        : null
      const memberNames = new Map((members?.items ?? []).map((member) => [member.id, member.display_name ?? member.id]))
      return allowed.map((task) => {
        const delegation = latest.get(task.id) ?? null
        return {
          taskId: task.id,
          taskUpdatedAt: new Date(task.updated_at).toISOString(),
          assigneeStaffMemberId: task.assignee_staff_member_id ?? null,
          assigneeName: task.assignee_staff_member_id ? memberNames.get(task.assignee_staff_member_id) ?? null : null,
          delegation: delegation ? {
            id: delegation.id,
            delegateUserId: delegation.delegateUserId,
            delegateName: userById.get(delegation.delegateUserId)?.name ?? userById.get(delegation.delegateUserId)?.email ?? translate('task_delegation.delegate.missingAgent', 'Unavailable agent'),
            releasedAt: delegation.releasedAt?.toISOString() ?? null,
            updatedAt: delegation.updatedAt.toISOString(),
            startedAt: delegation.createdAt.toISOString(),
            processInstanceId: delegation.processInstanceId ?? null,
            links: delegation.links,
            outcome: delegation.outcome ?? null,
            closeReason: delegation.closeReason ?? null,
            runState: processReadsAvailable ? deriveTaskRunState(delegation, delegation.processInstanceId ? processById.get(delegation.processInstanceId) ?? null : null, now) : null,
          } : null,
        }
      })
    },
    async listAgents(ctx) {
      const scope = await requireFeature(ctx, 'task_delegation.delegate')
      const hasOrchestrator = typeof (ctx.container as { hasRegistration?: (name: string) => boolean }).hasRegistration === 'function'
        && ctx.container.hasRegistration('AgentPrincipal')
        && ctx.container.hasRegistration('ProcessDefinition')
      if (!hasOrchestrator) return []
      const decryptScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
      const principals = await findWithDecryption(em, AgentPrincipal, { ...decryptScope, agentDefinitionId: { $in: rosterAgentDefinitionIds() }, enabled: true, deletedAt: null }, {}, decryptScope)
      if (!principals.length) return []
      // A roster entry whose process cannot be started is not an offer we can honour: the
      // delegate command answers `orchestrator_unavailable` for it, so it is never listed.
      const definitions = await findWithDecryption(em, ProcessDefinition, { ...decryptScope, name: { $in: rosterProcessNames() }, enabled: true, deletedAt: null }, {}, decryptScope)
      const startable = new Set(definitions
        .filter((definition) => definition.triggers?.some((trigger) => trigger.kind === 'manual'))
        .map((definition) => definition.name))
      const users = await findWithDecryption(em, User, { ...decryptScope, kind: 'agent', deletedAt: null, id: { $in: principals.map((item) => item.userId) } }, {}, decryptScope)
      const usersById = new Map(users.map((user) => [user.id, user]))
      const { translate } = await resolveTranslations()
      return principals.flatMap((principal) => {
        const entry = findRosterEntry(principal.agentDefinitionId)
        if (!entry || !startable.has(entry.processName)) return []
        const user = usersById.get(principal.userId)
        return user ? [{
          userId: user.id,
          agentId: principal.agentDefinitionId,
          name: user.name ?? user.email,
          label: translate(entry.labelKey, entry.labelFallback),
          description: translate(entry.descriptionKey, entry.descriptionFallback),
        }] : []
      })
    },
    /**
     * The *People* half of the picker. `staff` itself offers every active team member on its own
     * assignee field and gates the task by project access, so this route gates the same way and
     * reads the same population — it exists so our surfaces stop reading staff's list endpoint.
     */
    async listAssignablePeople(ctx, taskId) {
      const scope = await requireFeature(ctx, 'task_delegation.view')
      // Reading the team directory is `staff`'s own call — `staff.view` on its `/api/staff/
      // team-members`. Requiring it here keeps this route from widening who may enumerate staff.
      await requireFeature(ctx, 'staff.view')
      const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
      const snapshot = await readTaskSnapshot(queryEngine, scope, { taskId })
      const access = await resolveAccess(ctx, em, scope)
      if (!access.canManageAll && !access.projectIds.includes(snapshot.timeProjectId)) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(403, { code: 'project_forbidden', error: translate('task_delegation.errors.projectForbidden', 'Task project access is required.') })
      }
      const members = await queryEngine.query<StaffMemberRead>('staff:staff_team_member', {
        fields: ['id', 'display_name', 'user_id'],
        filters: { is_active: true },
        sort: [{ field: 'display_name', dir: SortDir.Asc }],
        page: { page: 1, pageSize: ASSIGNABLE_PEOPLE_PAGE_SIZE },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      return members.items.map((member) => ({
        staffMemberId: member.id,
        name: member.display_name ?? member.id,
        userId: member.user_id ?? null,
      }))
    },
  }
}
