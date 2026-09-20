import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'
import { resolveWorkflowDefinitionExecutionUserId } from '@open-mercato/core/modules/workflows/lib/definition-grant'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import type { DelegatedTask } from './pullRequest'

const logger = createLogger('code_changes').child({ component: 'run' })

export type Scope = { tenantId: string; organizationId: string }

/**
 * A command context acting as `userId`, built on a real request container: the tasks commands
 * check optional orchestrator registrations through `container.hasRegistration`.
 */
export function actingContext(container: AwilixContainer, scope: Scope, userId: string): CommandRuntimeContext {
  return {
    container,
    auth: { sub: userId, tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    request: new Request('http://code-changes.internal/tasks', { method: 'POST' }),
  }
}

/** The delegated task a workflow function acts on, and the principal it acts as. */
export type BoundRun = {
  scope: Scope
  container: AwilixContainer
  em: EntityManager
  task: DelegatedTask
  projectId: string
  /** A task write through the task_delegation commands, replay-safe per step id. */
  run: (commandId: string, stepId: string, extra: Record<string, unknown>) => Promise<unknown>
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/**
 * Binds a workflow function to the delegated task of its run. Identity comes from the engine,
 * never from the payload: the process is the one bound to this workflow instance, the actor is
 * the definition's execution principal, and every task write goes through the task_delegation
 * commands, which re-check that binding (SPEC-002 process authority).
 */
export async function bindRun(functionName: string, context: ActivityContext, resolveContainer: () => Promise<AwilixContainer>): Promise<BoundRun> {
  const instance = context.workflowInstance
  const tenantId = instance.tenantId ?? null
  const organizationId = instance.organizationId ?? null
  if (!tenantId || !organizationId) throw new Error(`${functionName}: workflow instance has no tenant/organization scope`)
  const scope = { tenantId, organizationId }

  const container = await resolveContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const process = await findOneWithDecryption(em, ProcessInstance, { ...scope, workflowInstanceId: instance.id, deletedAt: null }, {}, scope)
  const input = record(process?.input)
  const taskId = typeof input?.taskId === 'string' ? input.taskId : null
  const delegationId = typeof input?.delegationId === 'string' ? input.delegationId : null
  if (!process || !taskId || !delegationId) throw new Error(`${functionName}: no delegated task is bound to workflow instance ${instance.id}`)

  const definition = await findOneWithDecryption(em, WorkflowDefinition, { ...scope, id: instance.definitionId }, {}, scope)
  const actorUserId = await resolveWorkflowDefinitionExecutionUserId(em, definition, null)
  if (!actorUserId) throw new Error(`${functionName}: the workflow has no execution principal`)

  const bus = container.resolve<CommandBus>('commandBus')
  const identity = { taskId, delegationId, processInstanceId: process.id }
  const run: BoundRun['run'] = (commandId, stepId, extra) =>
    bus.execute(commandId, { input: { ...identity, stepId, ...extra }, ctx: actingContext(container, scope, actorUserId) })

  const tasks = await container.resolve<QueryEngine>('queryEngine').query<{ id: string; title: string; description: string | null; time_project_id: string }>('staff:staff_time_task', {
    fields: ['id', 'title', 'description', 'time_project_id'], filters: { id: taskId }, page: { page: 1, pageSize: 1 }, ...scope,
  })
  const task = tasks.items[0]
  if (!task) throw new Error(`${functionName}: task ${taskId} is not visible in its organization`)
  return { scope, container, em, task: { id: task.id, title: task.title, description: task.description }, projectId: task.time_project_id, run }
}

/**
 * Runs `work` and closes the task as failed when it throws. The workflows using these functions
 * give each activity one engine attempt (the 0.8.0 engine emits no `workflows.instance.failed`
 * when an async activity fails), so this release is final.
 */
export async function closeOnFailure<T>(bound: BoundRun, functionName: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.error('delegated run failed; closing the task', { taskId: bound.task.id, functionName, error: reason })
    await bound.run('task_delegation.task.set_status', `${functionName}:failed`, { status: 'failed', reason: reason.slice(0, 8000) })
      .catch((closeError: unknown) => logger.error('could not close the failed task', {
        taskId: bound.task.id, error: closeError instanceof Error ? closeError.message : String(closeError),
      }))
    // Best effort, and deliberately after the task close: the task is the record people act on,
    // the change request is the record they read afterwards. A run that failed before its change
    // request was started simply has none to mark.
    await bound.run('code_changes.change_request.mark_failed', `${functionName}:change_request_failed`, { reason: reason.slice(0, 8000) })
      .catch((markError: unknown) => logger.warn('could not mark the change request failed', {
        taskId: bound.task.id, error: markError instanceof Error ? markError.message : String(markError),
      }))
    throw error
  }
}
