import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, extractUndoPayload, type CommandBus, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { TimeTrackingAccessResolver } from '@open-mercato/core/modules/staff/di'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AgentPrincipal, ProcessDefinition, ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation, TaskProcessWrite, type TaskDelegationLinkKind } from '../data/entities'
import { assignSchema, delegateSchema, undelegateSchema } from '../data/validators'
import { emitTaskDelegationEvent } from '../events'
import { requireFeature, readTaskAssignmentGraceDays, type TaskScope } from '../lib/auth'
import { hasReachedMilestone, isAllowedProcessTransition, mapProcessStatus, type DelegationOutcome, type ProcessTaskStatus } from '../lib/transitionPolicy'
import { authorizeInternalTaskTransition, revokeInternalTaskTransition } from '../lib/columnContext'
import { requireProcessAuthority } from '../lib/processAuthority'
import { readTaskSnapshot } from '../lib/taskSnapshot'
import { findRosterEntry } from '../lib/agentRoster'
import type {
  AssignTaskInput,
  AssignTaskResult,
  CreateFollowupInput,
  CreateFollowupResult,
  DelegateTaskInput,
  DelegateTaskResult,
  LinkTaskInput,
  LinkTaskResult,
  SetTaskStatusInput,
  SetTaskStatusResult,
  UndelegateTaskInput,
  UndelegateTaskResult,
} from './types'

const logger = createLogger('task_delegation').child({ component: 'task-commands' })
const UUID = z.string().uuid()
const processIdentitySchema = z.object({ delegationId: UUID, processInstanceId: UUID, stepId: z.string().min(1).max(100) })
const setStatusSchema = processIdentitySchema.extend({ taskId: UUID, status: z.enum(['open', 'queued', 'in_design', 'in_progress', 'in_review', 'done', 'rejected', 'failed']), reason: z.string().max(8000).optional() })
// A link is either an absolute http(s) URL (a pull request, a preview) or an in-app backend path
// (the change request, the Caseload) — the two shapes every surface that renders a link accepts.
const linkUrl = z.string().max(2000).refine(
  (value) => value.startsWith('/backend/') || /^https?:\/\//.test(value),
  { message: 'Link must be an http(s) URL or a /backend/ path' },
)
const linkSchema = processIdentitySchema.extend({ taskId: UUID, kind: z.enum(['pr', 'caseload', 'artifact', 'instance', 'run', 'change']), ref: z.string().min(1).max(500), url: linkUrl.optional() })
const followupSchema = processIdentitySchema.extend({ parentId: UUID, title: z.string().trim().min(1).max(255), body: z.string().max(8000) })

type StatusRow = { id: string; slug: string }
type TeamMemberRow = { id: string; user_id: string | null }
type DelegateUndoPayload = { taskId: string; delegationId: string }

// Staff 0.8.0 commits each of its commands on its own, so a tasks command is a sequence of
// separately committed writes ordered to be safe on failure: claim the delegation first, move the
// staff task second, and undo the claim if the move fails. A crash in between leaves a delegation
// without a run, which the board shows as stalled and the user clears with "Remove delegate".
function forkEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

async function taskError(status: number, code: string, key: string, fallback: string, body?: Record<string, unknown>): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(status, { code, error: translate(key, fallback), ...body })
}

async function requireProjectAccess(ctx: CommandRuntimeContext, em: EntityManager, projectId: string, feature: 'task_delegation.view' | 'task_delegation.delegate' = 'task_delegation.delegate'): Promise<void> {
  const scope = await requireFeature(ctx, feature)
  const resolver = ctx.container.resolve<TimeTrackingAccessResolver>('timeTrackingAccessResolver')
  const canManageAll = await ctx.container.resolve<{ userHasAllFeatures(id: string, features: string[], scope: { tenantId: string; organizationId: string }): Promise<boolean> }>('rbacService')
    .userHasAllFeatures(scope.userId, ['staff.timesheets.projects.manage'], scope)
  const access = await resolver.resolveProjectAccess({ em, tenantId: scope.tenantId, organizationId: scope.organizationId, userId: scope.userId, canManageAll, assignmentGraceDays: await readTaskAssignmentGraceDays(ctx, scope.tenantId) })
  if (!access.canManageAll && !access.projectIds.includes(projectId)) {
    throw await taskError(403, 'project_forbidden', 'task_delegation.errors.projectForbidden', 'Task project access is required.')
  }
}


