import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, afterCommandCommit, extractUndoPayload, type CommandBus, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { StaffTimeTaskMutationService, TimeTrackingAccessResolver } from '@open-mercato/core/modules/staff/di'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AgentPrincipal, ProcessDefinition, ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation, TaskProcessWrite, type TaskDelegationLinkKind } from '../data/entities'
import { delegateSchema, undelegateSchema } from '../data/validators'
import { emitTasksEvent } from '../events'
import { requireFeature, readTaskAssignmentGraceDays } from '../lib/auth'
import { isAllowedProcessTransition, mapProcessStatus, type DelegationOutcome, type ProcessTaskStatus } from '../lib/transitionPolicy'
import { authorizeInternalTaskTransition, rememberCreatedTaskColumn } from '../lib/columnContext'
import { requireProcessAuthority } from '../lib/processAuthority'
import type {
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

const UUID = z.string().uuid()
const processIdentitySchema = z.object({ delegationId: UUID, processInstanceId: UUID, stepId: z.string().min(1).max(100) })
const setStatusSchema = processIdentitySchema.extend({ taskId: UUID, status: z.enum(['open', 'queued', 'in_design', 'in_progress', 'in_review', 'done', 'rejected', 'failed']), reason: z.string().max(8000).optional() })
const linkSchema = processIdentitySchema.extend({ taskId: UUID, kind: z.enum(['pr', 'caseload', 'artifact', 'instance', 'run']), ref: z.string().min(1).max(500), url: z.string().url().max(2000).optional() })
const followupSchema = processIdentitySchema.extend({ parentId: UUID, title: z.string().trim().min(1).max(255), body: z.string().max(8000) })

type StatusRow = { id: string; slug: string }
type TeamMemberRow = { id: string; user_id: string | null }
type DelegateUndoPayload = { taskId: string; delegationId: string }

function emFor(ctx: CommandRuntimeContext): EntityManager {
  if (!ctx.transactionalEm) throw new Error('[internal] Tasks command requires a managed transaction')
  return ctx.transactionalEm
}

async function taskError(status: number, code: string, key: string, fallback: string, body?: Record<string, unknown>): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(status, { code, error: translate(key, fallback), ...body })
}

function staffService(ctx: CommandRuntimeContext): StaffTimeTaskMutationService {
  return ctx.container.resolve<StaffTimeTaskMutationService>('staffTimeTaskMutationService')
}

async function requireProjectAccess(ctx: CommandRuntimeContext, projectId: string): Promise<void> {
  const scope = await requireFeature(ctx, 'tasks.delegate')
  const resolver = ctx.container.resolve<TimeTrackingAccessResolver>('timeTrackingAccessResolver')
  const canManageAll = await ctx.container.resolve<{ userHasAllFeatures(id: string, features: string[], scope: { tenantId: string; organizationId: string }): Promise<boolean> }>('rbacService')
    .userHasAllFeatures(scope.userId, ['staff.timesheets.projects.manage'], scope)
  const access = await resolver.resolveProjectAccess({ em: emFor(ctx), tenantId: scope.tenantId, organizationId: scope.organizationId, userId: scope.userId, canManageAll, assignmentGraceDays: await readTaskAssignmentGraceDays(ctx, scope.tenantId) })
  if (!access.canManageAll && !access.projectIds.includes(projectId)) {
    throw await taskError(403, 'project_forbidden', 'tasks.errors.projectForbidden', 'Task project access is required.')
  }
}

const FACTORY_COLUMNS = [
  { slug: 'queued', name: 'Queued', isDone: false, position: 100 },
  { slug: 'in-design', name: 'In design', isDone: false, position: 200 },
  { slug: 'closed', name: 'Closed', isDone: true, position: 600 },
] as const

