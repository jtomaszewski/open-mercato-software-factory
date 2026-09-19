import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandInterceptor, CommandInterceptorBeforeResult, CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { TaskDelegation } from '../data/entities'
import type { TaskScope } from '../lib/auth'
import { evaluateHumanTaskMutation, type DelegationOutcome } from '../lib/transitionPolicy'
import { consumeInternalTaskTransition } from '../lib/columnContext'
import { readTaskSnapshot } from '../lib/taskSnapshot'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

type InputRecord = { id?: string; taskStatusId?: string }
type GuardMetadata = { releaseDelegationId?: string; releaseOutcome?: 'done' | 'rejected' }

async function rejection(code: 'process_owned' | 'process_only_column'): Promise<CommandInterceptorBeforeResult> {
  const { translate } = await resolveTranslations()
  return { ok: false, status: 409, body: {
    code,
    error: code === 'process_owned'
      ? translate('task_delegation.errors.processOwned', 'The task is owned by an active process.')
      : translate('task_delegation.errors.processOnlyColumn', 'This column is managed by the task process.'),
  } }
}

/** Staff 0.8.0 gives interceptors the caller's auth and organization, not the command context. */
function guardScope(context: CommandInterceptorContext): TaskScope | null {
  const tenantId = context.auth?.tenantId ?? null
  const organizationId = context.selectedOrganizationId ?? context.auth?.orgId ?? null
  const userId = context.auth?.sub ?? null
  return tenantId && organizationId && userId ? { tenantId, organizationId, userId } : null
}

function forkEm(context: CommandInterceptorContext): EntityManager {
  return (context.container.resolve('em') as EntityManager).fork()
}

async function activeDelegations(em: EntityManager, scope: TaskScope, taskIds: readonly string[]): Promise<TaskDelegation[]> {
  // The delegation filter takes only tenant and organization, never the actor.
  const { tenantId, organizationId } = scope
  return taskIds.length ? em.find(TaskDelegation, { tenantId, organizationId, taskId: { $in: [...taskIds] }, releasedAt: null }) : []
}

function readUndoTaskId(undoContext: { input: unknown; logEntry: unknown }): string | null {
  const logEntry = undoContext.logEntry && typeof undoContext.logEntry === 'object'
    ? undoContext.logEntry as Record<string, unknown>
    : null
  if (typeof logEntry?.resourceId === 'string' && logEntry.resourceId) return logEntry.resourceId
  const seen = new Set<unknown>()
  const visit = (value: unknown): string | null => {
    if (!value || typeof value !== 'object' || seen.has(value)) return null
    seen.add(value)
    const record = value as Record<string, unknown>
    if (typeof record.id === 'string' && record.id) return record.id
    for (const key of ['undo', 'before', 'after', 'snapshotBefore', 'snapshotAfter', 'value']) {
      const found = visit(record[key])
      if (found) return found
    }
    return null
  }
  return visit(undoContext.input) ?? visit(logEntry)
}

function makeGuard(targetCommand: string, operation: 'create' | 'status_change' | 'update' | 'delete'): CommandInterceptor {
  return {
    id: `task_delegation.guard-process-owned.${operation}`,
    targetCommand,
    priority: 5,
    async beforeExecute(rawInput, context) {
      if (operation === 'create') return { ok: true }
      const scope = guardScope(context)
      if (!scope) return rejection('process_owned')
      const input = (rawInput ?? {}) as InputRecord
      if (!input.id) return rejection('process_owned')
      const em = forkEm(context)
      const snapshot = await readTaskSnapshot(context.container.resolve<QueryEngine>('queryEngine'), scope, { taskId: input.id, includeChildren: true })
      const delegations = await activeDelegations(em, scope, [snapshot.taskId, ...snapshot.childTaskIds])
      const ownDelegation = delegations.find((item) => item.taskId === snapshot.taskId) ?? null
      if (operation === 'delete' || (operation === 'update' && !input.taskStatusId)) {
        return delegations.length ? rejection('process_owned') : { ok: true }
      }
      if (!input.taskStatusId) return rejection('process_owned')
      const rows = await context.container.resolve<QueryEngine>('queryEngine').query<{ slug: string }>('staff:staff_time_task_status', {
        fields: ['slug'], filters: { id: input.taskStatusId, time_project_id: snapshot.timeProjectId }, page: { page: 1, pageSize: 1 },
        tenantId: scope.tenantId, organizationId: scope.organizationId,
      })
      const targetSlug = rows.items[0]?.slug
      if (!targetSlug) return rejection('process_only_column')
      if (consumeInternalTaskTransition(context.auth, snapshot.taskId, targetSlug)) return { ok: true }
      if (operation === 'update' && delegations.length > 0) {
        const statusFields = new Set(['id', 'taskStatusId', 'tenantId', 'organizationId'])
        if (Object.keys(input).some((key) => !statusFields.has(key))) return rejection('process_owned')
      }
      if (!ownDelegation && delegations.length > 0) return rejection('process_owned')
      const decision = evaluateHumanTaskMutation({
        operation: 'status_change', from: snapshot.statusSlug, to: targetSlug,
        activeDelegation: Boolean(ownDelegation), actorIsAssignee: snapshot.assigneeUserId === scope.userId,
      })
      if (!decision.allowed) return rejection(decision.code)
      const metadata: GuardMetadata = decision.releaseOutcome && ownDelegation
        ? { releaseDelegationId: ownDelegation.id, releaseOutcome: decision.releaseOutcome }
        : {}
      return { ok: true, metadata }
    },
    async afterExecute(_input, _result, context) {
      // The assignee closed a delegated task. Staff has already committed the move; release the
      // delegation now. If this fails the task sits in Done/Backlog with a live delegation, which
      // "Remove delegate" clears.
      const metadata = context.metadata as GuardMetadata | undefined
      const scope = guardScope(context)
      if (!scope || !metadata?.releaseDelegationId || !metadata.releaseOutcome) return
      const em = forkEm(context)
      const delegation = await em.findOne(TaskDelegation, {
        id: metadata.releaseDelegationId, tenantId: scope.tenantId, organizationId: scope.organizationId, releasedAt: null,
      })
      if (!delegation) return
      const { translate } = await resolveTranslations()
      delegation.outcome = metadata.releaseOutcome as DelegationOutcome
      delegation.closeReason = metadata.releaseOutcome === 'rejected'
        ? translate('task_delegation.outcome.closedByAssignee', 'Sent back to Backlog by the accountable assignee.')
        : null
      delegation.releasedAt = new Date()
      delegation.updatedAt = new Date()
      await em.flush()
    },
    async beforeUndo(undoContext, context) {
      const scope = guardScope(context)
      if (!scope) return rejection('process_owned')
      const taskId = readUndoTaskId(undoContext)
      if (!taskId) return rejection('process_owned')
      const em = forkEm(context)
      const snapshot = await readTaskSnapshot(context.container.resolve<QueryEngine>('queryEngine'), scope, { taskId, includeChildren: true, includeDeleted: true })
      const delegations = await activeDelegations(em, scope, [snapshot.taskId, ...snapshot.childTaskIds])
      return delegations.length ? rejection('process_owned') : { ok: true }
    },
  }
}

export const interceptors: CommandInterceptor[] = [
  makeGuard('staff.timesheets.tasks.create', 'create'),
  makeGuard('staff.timesheets.tasks.status_change', 'status_change'),
  makeGuard('staff.timesheets.tasks.update', 'update'),
  makeGuard('staff.timesheets.tasks.delete', 'delete'),
]