async function resolveStatus(ctx: CommandRuntimeContext, projectId: string, slug: string, feature: 'task_delegation.delegate' | 'task_delegation.process'): Promise<StatusRow> {
  const scope = await requireFeature(ctx, feature)
  const queried = await ctx.container.resolve<QueryEngine>('queryEngine').query<StatusRow>('staff:staff_time_task_status', {
    fields: ['id', 'slug'], filters: { time_project_id: projectId, slug }, page: { page: 1, pageSize: 1 },
    tenantId: scope.tenantId, organizationId: scope.organizationId,
  })
  const status = queried.items[0]
  if (!status) throw await taskError(409, 'invalid_transition', 'task_delegation.errors.statusMissing', 'Required task status is not configured.')
  return status
}

async function runStaffStatus(ctx: CommandRuntimeContext, taskId: string, taskStatusId: string): Promise<void> {
  const bus = ctx.container.resolve<CommandBus>('commandBus')
  await bus.execute('staff.timesheets.tasks.status_change', { input: { id: taskId, taskStatusId }, ctx })
}

async function withExpectedVersion<T>(ctx: CommandRuntimeContext, updatedAt: string, work: () => Promise<T>): Promise<T> {
  const previous = ctx.request
  const headers = new Headers(previous?.headers)
  headers.set('x-om-ext-optimistic-lock-expected-updated-at', updatedAt)
  ctx.request = new Request(previous?.url ?? 'http://tasks.internal/', { method: previous?.method ?? 'POST', headers })
  try {
    return await work()
  } finally {
    ctx.request = previous
  }
}

async function runInternalStaffStatus(ctx: CommandRuntimeContext, taskId: string, status: StatusRow): Promise<void> {
  authorizeInternalTaskTransition(ctx.auth, taskId, status.slug)
  try {
    await runStaffStatus(ctx, taskId, status.id)
  } finally {
    revokeInternalTaskTransition(ctx.auth, taskId)
  }
}

type ProcessWriteIdentity = { taskId: string; processInstanceId: string; stepId: string }

async function processReplay<TResult>(
  em: EntityManager,
  scope: TaskScope,
  identity: ProcessWriteIdentity,
  commandId: string,
): Promise<TResult | null> {
  const existing = await em.findOne(TaskProcessWrite, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    taskId: identity.taskId,
    processInstanceId: identity.processInstanceId,
    stepId: identity.stepId,
  }, { refresh: true })
  if (!existing) return null
  if (existing.commandId !== commandId) {
    throw await taskError(409, 'process_write_conflict', 'task_delegation.errors.processWriteConflict', 'This workflow step already wrote the task.')
  }
  return existing.result as TResult
}

/**
 * Records the step's result in the same flush as the delegation changes it made, so our own rows
 * stay consistent. A concurrent retry of the same step loses on the unique index and replays.
 */
async function saveProcessResult<TResult>(ctx: CommandRuntimeContext, em: EntityManager, scope: TaskScope, identity: ProcessWriteIdentity, commandId: string, result: TResult): Promise<TResult> {
  em.persist(em.create(TaskProcessWrite, { tenantId: scope.tenantId, organizationId: scope.organizationId, ...identity, commandId, result }))
  try {
    await em.flush()
    return result
  } catch (error) {
    if (!isUniqueViolation(error, 'task_delegation_process_writes_step_uq')) throw error
    const replay = await processReplay<TResult>(forkEm(ctx), scope, identity, commandId)
    if (!replay) throw error
    return replay
  }
}