async function ensureFactoryColumns(ctx: CommandRuntimeContext, projectId: string, feature: 'tasks.delegate' | 'tasks.process'): Promise<Map<string, string>> {
  const scope = await requireFeature(ctx, feature)
  const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
  const existing = await queryEngine.query<StatusRow>('staff:staff_time_task_status', {
    fields: ['id', 'slug'], filters: { time_project_id: projectId }, page: { page: 1, pageSize: 100 },
    tenantId: scope.tenantId, organizationId: scope.organizationId,
  })
  const ids = new Map(existing.items.map((status) => [status.slug, status.id]))
  const bus = ctx.container.resolve<CommandBus>('commandBus')
  for (const column of FACTORY_COLUMNS) {
    if (ids.has(column.slug)) continue
    const created = await bus.execute<Record<string, unknown>, { taskStatusId: string }>('staff.timesheets.task_statuses.create', {
      input: { tenantId: scope.tenantId, organizationId: scope.organizationId, timeProjectId: projectId, ...column },
      ctx,
    })
    ids.set(column.slug, created.result.taskStatusId)
    rememberCreatedTaskColumn(ctx, created.result.taskStatusId, column.slug)
  }
  return ids
}

async function resolveStatus(ctx: CommandRuntimeContext, projectId: string, slug: string, feature: 'tasks.delegate' | 'tasks.process'): Promise<StatusRow> {
  const columns = await ensureFactoryColumns(ctx, projectId, feature)
  const id = columns.get(slug)
  if (id) return { id, slug }
  const scope = await requireFeature(ctx, feature)
  const queried = await ctx.container.resolve<QueryEngine>('queryEngine').query<StatusRow>('staff:staff_time_task_status', {
    fields: ['id', 'slug'], filters: { time_project_id: projectId, slug }, page: { page: 1, pageSize: 1 },
    tenantId: scope.tenantId, organizationId: scope.organizationId,
  })
  const status = queried.items[0]
  if (!status) throw await taskError(409, 'invalid_transition', 'tasks.errors.statusMissing', 'Required task status is not configured.')
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
  authorizeInternalTaskTransition(ctx, taskId, status.slug)
  await runStaffStatus(ctx, taskId, status.id)
}

async function processReplay<TResult>(
  ctx: CommandRuntimeContext,
  identity: { taskId: string; processInstanceId: string; stepId: string },
  commandId: string,
): Promise<TResult | null> {
  const scope = await requireFeature(ctx, 'tasks.process')
  const existing = await emFor(ctx).findOne(TaskProcessWrite, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    taskId: identity.taskId,
    processInstanceId: identity.processInstanceId,
    stepId: identity.stepId,
  }, { lockMode: LockMode.PESSIMISTIC_WRITE })
  if (!existing) return null
  if (existing.commandId !== commandId) {
    throw await taskError(409, 'process_write_conflict', 'tasks.errors.processWriteConflict', 'This workflow step already wrote the task.')
  }
  return existing.result as TResult
}

async function saveProcessResult(ctx: CommandRuntimeContext, identity: { taskId: string; processInstanceId: string; stepId: string }, commandId: string, result: unknown): Promise<void> {
  const scope = await requireFeature(ctx, 'tasks.process')
  emFor(ctx).persist(emFor(ctx).create(TaskProcessWrite, { tenantId: scope.tenantId, organizationId: scope.organizationId, ...identity, commandId, result }))
  await emFor(ctx).flush()
}

