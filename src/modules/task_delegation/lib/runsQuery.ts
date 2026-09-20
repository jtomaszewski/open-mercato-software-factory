import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AgentRun, ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation, TaskProcessWrite } from '../data/entities'
import { requireFeature } from './auth'
import { resolveAccess, toDelegationDto, type TaskDelegationDto } from './delegationService'

const logger = createLogger('task_delegation').child({ component: 'runs-query' })

/** One run as the detail page names it: the delegation, plus the names a reader recognises it by. */
export type TaskRunSubject = {
  taskId: string
  taskTitle: string
  projectId: string
  projectName: string | null
  delegation: TaskDelegationDto
}

/** A milestone the execution actually reached — the business narrative, carrying no step ids. */
export type TaskRunMilestone = { key: string; at: string }

/**
 * A write the run made on its task, in order: what the run did to the board. `status` is the board
 * column a status write moved the task to — the only part of a step result a reader cares about.
 */
export type TaskRunStep = { stepId: string; commandId: string; at: string; status: string | null }

/**
 * One agent invocation the run made, as a reader needs it: which agent, how it ended, how long it
 * took — and the id its trace is at (`/backend/traces/<id>`), which is the only place the tool
 * calls and the model's reasoning can be read.
 */
export type TaskRunAgentRun = {
  id: string
  agentId: string
  status: string
  /** The workflow step that invoked the agent; null on a run that belongs to no step. */
  stepId: string | null
  startedAt: string
  completedAt: string | null
  latencyMs: number | null
  errorMessage: string | null
}

export type TaskRunProcess = {
  id: string
  status: string
  currentStage: string | null
  runCount: number
  pendingProposalCount: number
  openedAt: string | null
  completedAt: string | null
  lastActivityAt: string | null
  failureReason: string | null
  milestones: TaskRunMilestone[]
}

export type TaskRunDetail = TaskRunSubject & {
  taskDescription: string | null
  /** Null when the orchestrator is absent or the run never reached a process instance. */
  process: TaskRunProcess | null
  steps: TaskRunStep[]
  /** The agent invocations of this run, oldest first; empty when the orchestrator is unreadable. */
  agentRuns: TaskRunAgentRun[]
}

type TaskRead = { id: string; title: string; description: string | null; time_project_id: string }
type ProjectRead = { id: string; name: string | null }

function hasOrchestrator(ctx: CommandRuntimeContext): boolean {
  const container = ctx.container as { hasRegistration?: (name: string) => boolean }
  return typeof container.hasRegistration === 'function' && container.hasRegistration('ProcessInstance')
}