const delegateTaskCommand: CommandHandler<DelegateTaskInput, DelegateTaskResult> = {
  id: 'task_delegation.task.delegate',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = delegateSchema.parse(rawInput)
    const scope = await requireFeature(ctx, 'task_delegation.delegate')
    const em = forkEm(ctx)
    const snapshot = await readTaskSnapshot(ctx.container.resolve<QueryEngine>('queryEngine'), scope, { taskId: input.taskId })
    await requireProjectAccess(ctx, em, snapshot.timeProjectId)
    enforceCommandOptimisticLock({
      resourceKind: 'staff.timesheets.time_task',
      resourceId: snapshot.taskId,
      current: snapshot.updatedAt,
      request: ctx.request,
    })
    if (snapshot.statusSlug !== 'backlog') throw await taskError(409, 'invalid_transition', 'task_delegation.errors.backlogOnly', 'Only backlog tasks can be delegated.')
    const hasOrchestrator = typeof (ctx.container as { hasRegistration?: (name: string) => boolean }).hasRegistration === 'function'
      && ctx.container.hasRegistration('ProcessDefinition')
      && ctx.container.hasRegistration('AgentPrincipal')
    if (!hasOrchestrator) throw await taskError(503, 'orchestrator_unavailable', 'task_delegation.errors.orchestratorUnavailable', 'The agent orchestrator is unavailable.')
    const decryptScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
    const user = await findOneWithDecryption(em, User, { id: input.agentUserId, ...decryptScope, kind: 'agent', deletedAt: null }, {}, decryptScope)
    const principal = await findOneWithDecryption(em, AgentPrincipal, { userId: input.agentUserId, ...decryptScope, enabled: true, deletedAt: null }, {}, decryptScope)
    if (!user || !principal) throw await taskError(422, 'invalid_agent', 'task_delegation.errors.invalidAgent', 'The selected user is not an enabled agent principal.')
    const roster = findRosterEntry(principal.agentDefinitionId)
    const definition = roster
      ? await findOneWithDecryption(em, ProcessDefinition, { name: roster.processName, ...decryptScope, enabled: true, deletedAt: null }, {}, decryptScope)
      : null
    const manual = definition?.triggers?.some((trigger) => trigger.kind === 'manual') ?? false
    if (!definition || !manual) {
      throw await taskError(503, 'orchestrator_unavailable', 'task_delegation.errors.orchestratorUnavailable', 'The agent orchestrator is unavailable.')
    }
    const existing = await em.findOne(TaskDelegation, { ...decryptScope, taskId: input.taskId, releasedAt: null })
    if (existing) throw await taskError(409, 'already_delegated', 'task_delegation.errors.alreadyDelegated', 'The task already has an active delegation.')

    let assigneeUserId = snapshot.assigneeUserId
    if (!assigneeUserId || !snapshot.assigneeStaffMemberId) {
      const members = await ctx.container.resolve<QueryEngine>('queryEngine').query<TeamMemberRow>('staff:staff_team_member', {
        fields: ['id', 'user_id'], filters: { user_id: scope.userId }, page: { page: 1, pageSize: 1 },
        tenantId: scope.tenantId, organizationId: scope.organizationId,
      })
      const member = members.items[0]
      if (!member) throw await taskError(422, 'assignee_required', 'task_delegation.errors.assigneeRequired', 'A human assignee is required before delegation.')
      assigneeUserId = scope.userId
      await ctx.container.resolve<CommandBus>('commandBus').execute('staff.timesheets.tasks.update', {
        input: { id: snapshot.taskId, assigneeStaffMemberId: member.id }, ctx,
      })
    }

    // Claim first: the active-delegation unique index settles concurrent delegations.
    const delegation = em.create(TaskDelegation, {
      ...decryptScope, taskId: input.taskId,
      projectId: snapshot.timeProjectId, delegateUserId: input.agentUserId, delegatedBy: scope.userId,
      assigneeUserId, links: [],
    })
    em.persist(delegation)
    try { await em.flush() } catch (error) {
      if (isUniqueViolation(error, 'task_delegations_active_task_uq')) throw await taskError(409, 'already_delegated', 'task_delegation.errors.alreadyDelegated', 'The task already has an active delegation.')
      throw error
    }
    try {
      const inProgress = await resolveStatus(ctx, snapshot.timeProjectId, 'in-progress', 'task_delegation.delegate')
      const current = await readTaskSnapshot(ctx.container.resolve<QueryEngine>('queryEngine'), scope, { taskId: snapshot.taskId })
      await withExpectedVersion(ctx, current.updatedAt, () => runInternalStaffStatus(ctx, snapshot.taskId, inProgress))
    } catch (error) {
      // The task never left Backlog, so the claim must not survive.
      await em.nativeDelete(TaskDelegation, { ...decryptScope, id: delegation.id })
      throw error
    }

    await emitTaskDelegationEvent('task_delegation.task.delegated', {
      taskId: snapshot.taskId, delegationId: delegation.id,
      delegateUserId: delegation.delegateUserId, agentId: principal.agentDefinitionId,
      delegatedBy: delegation.delegatedBy,
      tenantId: scope.tenantId, organizationId: scope.organizationId,
    }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    await emitTaskDelegationEvent('task_delegation.task.changed', {
      taskId: snapshot.taskId, tenantId: scope.tenantId, organizationId: scope.organizationId,
    }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    return { taskId: snapshot.taskId, delegationId: delegation.id }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('task_delegation.audit.delegate', 'Delegate task'), resourceKind: 'staff.timesheets.task', resourceId: result.taskId,
      tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId,
      payload: { undo: { taskId: result.taskId, delegationId: result.delegationId } satisfies DelegateUndoPayload },
    }
  },
  async undo({ ctx, logEntry }) {
    const payload = extractUndoPayload<DelegateUndoPayload>(logEntry)
    if (!payload) return
    const scope = await requireFeature(ctx, 'task_delegation.delegate')
    const active = await forkEm(ctx).findOne(TaskDelegation, { tenantId: scope.tenantId, organizationId: scope.organizationId, taskId: payload.taskId, releasedAt: null })
    if (active?.id !== payload.delegationId) return
    await undelegateTaskCommand.execute({ taskId: payload.taskId }, ctx)
  },
}