const delegateTaskCommand: CommandHandler<DelegateTaskInput, DelegateTaskResult> = {
  id: 'tasks.task.delegate',
  isUndoable: true,
  transaction: {
    identity: (input) => delegateSchema.parse(input).taskId,
    lock: async (input, ctx) => { await staffService(ctx).lockTask(ctx, { taskId: delegateSchema.parse(input).taskId, includeChildren: true }) },
    lockUndo: async (entry, ctx) => {
      const payload = extractUndoPayload<DelegateUndoPayload>(entry)
      if (payload?.taskId) await staffService(ctx).lockTask(ctx, { taskId: payload.taskId, includeChildren: true })
    },
  },
  async execute(rawInput, ctx) {
    const input = delegateSchema.parse(rawInput)
    const scope = await requireFeature(ctx, 'tasks.delegate')
    const snapshot = await staffService(ctx).lockTask(ctx, { taskId: input.taskId, includeChildren: true })
    await requireProjectAccess(ctx, snapshot.timeProjectId)
    enforceCommandOptimisticLock({
      resourceKind: 'staff.timesheets.time_task',
      resourceId: snapshot.taskId,
      current: snapshot.updatedAt,
      request: ctx.request,
    })
    if (snapshot.statusSlug !== 'backlog') throw await taskError(409, 'invalid_transition', 'tasks.errors.backlogOnly', 'Only backlog tasks can be delegated.')
    const hasOrchestrator = typeof (ctx.container as { hasRegistration?: (name: string) => boolean }).hasRegistration === 'function'
      && ctx.container.hasRegistration('ProcessDefinition')
      && ctx.container.hasRegistration('AgentPrincipal')
    if (!hasOrchestrator) throw await taskError(503, 'orchestrator_unavailable', 'tasks.errors.orchestratorUnavailable', 'The factory orchestrator is unavailable.')
    let assigneeUserId = snapshot.assigneeUserId
    let assigneeStaffMemberId = snapshot.assigneeStaffMemberId
    if (!assigneeUserId || !assigneeStaffMemberId) {
      const members = await ctx.container.resolve<QueryEngine>('queryEngine').query<TeamMemberRow>('staff:staff_team_member', {
        fields: ['id', 'user_id'], filters: { user_id: scope.userId }, page: { page: 1, pageSize: 1 },
        tenantId: scope.tenantId, organizationId: scope.organizationId,
      })
      const member = members.items[0]
      if (!member) throw await taskError(422, 'assignee_required', 'tasks.errors.assigneeRequired', 'A human assignee is required before delegation.')
      assigneeUserId = scope.userId
      assigneeStaffMemberId = member.id
      await ctx.container.resolve<CommandBus>('commandBus').execute('staff.timesheets.tasks.update', {
        input: { id: snapshot.taskId, assigneeStaffMemberId }, ctx,
      })
    }
    const em = emFor(ctx)
    const decryptScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
    const user = await findOneWithDecryption(em, User, { id: input.agentUserId, ...decryptScope, kind: 'agent', deletedAt: null }, {}, decryptScope)
    const principal = await findOneWithDecryption(em, AgentPrincipal, { userId: input.agentUserId, ...decryptScope, enabled: true, deletedAt: null }, {}, decryptScope)
    if (!user || !principal) throw await taskError(422, 'invalid_agent', 'tasks.errors.invalidAgent', 'The selected user is not an enabled agent principal.')
    const definition = await findOneWithDecryption(em, ProcessDefinition, { name: 'factory.deliver', ...decryptScope, enabled: true, deletedAt: null }, {}, decryptScope)
    const manual = definition?.triggers?.some((trigger) => trigger.kind === 'manual') ?? false
    if (!definition || !manual || principal.agentDefinitionId !== 'factory') {
      throw await taskError(503, 'orchestrator_unavailable', 'tasks.errors.orchestratorUnavailable', 'The factory orchestrator is unavailable.')
    }
    const existing = await em.findOne(TaskDelegation, { tenantId: scope.tenantId, organizationId: scope.organizationId, taskId: input.taskId, releasedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    if (existing) throw await taskError(409, 'already_delegated', 'tasks.errors.alreadyDelegated', 'The task already has an active delegation.')
    const delegation = em.create(TaskDelegation, {
      tenantId: scope.tenantId, organizationId: scope.organizationId, taskId: input.taskId,
      projectId: snapshot.timeProjectId, delegateUserId: input.agentUserId, delegatedBy: scope.userId,
      assigneeUserId, links: [],
    })
    em.persist(delegation)
    const queued = await resolveStatus(ctx, snapshot.timeProjectId, 'queued', 'tasks.delegate')
    const current = await staffService(ctx).lockTask(ctx, { taskId: snapshot.taskId, includeChildren: true })
    await withExpectedVersion(ctx, current.updatedAt, () => runInternalStaffStatus(ctx, snapshot.taskId, queued))
    try { await em.flush() } catch (error) {
      if (isUniqueViolation(error, 'tasks_delegation_active_task_uq')) throw await taskError(409, 'already_delegated', 'tasks.errors.alreadyDelegated', 'The task already has an active delegation.')
      throw error
    }
    await afterCommandCommit(ctx, async () => {
      await emitTasksEvent('tasks.task.delegated', {
        taskId: snapshot.taskId, delegationId: delegation.id,
        delegateUserId: delegation.delegateUserId, agentId: principal.agentDefinitionId,
        delegatedBy: delegation.delegatedBy,
        tenantId: scope.tenantId, organizationId: scope.organizationId,
      }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
      await emitTasksEvent('tasks.task.changed', {
        taskId: snapshot.taskId, tenantId: scope.tenantId, organizationId: scope.organizationId,
      }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    })
    return { taskId: snapshot.taskId, delegationId: delegation.id }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.delegate', 'Delegate task'), resourceKind: 'staff.timesheets.task', resourceId: result.taskId,
      tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId,
      payload: { undo: { taskId: result.taskId, delegationId: result.delegationId } satisfies DelegateUndoPayload },
    }
  },
  async undo({ ctx, logEntry }) {
    const payload = extractUndoPayload<DelegateUndoPayload>(logEntry)
    if (!payload) return
    const scope = await requireFeature(ctx, 'tasks.delegate')
    const active = await emFor(ctx).findOne(TaskDelegation, { tenantId: scope.tenantId, organizationId: scope.organizationId, taskId: payload.taskId, releasedAt: null })
    if (active?.id !== payload.delegationId) return
    await undelegateTaskCommand.execute({ taskId: payload.taskId }, ctx)
  },
}

const undelegateTaskCommand: CommandHandler<UndelegateTaskInput, UndelegateTaskResult> = {
  id: 'tasks.task.undelegate',
  transaction: {
    identity: (input) => undelegateSchema.parse(input).taskId,
    lock: async (input, ctx) => { await staffService(ctx).lockTask(ctx, { taskId: undelegateSchema.parse(input).taskId, includeChildren: true }) },
    lockUndo: async () => {},
  },
  async execute(rawInput, ctx) {
    const input = undelegateSchema.parse(rawInput)
    const scope = await requireFeature(ctx, 'tasks.delegate')
    const snapshot = await staffService(ctx).lockTask(ctx, { taskId: input.taskId, includeChildren: true })
    await requireProjectAccess(ctx, snapshot.timeProjectId)
    enforceCommandOptimisticLock({
      resourceKind: 'staff.timesheets.time_task',
      resourceId: snapshot.taskId,
      current: snapshot.updatedAt,
      request: ctx.request,
    })
    const em = emFor(ctx)
    const delegation = await em.findOne(TaskDelegation, { tenantId: scope.tenantId, organizationId: scope.organizationId, taskId: input.taskId, releasedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    if (!delegation) return { taskId: input.taskId, delegationId: '', released: false }
    if (delegation.processInstanceId) {
      const hasProcessInstances = typeof (ctx.container as { hasRegistration?: (name: string) => boolean }).hasRegistration === 'function'
        && ctx.container.hasRegistration('ProcessInstance')
      if (!hasProcessInstances) throw await taskError(503, 'orchestrator_unavailable', 'tasks.errors.orchestratorUnavailable', 'The factory orchestrator is unavailable.')
      const process = await findOneWithDecryption(em, ProcessInstance, { id: delegation.processInstanceId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, {}, { tenantId: scope.tenantId, organizationId: scope.organizationId })
      if (process?.milestonesReached?.some((milestone) => milestone.key === 'sized')) {
        throw await taskError(409, 'decision_pending', 'tasks.errors.decisionPending', 'The task has reached the sizing decision.', { processInstanceId: process.id })
      }
    }
    delegation.releasedAt = new Date()
    delegation.updatedAt = new Date()
    const backlog = await resolveStatus(ctx, snapshot.timeProjectId, 'backlog', 'tasks.delegate')
    await runInternalStaffStatus(ctx, snapshot.taskId, backlog)
    await em.flush()
    await afterCommandCommit(ctx, async () => {
      await emitTasksEvent('tasks.task.undelegated', {
        taskId: snapshot.taskId, delegationId: delegation.id, processInstanceId: delegation.processInstanceId ?? null,
        tenantId: scope.tenantId, organizationId: scope.organizationId,
      }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
      await emitTasksEvent('tasks.task.changed', {
        taskId: snapshot.taskId, tenantId: scope.tenantId, organizationId: scope.organizationId,
      }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    })
    return { taskId: snapshot.taskId, delegationId: delegation.id, released: true }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('tasks.audit.undelegate', 'Remove task delegate'), resourceKind: 'staff.timesheets.task', resourceId: result.taskId, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, context: { delegationId: result.delegationId, released: result.released } }
  },
}

const setStatusCommand: CommandHandler<SetTaskStatusInput, SetTaskStatusResult> = {
  id: 'tasks.task.set_status',
  transaction: {
    identity: (input) => [setStatusSchema.parse(input).taskId, input.processInstanceId, input.stepId],
    lock: async (input, ctx) => { await staffService(ctx).lockTask(ctx, { taskId: setStatusSchema.parse(input).taskId, includeChildren: true }) },
    lockUndo: async () => {},
  },
  async execute(rawInput, ctx) {
    const input = setStatusSchema.parse(rawInput) as SetTaskStatusInput
    const authority = await requireProcessAuthority(ctx, input)
    const replay = await processReplay<SetTaskStatusResult>(ctx, input, setStatusCommand.id)
    if (replay) return replay
    const snapshot = await staffService(ctx).lockTask(ctx, { taskId: input.taskId, includeChildren: true })
    const delegation = authority.delegation
    if (!delegation) {
      const result = { applied: false, stale: true, status: input.status } as const
      await saveProcessResult(ctx, input, setStatusCommand.id, result)
      return result
    }
    const targetSlug = mapProcessStatus(input.status)
    if (!isAllowedProcessTransition(snapshot.statusSlug, targetSlug)) throw await taskError(409, 'invalid_transition', 'tasks.errors.invalidTransition', 'The process status transition is not allowed.')
    if ((input.status === 'rejected' || input.status === 'failed') && !input.reason?.trim()) throw await taskError(422, 'reason_required', 'tasks.errors.reasonRequired', 'A close reason is required.')
    if (snapshot.statusSlug !== targetSlug) {
      const target = await resolveStatus(ctx, snapshot.timeProjectId, targetSlug, 'tasks.process')
      await runInternalStaffStatus(ctx, input.taskId, target)
    }
    if (input.status === 'done' || input.status === 'rejected' || input.status === 'failed') {
      delegation.outcome = input.status as DelegationOutcome
      delegation.closeReason = input.reason?.trim() || null
      delegation.releasedAt = new Date()
      delegation.updatedAt = new Date()
    }
    const result = { applied: true, stale: false, status: input.status }
    await saveProcessResult(ctx, input, setStatusCommand.id, result)
    return result
  },
  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('tasks.audit.processStatus', 'Apply process task status'), resourceKind: 'staff.timesheets.task', resourceId: input.taskId, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, context: { delegationId: input.delegationId, processInstanceId: input.processInstanceId, stepId: input.stepId, applied: result.applied, stale: result.stale, status: result.status } }
  },
}

const linkTaskCommand: CommandHandler<LinkTaskInput, LinkTaskResult> = {
  id: 'tasks.task.link',
  transaction: {
    identity: (input) => [linkSchema.parse(input).taskId, input.processInstanceId, input.stepId],
    lock: async (input, ctx) => { await staffService(ctx).lockTask(ctx, { taskId: linkSchema.parse(input).taskId }) },
    lockUndo: async () => {},
  },
  async execute(rawInput, ctx) {
    const input = linkSchema.parse(rawInput) as LinkTaskInput
    const authority = await requireProcessAuthority(ctx, input)
    const replay = await processReplay<LinkTaskResult>(ctx, input, linkTaskCommand.id)
    if (replay) return replay
    const delegation = authority.delegation
    if (!delegation) {
      const result = { applied: false, stale: true }
      await saveProcessResult(ctx, input, linkTaskCommand.id, result)
      return result
    }
    delegation.processInstanceId ??= input.processInstanceId
    const duplicate = delegation.links.some((link) => link.kind === input.kind && link.ref === input.ref)
    if (!duplicate) delegation.links = [...delegation.links, { kind: input.kind as TaskDelegationLinkKind, ref: input.ref, url: input.url ?? null, addedAt: new Date().toISOString() }]
    delegation.updatedAt = new Date()
    const result = { applied: true, stale: false }
    await saveProcessResult(ctx, input, linkTaskCommand.id, result)
    const scope = await requireFeature(ctx, 'tasks.process')
    await afterCommandCommit(ctx, async () => {
      await emitTasksEvent('tasks.task.linked', {
        taskId: input.taskId,
        delegationId: delegation.id,
        processInstanceId: input.processInstanceId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
      await emitTasksEvent('tasks.task.changed', {
        taskId: input.taskId, tenantId: scope.tenantId, organizationId: scope.organizationId,
      }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    })
    return result
  },
  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('tasks.audit.processLink', 'Link process task artifact'), resourceKind: 'staff.timesheets.task', resourceId: input.taskId, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, context: { delegationId: input.delegationId, processInstanceId: input.processInstanceId, stepId: input.stepId, kind: input.kind, ref: input.ref, applied: result.applied, stale: result.stale } }
  },
}

const createFollowupCommand: CommandHandler<CreateFollowupInput, CreateFollowupResult> = {
  id: 'tasks.task.create_followup',
  transaction: {
    identity: (input) => [followupSchema.parse(input).parentId, input.processInstanceId, input.stepId],
    lock: async (input, ctx) => { await staffService(ctx).lockTask(ctx, { taskId: followupSchema.parse(input).parentId, includeChildren: true }) },
    lockUndo: async () => {},
  },
  async execute(rawInput, ctx) {
    const input = followupSchema.parse(rawInput) as CreateFollowupInput
    const identity = { taskId: input.parentId, processInstanceId: input.processInstanceId, stepId: input.stepId }
    const authority = await requireProcessAuthority(ctx, { ...input, taskId: input.parentId })
    const replay = await processReplay<CreateFollowupResult>(ctx, identity, createFollowupCommand.id)
    if (replay) return replay
    const parent = await staffService(ctx).lockTask(ctx, { taskId: input.parentId, includeChildren: true })
    const delegation = authority.delegation
    if (!delegation) {
      const result = { applied: false, stale: true }
      await saveProcessResult(ctx, identity, createFollowupCommand.id, result)
      return result
    }
    const backlog = await resolveStatus(ctx, parent.timeProjectId, 'backlog', 'tasks.process')
    const result = await ctx.container.resolve<CommandBus>('commandBus').execute<Record<string, unknown>, { taskId: string }>('staff.timesheets.tasks.create', {
      input: {
        tenantId: parent.tenantId, organizationId: parent.organizationId, timeProjectId: parent.timeProjectId,
        parentTaskId: parent.parentTaskId ?? parent.taskId, taskStatusId: backlog.id,
        title: input.title, description: input.body, assigneeStaffMemberId: parent.assigneeStaffMemberId,
      },
      ctx,
    })
    const response = { applied: true, stale: false, taskId: result.result.taskId }
    await saveProcessResult(ctx, identity, createFollowupCommand.id, response)
    return response
  },
  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('tasks.audit.processFollowup', 'Create process task follow-up'), resourceKind: 'staff.timesheets.task', resourceId: input.parentId, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, relatedResourceKind: result.taskId ? 'staff.timesheets.task' : null, relatedResourceId: result.taskId ?? null, context: { delegationId: input.delegationId, processInstanceId: input.processInstanceId, stepId: input.stepId, applied: result.applied, stale: result.stale } }
  },
}

registerCommand(delegateTaskCommand)
registerCommand(undelegateTaskCommand)
registerCommand(setStatusCommand)
registerCommand(linkTaskCommand)
registerCommand(createFollowupCommand)

export { delegateTaskCommand, undelegateTaskCommand, setStatusCommand, linkTaskCommand, createFollowupCommand }
