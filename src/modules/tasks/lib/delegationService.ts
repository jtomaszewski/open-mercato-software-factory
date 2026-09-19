import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TimeTrackingAccessResolver } from '@open-mercato/core/modules/staff/di'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AgentPrincipal, ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation, type TaskDelegationLink } from '../data/entities'
import { requireFeature, readTaskAssignmentGraceDays } from './auth'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'

export const TASKS_DELEGATION_SERVICE = 'tasksDelegationService' as const
const logger = createLogger('tasks').child({ component: 'delegation-service' })
export type TasksRunState = 'starting' | 'stalled' | 'running' | 'awaiting_decision' | 'failed' | 'complete'
export type TasksDelegationDto = {
  id: string
  delegateUserId: string
  delegateName: string
  releasedAt: string | null
  updatedAt: string
  processInstanceId: string | null
  links: TaskDelegationLink[]
  outcome: 'done' | 'rejected' | 'failed' | null
  closeReason: string | null
  runState: TasksRunState | null
}
export type TasksDelegationReadItem = { taskId: string; taskUpdatedAt: string; delegation: TasksDelegationDto | null }
export type TasksAgentDto = { userId: string; agentId: string; name: string }

export type TasksDelegationService = {
  getDelegations(ctx: CommandRuntimeContext, taskIds: readonly string[]): Promise<TasksDelegationReadItem[]>
  listAgents(ctx: CommandRuntimeContext): Promise<TasksAgentDto[]>
}

type StaffTaskRead = { id: string; time_project_id: string; updated_at: Date | string }

export function deriveTaskRunState(delegation: TaskDelegation, process: ProcessInstance | null, now: Date): TasksRunState {
  if (delegation.outcome === 'failed') return 'failed'
  if (delegation.outcome === 'done' || delegation.outcome === 'rejected') return 'complete'
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

export function createTasksDelegationService({ em }: { em: EntityManager }): TasksDelegationService {
  return {
    async getDelegations(ctx, taskIds) {
      const scope = await requireFeature(ctx, 'tasks.view')
      const ids = [...new Set(taskIds)].filter(Boolean)
      if (ids.length === 0) return []
      const accessResolver = ctx.container.resolve<TimeTrackingAccessResolver>('timeTrackingAccessResolver')
      const canManageAll = await ctx.container.resolve<{ userHasAllFeatures: (id: string, f: string[], s: { tenantId: string; organizationId: string }) => Promise<boolean> }>('rbacService')
        .userHasAllFeatures(scope.userId, ['staff.timesheets.projects.manage'], scope)
      const access = await accessResolver.resolveProjectAccess({ em, tenantId: scope.tenantId, organizationId: scope.organizationId, userId: scope.userId, canManageAll, assignmentGraceDays: await readTaskAssignmentGraceDays(ctx, scope.tenantId) })
      const tasks = await ctx.container.resolve<QueryEngine>('queryEngine').query<StaffTaskRead>('staff:staff_time_task', {
        fields: ['id', 'time_project_id', 'updated_at'], filters: { id: { $in: ids } }, page: { page: 1, pageSize: 100 },
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
      return allowed.map((task) => {
        const delegation = latest.get(task.id) ?? null
        return {
          taskId: task.id,
          taskUpdatedAt: new Date(task.updated_at).toISOString(),
          delegation: delegation ? {
            id: delegation.id,
            delegateUserId: delegation.delegateUserId,
            delegateName: userById.get(delegation.delegateUserId)?.name ?? userById.get(delegation.delegateUserId)?.email ?? translate('tasks.delegate.missingAgent', 'Unavailable agent'),
            releasedAt: delegation.releasedAt?.toISOString() ?? null,
            updatedAt: delegation.updatedAt.toISOString(),
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
      const scope = await requireFeature(ctx, 'tasks.delegate')
      const hasOrchestrator = typeof (ctx.container as { hasRegistration?: (name: string) => boolean }).hasRegistration === 'function'
        && ctx.container.hasRegistration('AgentPrincipal')
      if (!hasOrchestrator) return []
      const decryptScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
      const principals = await findWithDecryption(em, AgentPrincipal, { ...decryptScope, agentDefinitionId: 'factory', enabled: true, deletedAt: null }, {}, decryptScope)
      if (!principals.length) return []
      const users = await findWithDecryption(em, User, { ...decryptScope, kind: 'agent', deletedAt: null, id: { $in: principals.map((item) => item.userId) } }, {}, decryptScope)
      const usersById = new Map(users.map((user) => [user.id, user]))
      return principals.flatMap((principal) => {
        const user = usersById.get(principal.userId)
        return user ? [{ userId: user.id, agentId: principal.agentDefinitionId, name: user.name ?? user.email }] : []
      })
    },
  }
}