const undelegateTaskCommand: CommandHandler<UndelegateTaskInput, UndelegateTaskResult> = {
  id: 'task_delegation.task.undelegate',
  async execute(rawInput, ctx) {
    const input = undelegateSchema.parse(rawInput)
    const scope = await requireFeature(ctx, 'task_delegation.delegate')
    const em = forkEm(ctx)
    const snapshot = await readTaskSnapshot(ctx.container.resolve<QueryEngine>('queryEngine'), scope, { taskId: input.taskId })
    await requireProjectAccess(ctx, em, snapshot.timeProjectId)
    enforceCommandOptimisticLock({
      resourceKind: 'staff.timesheets.time_task',
      resourceId: snapshot.taskId,
      current: snapshot.updatedAt,
      request: ctx.request,
    })
    const delegation = await em.findOne(TaskDelegation, { tenantId: scope.tenantId, organizationId: scope.organizationId, taskId: input.taskId, releasedAt: null })
    if (!delegation) return { taskId: input.taskId, delegationId: '', released: false }
    if (delegation.processInstanceId) {
      const hasProcessInstances = typeof (ctx.container as { hasRegistration?: (name: string) => boolean }).hasRegistration === 'function'
        && ctx.container.hasRegistration('ProcessInstance')
      if (!hasProcessInstances) throw await taskError(503, 'orchestrator_unavailable', 'task_delegation.errors.orchestratorUnavailable', 'The agent orchestrator is unavailable.')
      const process = await findOneWithDecryption(em, ProcessInstance, { id: delegation.processInstanceId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, {}, { tenantId: scope.tenantId, organizationId: scope.organizationId })
      if (process && hasReachedMilestone(process.milestonesReached, 'sized')) {
        throw await taskError(409, 'decision_pending', 'task_delegation.errors.decisionPending', 'The task has reached the sizing decision.', { processInstanceId: process.id })
      }
    }
    // Move the task back while the delegation still authorizes it, then release. A retry after a
    // failed release finds the task already in Backlog and only releases.
    if (snapshot.statusSlug !== 'backlog') {
      const backlog = await resolveStatus(ctx, snapshot.timeProjectId, 'backlog', 'task_delegation.delegate')
      await runInternalStaffStatus(ctx, snapshot.taskId, backlog)
    }
    delegation.releasedAt = new Date()
    delegation.updatedAt = new Date()
    await em.flush()
    await emitTaskDelegationEvent('task_delegation.task.undelegated', {
      taskId: snapshot.taskId, delegationId: delegation.id, processInstanceId: delegation.processInstanceId ?? null,
      tenantId: scope.tenantId, organizationId: scope.organizationId,
    }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    await emitTaskDelegationEvent('task_delegation.task.changed', {
      taskId: snapshot.taskId, tenantId: scope.tenantId, organizationId: scope.organizationId,
    }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    return { taskId: snapshot.taskId, delegationId: delegation.id, released: true }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('task_delegation.audit.undelegate', 'Remove task delegate'), resourceKind: 'staff.timesheets.task', resourceId: result.taskId, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, context: { delegationId: result.delegationId, released: result.released } }
  },
}

type AssignUndoPayload = {
  taskId: string
  previousAssigneeStaffMemberId: string | null
  assigneeChanged: boolean
  delegationId: string | null
}

async function updateAssignee(ctx: CommandRuntimeContext, taskId: string, assigneeStaffMemberId: string | null, expectedUpdatedAt: string): Promise<void> {
  await withExpectedVersion(ctx, expectedUpdatedAt, () => ctx.container.resolve<CommandBus>('commandBus')
    .execute('staff.timesheets.tasks.update', { input: { id: taskId, assigneeStaffMemberId }, ctx }))
}

/**
 * "Assign" is one act to the person doing it, so it is one command, one audit entry and one undo —
 * but not one transaction: staff 0.8.0 commits its own task update on its own. The halves are
 * ordered (person first, so the delegation it may need is already satisfied) and a failing
 * delegation compensates the assignee back to what it was.
 */
const assignTaskCommand: CommandHandler<AssignTaskInput, AssignTaskResult> = {
  id: 'task_delegation.task.assign',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = assignSchema.parse(rawInput)
    const scope = await requireFeature(ctx, 'task_delegation.view')
    const em = forkEm(ctx)
    const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
    const snapshot = await readTaskSnapshot(queryEngine, scope, { taskId: input.taskId })
    const wantsAgent = typeof input.agentUserId === 'string'
    await requireProjectAccess(ctx, em, snapshot.timeProjectId, wantsAgent ? 'task_delegation.delegate' : 'task_delegation.view')
    enforceCommandOptimisticLock({
      resourceKind: 'staff.timesheets.time_task',
      resourceId: snapshot.taskId,
      current: snapshot.updatedAt,
      request: ctx.request,
    })
    const previousAssigneeStaffMemberId = snapshot.assigneeStaffMemberId
    const clearsAssignee = input.assigneeStaffMemberId === null
    if (clearsAssignee && wantsAgent) {
      throw await taskError(422, 'assignee_required', 'task_delegation.errors.assigneeRequired', 'A human assignee is required before delegation.')
    }
    let assigneeStaffMemberId = previousAssigneeStaffMemberId
    let assigneeChanged = false
    if (input.assigneeStaffMemberId !== undefined && input.assigneeStaffMemberId !== previousAssigneeStaffMemberId) {
      await updateAssignee(ctx, snapshot.taskId, input.assigneeStaffMemberId, snapshot.updatedAt)
      assigneeStaffMemberId = input.assigneeStaffMemberId
      assigneeChanged = true
    }
    let delegation: { id: string } | null = null
    if (wantsAgent) {
      const beforeDelegation = await readTaskSnapshot(queryEngine, scope, { taskId: snapshot.taskId })
      try {
        const delegated = await withExpectedVersion(ctx, beforeDelegation.updatedAt, async () => delegateTaskCommand.execute({
          taskId: snapshot.taskId, agentUserId: input.agentUserId as string,
        }, ctx))
        delegation = { id: delegated.delegationId }
      } catch (error) {
        if (assigneeChanged) {
          try {
            const current = await readTaskSnapshot(queryEngine, scope, { taskId: snapshot.taskId })
            await updateAssignee(ctx, snapshot.taskId, previousAssigneeStaffMemberId, current.updatedAt)
          } catch (compensation) {
            // What the caller asked about is why the delegation failed; a compensation that fails
            // too leaves the new assignee in place and is logged rather than thrown over it.
            logger.error('assignee compensation failed', {
              taskId: snapshot.taskId,
              organizationId: scope.organizationId,
              error: compensation instanceof Error ? compensation.message : String(compensation),
            })
          }
        }
        throw error
      }
      // Delegating with no human assignee records the actor as the accountable owner.
      const settled = await readTaskSnapshot(queryEngine, scope, { taskId: snapshot.taskId })
      assigneeStaffMemberId = settled.assigneeStaffMemberId
    }
    if (assigneeChanged && !wantsAgent) {
      await emitTaskDelegationEvent('task_delegation.task.changed', {
        taskId: snapshot.taskId, tenantId: scope.tenantId, organizationId: scope.organizationId,
      }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    }
    return { taskId: snapshot.taskId, assigneeStaffMemberId, delegation, previousAssigneeStaffMemberId, assigneeChanged }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('task_delegation.audit.assign', 'Assign task'),
      resourceKind: 'staff.timesheets.task',
      resourceId: result.taskId,
      tenantId: ctx.auth?.tenantId,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId,
      context: { assigneeStaffMemberId: result.assigneeStaffMemberId, delegationId: result.delegation?.id ?? null },
      payload: {
        undo: {
          taskId: result.taskId,
          previousAssigneeStaffMemberId: result.previousAssigneeStaffMemberId,
          assigneeChanged: result.assigneeChanged,
          delegationId: result.delegation?.id ?? null,
        } satisfies AssignUndoPayload,
      },
    }
  },
  async undo({ ctx, logEntry }) {
    const payload = extractUndoPayload<AssignUndoPayload>(logEntry)
    if (!payload) return
    const scope = await requireFeature(ctx, 'task_delegation.view')
    if (payload.delegationId) {
      const active = await forkEm(ctx).findOne(TaskDelegation, {
        tenantId: scope.tenantId, organizationId: scope.organizationId, taskId: payload.taskId, releasedAt: null,
      })
      // Refuses after the sizing decision, which is what keeps undo honest mid-run.
      if (active?.id === payload.delegationId) await undelegateTaskCommand.execute({ taskId: payload.taskId }, ctx)
    }
    if (payload.assigneeChanged) {
      const current = await readTaskSnapshot(ctx.container.resolve<QueryEngine>('queryEngine'), scope, { taskId: payload.taskId })
      await updateAssignee(ctx, payload.taskId, payload.previousAssigneeStaffMemberId, current.updatedAt)
      // Symmetry with execute: the surfaces that refreshed when the owner changed refresh again.
      await emitTaskDelegationEvent('task_delegation.task.changed', {
        taskId: payload.taskId, tenantId: scope.tenantId, organizationId: scope.organizationId,
      }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    }
  },
}

const setStatusCommand: CommandHandler<SetTaskStatusInput, SetTaskStatusResult> = {
  id: 'task_delegation.task.set_status',
  async execute(rawInput, ctx) {
    const input = setStatusSchema.parse(rawInput) as SetTaskStatusInput
    const em = forkEm(ctx)
    const authority = await requireProcessAuthority(ctx, em, input)
    const scope = await requireFeature(ctx, 'task_delegation.process')
    const replay = await processReplay<SetTaskStatusResult>(em, scope, input, setStatusCommand.id)
    if (replay) return replay
    const delegation = authority.delegation
    if (!delegation) {
      return saveProcessResult(ctx, em, scope, input, setStatusCommand.id, { applied: false, stale: true, status: input.status })
    }
    const snapshot = await readTaskSnapshot(ctx.container.resolve<QueryEngine>('queryEngine'), scope, { taskId: input.taskId })
    const targetSlug = mapProcessStatus(input.status)
    if (!isAllowedProcessTransition(snapshot.statusSlug, targetSlug)) throw await taskError(409, 'invalid_transition', 'task_delegation.errors.invalidTransition', 'The process status transition is not allowed.')
    if ((input.status === 'rejected' || input.status === 'failed') && !input.reason?.trim()) throw await taskError(422, 'reason_required', 'task_delegation.errors.reasonRequired', 'A close reason is required.')
    // A retried step finds the task already moved and only records the outcome.
    if (snapshot.statusSlug !== targetSlug) {
      const target = await resolveStatus(ctx, snapshot.timeProjectId, targetSlug, 'task_delegation.process')
      await runInternalStaffStatus(ctx, input.taskId, target)
    }
    if (input.status === 'done' || input.status === 'rejected' || input.status === 'failed') {
      delegation.outcome = input.status as DelegationOutcome
      delegation.closeReason = input.reason?.trim() || null
      delegation.releasedAt = new Date()
      delegation.updatedAt = new Date()
    }
    return saveProcessResult(ctx, em, scope, input, setStatusCommand.id, { applied: true, stale: false, status: input.status })
  },
  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('task_delegation.audit.processStatus', 'Apply process task status'), resourceKind: 'staff.timesheets.task', resourceId: input.taskId, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, context: { delegationId: input.delegationId, processInstanceId: input.processInstanceId, stepId: input.stepId, applied: result.applied, stale: result.stale, status: result.status } }
  },
}

