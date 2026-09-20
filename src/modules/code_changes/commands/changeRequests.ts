import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { requireProcessAuthority } from '../../task_delegation/lib/processAuthority'
import { requireFeature, requireTaskScope } from '../../task_delegation/lib/auth'
import { ChangeRequest } from '../data/entities'
import { emitChangeRequestEvent } from '../events'
import { approveTaskPullRequest, rejectTaskPullRequest } from '../lib/approve'
import { gitHubForTaskProject } from '../lib/github-source'

/**
 * The life of a change request as commands, so every actor moves it the same way.
 *
 * The three run commands are the agent's: they are authorized by the workflow process that owns
 * the task, exactly like the task writes beside them, and they are idempotent per change request
 * because a workflow step may be replayed. The two decision commands are a person's: they carry
 * the GitHub side effect (merge, close) and the board transition, and they refuse anything the
 * decision surface would refuse.
 *
 * They exist as commands rather than route handlers precisely so a later workflow — an autonomous
 * approver, a review gate — can drive the same transitions without re-implementing any of this.
 */

type RunIdentity = { taskId: string; delegationId: string; processInstanceId: string }
export type StartChangeRequestInput = RunIdentity & {
  projectId: string
  title: string
  repoFullName: string
  baseBranch: string
  repositoryId?: string | null
}
export type RecordPullRequestInput = RunIdentity & {
  number: number
  url: string
  branch: string
  headSha?: string | null
  summary?: string | null
}
export type MarkFailedInput = RunIdentity & { reason: string }
export type DecideChangeRequestInput = { id: string; reason?: string | null }
export type ChangeRequestResult = { id: string; status: ChangeRequest['status'] }

function emFrom(ctx: CommandRuntimeContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em').fork()
}

/** Tenant + organization only: a `TaskScope` also carries the actor, which is not a filter. */
function scopeFilter(scope: { tenantId: string; organizationId: string }) {
  return { tenantId: scope.tenantId, organizationId: scope.organizationId }
}

function scopeLog(ctx: CommandRuntimeContext) {
  return { tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId }
}

/**
 * Announces a transition: the specific event a subscriber acts on, then the generic one every
 * open surface listens to. Emission never decides the outcome — the write already committed, and
 * a listener that is down must not turn an approved change back into an open one.
 */
async function announce(
  event: 'opened' | 'ready' | 'approved' | 'rejected' | 'failed',
  entity: ChangeRequest,
): Promise<void> {
  const payload = {
    changeRequestId: entity.id,
    taskId: entity.taskId,
    delegationId: entity.delegationId ?? null,
    projectId: entity.projectId,
    status: entity.status,
    tenantId: entity.tenantId,
    organizationId: entity.organizationId,
  }
  const options = { persistent: true, tenantId: entity.tenantId, organizationId: entity.organizationId }
  await emitChangeRequestEvent(`code_changes.change_request.${event}`, payload, options)
  await emitChangeRequestEvent('code_changes.change_request.changed', payload, options)
}

async function notFound(): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(404, {
    code: 'change_request_not_found',
    error: translate('code_changes.changeRequests.errors.notFound', 'Change request not found.'),
  })
}

/** The run's change request, or null — a run whose `start` never landed must not create one late. */
async function runChangeRequest(em: EntityManager, scope: { tenantId: string; organizationId: string }, delegationId: string): Promise<ChangeRequest | null> {
  return em.findOne(ChangeRequest, { ...scopeFilter(scope), delegationId, deletedAt: null })
}

const startCommand: CommandHandler<StartChangeRequestInput, ChangeRequestResult> = {
  id: 'code_changes.change_request.start',
  async execute(input, ctx) {
    const em = emFrom(ctx)
    await requireProcessAuthority(ctx, em, input)
    const scope = await requireTaskScope(ctx)
    const existing = await runChangeRequest(em, scope, input.delegationId)
    // Replay: the step already opened this change request, and re-running it must not start a
    // second one or reset a decision that has since been made.
    if (existing) return { id: existing.id, status: existing.status }
    const entity = em.create(ChangeRequest, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      taskId: input.taskId,
      delegationId: input.delegationId,
      projectId: input.projectId,
      repositoryId: input.repositoryId ?? null,
      title: input.title,
      repoFullName: input.repoFullName,
      baseBranch: input.baseBranch,
      status: 'generating',
      openedBy: scope.userId,
    })
    em.persist(entity)
    await em.flush()
    await announce('opened', entity)
    return { id: entity.id, status: entity.status }
  },
  buildLog({ result, input, ctx }) {
    return {
      actionLabel: 'code_changes.audit.changeRequest.start',
      resourceKind: 'code_changes.change_request',
      resourceId: result.id,
      relatedResourceKind: 'staff.timesheets.task',
      relatedResourceId: input.taskId,
      ...scopeLog(ctx),
    }
  },
}