/** Process rows for the given ids, or `null` when the orchestrator cannot be read at all. */
async function readProcesses(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  ids: string[],
): Promise<Map<string, ProcessInstance> | null> {
  if (!hasOrchestrator(ctx)) return null
  if (!ids.length) return new Map()
  try {
    const processes = await findWithDecryption(em, ProcessInstance, { ...scope, id: { $in: ids } }, {}, scope)
    return new Map(processes.map((process) => [process.id, process]))
  } catch (error) {
    logger.warn('optional process state unavailable', {
      organizationId: scope.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * The agent invocations of one execution, oldest first.
 *
 * Correlated by the WORKFLOW instance the run carries (`agent_runs.workflow_instance_id`), which
 * is the orchestrator's `ProcessInstance.workflowInstanceId` — not the process row's own id, a
 * different uuid that matches no run.
 *
 * Read from the orchestrator instead of recorded as a delegation link, because a link would only
 * ever be written by a step that succeeded: the run a reader most needs the trace of is the one
 * that failed or is still going. Fail-soft for the same reason `readProcesses` is — the story of
 * how the change was made never keeps the change itself off the page.
 */
async function readAgentRuns(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  workflowInstanceId: string | null | undefined,
): Promise<TaskRunAgentRun[]> {
  if (!workflowInstanceId || !hasOrchestrator(ctx)) return []
  try {
    const runs = await findWithDecryption(
      em,
      AgentRun,
      { ...scope, workflowInstanceId, deletedAt: null },
      { orderBy: { createdAt: 'asc' } },
      scope,
    )
    return runs.map((run) => ({
      id: run.id,
      agentId: run.agentId,
      status: run.status,
      stepId: run.stepId ?? null,
      startedAt: run.createdAt.toISOString(),
      completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
      latencyMs: run.latencyMs ?? null,
      errorMessage: run.errorMessage ?? null,
    }))
  } catch (error) {
    logger.warn('optional agent runs unavailable', {
      organizationId: scope.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

async function delegateNames(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  userIds: string[],
): Promise<Map<string, string>> {
  if (!userIds.length) return new Map()
  const users = await findWithDecryption(em, User, { ...scope, id: { $in: userIds }, deletedAt: null }, {}, scope)
  return new Map(users.map((user) => [user.id, user.name ?? user.email]))
}

/** The board column a `set_status` write moved the task to, when its result carries one. */
function statusOf(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const status = (result as { status?: unknown }).status
  return typeof status === 'string' ? status : null
}

function milestonesOf(process: ProcessInstance): TaskRunMilestone[] {
  const raw = Array.isArray(process.milestonesReached) ? process.milestonesReached : []
  return raw
    .filter((milestone): milestone is { key: string; at: string } =>
      Boolean(milestone) && typeof milestone.key === 'string' && typeof milestone.at === 'string')
    .map((milestone) => ({ key: milestone.key, at: milestone.at }))
}

/**
 * One run in full: the same item the list renders, plus what the run did — the process narrative
 * and every write it made on its task, oldest first.
 */
export async function readTaskRun(ctx: CommandRuntimeContext, delegationId: string): Promise<TaskRunDetail> {
  const scope = await requireFeature(ctx, 'task_delegation.view')
  const em = ctx.container.resolve<EntityManager>('em')
  const decryptScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const { translate } = await resolveTranslations()
  const notFound = () => new CrudHttpError(404, {
    code: 'run_not_found',
    error: translate('task_delegation.runs.errors.notFound', 'Run not found.'),
  })

  const delegation = await findOneWithDecryption(em, TaskDelegation, { ...decryptScope, id: delegationId }, {}, decryptScope)
  if (!delegation) throw notFound()
  const access = await resolveAccess(ctx, em, scope)
  // A run of a project the caller cannot open is not theirs to read: it answers 404, not 403, so
  // the endpoint never confirms that a run exists on a project outside their access.
  if (!access.canManageAll && !access.projectIds.includes(delegation.projectId)) throw notFound()

  const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
  const [tasks, projects, names, processes, writes] = await Promise.all([
    queryEngine.query<TaskRead>('staff:staff_time_task', {
      fields: ['id', 'title', 'description', 'time_project_id'], filters: { id: delegation.taskId }, page: { page: 1, pageSize: 1 }, ...decryptScope,
    }),
    queryEngine.query<ProjectRead>('staff:staff_time_project', {
      fields: ['id', 'name'], filters: { id: delegation.projectId }, page: { page: 1, pageSize: 1 }, ...decryptScope,
    }),
    delegateNames(em, decryptScope, [delegation.delegateUserId]),
    readProcesses(ctx, em, decryptScope, delegation.processInstanceId ? [delegation.processInstanceId] : []),
    findWithDecryption(em, TaskProcessWrite, {
      ...decryptScope, taskId: delegation.taskId, ...(delegation.processInstanceId ? { processInstanceId: delegation.processInstanceId } : {}),
    }, { orderBy: { createdAt: 'asc' } }, decryptScope),
  ])
  const task = tasks.items[0] ?? null
  const process = delegation.processInstanceId ? processes?.get(delegation.processInstanceId) ?? null : null
  // Second hop by necessity: the process row is what carries the workflow instance the agent runs
  // are keyed by, so it has to be read before them.
  const agentRuns = await readAgentRuns(ctx, em, decryptScope, process?.workflowInstanceId)

  return {
    taskId: delegation.taskId,
    taskTitle: task?.title ?? translate('task_delegation.runs.missingTask', 'Removed task'),
    taskDescription: task?.description ?? null,
    projectId: delegation.projectId,
    projectName: projects.items[0]?.name ?? null,
    delegation: toDelegationDto(delegation, {
      delegateName: names.get(delegation.delegateUserId) ?? translate('task_delegation.delegate.missingAgent', 'Unavailable agent'),
      process,
      processReadsAvailable: processes !== null,
      now: new Date(),
    }),
    process: process ? {
      id: process.id,
      status: process.status,
      currentStage: process.currentStage ?? null,
      runCount: process.runCount ?? 0,
      pendingProposalCount: process.pendingProposalCount ?? 0,
      openedAt: process.openedAt ? new Date(process.openedAt).toISOString() : null,
      completedAt: process.completedAt ? new Date(process.completedAt).toISOString() : null,
      lastActivityAt: process.lastActivityAt ? new Date(process.lastActivityAt).toISOString() : null,
      failureReason: process.failureReason ?? null,
      milestones: milestonesOf(process),
    } : null,
    steps: writes.map((write) => ({
      stepId: write.stepId,
      commandId: write.commandId,
      at: write.createdAt.toISOString(),
      status: statusOf(write.result),
    })),
    agentRuns,
  }
}