const linkTaskCommand: CommandHandler<LinkTaskInput, LinkTaskResult> = {
  id: 'task_delegation.task.link',
  async execute(rawInput, ctx) {
    const input = linkSchema.parse(rawInput) as LinkTaskInput
    const em = forkEm(ctx)
    const authority = await requireProcessAuthority(ctx, em, input)
    const scope = await requireFeature(ctx, 'task_delegation.process')
    const replay = await processReplay<LinkTaskResult>(em, scope, input, linkTaskCommand.id)
    if (replay) return replay
    const delegation = authority.delegation
    if (!delegation) return saveProcessResult(ctx, em, scope, input, linkTaskCommand.id, { applied: false, stale: true })
    delegation.processInstanceId ??= input.processInstanceId
    const duplicate = delegation.links.some((link) => link.kind === input.kind && link.ref === input.ref)
    if (!duplicate) delegation.links = [...delegation.links, { kind: input.kind as TaskDelegationLinkKind, ref: input.ref, url: input.url ?? null, addedAt: new Date().toISOString() }]
    delegation.updatedAt = new Date()
    const result = await saveProcessResult(ctx, em, scope, input, linkTaskCommand.id, { applied: true, stale: false })
    await emitTaskDelegationEvent('task_delegation.task.linked', {
      taskId: input.taskId,
      delegationId: delegation.id,
      processInstanceId: input.processInstanceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    await emitTaskDelegationEvent('task_delegation.task.changed', {
      taskId: input.taskId, tenantId: scope.tenantId, organizationId: scope.organizationId,
    }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    return result
  },
  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('task_delegation.audit.processLink', 'Link process task artifact'), resourceKind: 'staff.timesheets.task', resourceId: input.taskId, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, context: { delegationId: input.delegationId, processInstanceId: input.processInstanceId, stepId: input.stepId, kind: input.kind, ref: input.ref, applied: result.applied, stale: result.stale } }
  },
}

const createFollowupCommand: CommandHandler<CreateFollowupInput, CreateFollowupResult> = {
  id: 'task_delegation.task.create_followup',
  async execute(rawInput, ctx) {
    const input = followupSchema.parse(rawInput) as CreateFollowupInput
    const identity = { taskId: input.parentId, processInstanceId: input.processInstanceId, stepId: input.stepId }
    const em = forkEm(ctx)
    const authority = await requireProcessAuthority(ctx, em, { ...input, taskId: input.parentId })
    const scope = await requireFeature(ctx, 'task_delegation.process')
    const replay = await processReplay<CreateFollowupResult>(em, scope, identity, createFollowupCommand.id)
    if (replay) return replay
    if (!authority.delegation) return saveProcessResult(ctx, em, scope, identity, createFollowupCommand.id, { applied: false, stale: true })
    const parent = await readTaskSnapshot(ctx.container.resolve<QueryEngine>('queryEngine'), scope, { taskId: input.parentId })
    const backlog = await resolveStatus(ctx, parent.timeProjectId, 'backlog', 'task_delegation.process')
    // Not idempotent across a crash before the result is recorded: a retried step may create a
    // second follow-up. Acceptable until staff commands can join our write.
    const result = await ctx.container.resolve<CommandBus>('commandBus').execute<Record<string, unknown>, { taskId: string }>('staff.timesheets.tasks.create', {
      input: {
        tenantId: parent.tenantId, organizationId: parent.organizationId, timeProjectId: parent.timeProjectId,
        parentTaskId: parent.parentTaskId ?? parent.taskId, taskStatusId: backlog.id,
        title: input.title, description: input.body, assigneeStaffMemberId: parent.assigneeStaffMemberId,
      },
      ctx,
    })
    return saveProcessResult(ctx, em, scope, identity, createFollowupCommand.id, { applied: true, stale: false, taskId: result.result.taskId })
  },
  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('task_delegation.audit.processFollowup', 'Create process task follow-up'), resourceKind: 'staff.timesheets.task', resourceId: input.parentId, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, relatedResourceKind: result.taskId ? 'staff.timesheets.task' : null, relatedResourceId: result.taskId ?? null, context: { delegationId: input.delegationId, processInstanceId: input.processInstanceId, stepId: input.stepId, applied: result.applied, stale: result.stale } }
  },
}

registerCommand(assignTaskCommand)
registerCommand(delegateTaskCommand)
registerCommand(undelegateTaskCommand)
registerCommand(setStatusCommand)
registerCommand(linkTaskCommand)
registerCommand(createFollowupCommand)

export { assignTaskCommand, delegateTaskCommand, undelegateTaskCommand, setStatusCommand, linkTaskCommand, createFollowupCommand }