const recordPullRequestCommand: CommandHandler<RecordPullRequestInput, ChangeRequestResult> = {
  id: 'code_changes.change_request.record_pull_request',
  async execute(input, ctx) {
    const em = emFrom(ctx)
    await requireProcessAuthority(ctx, em, input)
    const scope = await requireTaskScope(ctx)
    const entity = await runChangeRequest(em, scope, input.delegationId)
    if (!entity) throw await notFound()
    // Only a change still being generated becomes reviewable: a replayed step must not reopen one
    // a person has already approved or rejected.
    if (entity.status === 'generating' || entity.status === 'failed') entity.status = 'open'
    entity.number = input.number
    entity.url = input.url
    entity.branch = input.branch
    entity.headSha = input.headSha ?? null
    entity.summary = input.summary ?? entity.summary ?? null
    entity.statusReason = null
    await em.flush()
    if (entity.status === 'open') await announce('ready', entity)
    return { id: entity.id, status: entity.status }
  },
  buildLog({ result, input, ctx }) {
    return {
      actionLabel: 'code_changes.audit.changeRequest.recordPullRequest',
      resourceKind: 'code_changes.change_request',
      resourceId: result.id,
      ...scopeLog(ctx),
      context: { number: input.number },
    }
  },
}

const markFailedCommand: CommandHandler<MarkFailedInput, ChangeRequestResult> = {
  id: 'code_changes.change_request.mark_failed',
  async execute(input, ctx) {
    const em = emFrom(ctx)
    await requireProcessAuthority(ctx, em, input)
    const scope = await requireTaskScope(ctx)
    const entity = await runChangeRequest(em, scope, input.delegationId)
    if (!entity) throw await notFound()
    // A decided change request is history; a late failure from its run does not rewrite it.
    if (entity.status === 'generating' || entity.status === 'open') {
      entity.status = 'failed'
      entity.statusReason = input.reason.slice(0, 8000)
      await em.flush()
      await announce('failed', entity)
    }
    return { id: entity.id, status: entity.status }
  },
  buildLog({ result, ctx }) {
    return {
      actionLabel: 'code_changes.audit.changeRequest.markFailed',
      resourceKind: 'code_changes.change_request',
      resourceId: result.id,
      ...scopeLog(ctx),
    }
  },
}

/** The record half of a decision: the GitHub side effect has already happened when this runs. */
async function recordDecision(
  ctx: CommandRuntimeContext,
  id: string,
  apply: (entity: ChangeRequest) => void,
): Promise<ChangeRequest> {
  const em = emFrom(ctx)
  const scope = await requireTaskScope(ctx)
  const entity = await em.findOne(ChangeRequest, { ...scopeFilter(scope), id, deletedAt: null })
  if (!entity) throw await notFound()
  apply(entity)
  entity.decidedBy = scope.userId
  entity.decidedAt = new Date()
  await em.flush()
  return entity
}

async function loadDecidable(ctx: CommandRuntimeContext, id: string): Promise<ChangeRequest> {
  const scope = await requireFeature(ctx, 'code_changes.decide')
  const entity = await emFrom(ctx).findOne(ChangeRequest, { ...scopeFilter(scope), id, deletedAt: null })
  if (!entity) throw await notFound()
  if (entity.status !== 'open') {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(409, {
      code: 'change_request_not_open',
      error: translate('code_changes.changeRequests.errors.notOpen', 'Only an open change request can be decided.'),
    })
  }
  return entity
}

const approveCommand: CommandHandler<DecideChangeRequestInput, ChangeRequestResult> = {
  id: 'code_changes.change_request.approve',
  async execute(input, ctx) {
    const entity = await loadDecidable(ctx, input.id)
    const merged = await approveTaskPullRequest(ctx, entity.taskId, gitHubForTaskProject(ctx.container, {
      tenantId: entity.tenantId, organizationId: entity.organizationId,
    }))
    const saved = await recordDecision(ctx, entity.id, (record) => {
      record.status = 'approved'
      record.mergeCommitSha = merged.mergeCommitSha ?? record.mergeCommitSha ?? null
      record.statusReason = null
    })
    await announce('approved', saved)
    return { id: saved.id, status: saved.status }
  },
  buildLog({ result, ctx }) {
    return {
      actionLabel: 'code_changes.audit.changeRequest.approve',
      resourceKind: 'code_changes.change_request',
      resourceId: result.id,
      ...scopeLog(ctx),
    }
  },
}

const rejectCommand: CommandHandler<DecideChangeRequestInput, ChangeRequestResult> = {
  id: 'code_changes.change_request.reject',
  async execute(input, ctx) {
    const entity = await loadDecidable(ctx, input.id)
    await rejectTaskPullRequest(ctx, entity.taskId, gitHubForTaskProject(ctx.container, {
      tenantId: entity.tenantId, organizationId: entity.organizationId,
    }))
    const saved = await recordDecision(ctx, entity.id, (record) => {
      record.status = 'rejected'
      record.statusReason = input.reason?.trim() ? input.reason.trim().slice(0, 8000) : null
    })
    await announce('rejected', saved)
    return { id: saved.id, status: saved.status }
  },
  buildLog({ result, ctx }) {
    return {
      actionLabel: 'code_changes.audit.changeRequest.reject',
      resourceKind: 'code_changes.change_request',
      resourceId: result.id,
      ...scopeLog(ctx),
    }
  },
}

registerCommand(startCommand)
registerCommand(recordPullRequestCommand)
registerCommand(markFailedCommand)
registerCommand(approveCommand)
registerCommand(rejectCommand)

export const changeRequestCommands = {
  startCommand,
  recordPullRequestCommand,
  markFailedCommand,
  approveCommand,
  rejectCommand,
}
