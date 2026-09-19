import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { defineWorkflow } from '@open-mercato/shared/modules/workflows'
import type { ActivityType } from '@open-mercato/shared/modules/workflows'
import { WorkflowDefinition, type WorkflowDefinitionData } from '@open-mercato/core/modules/workflows/data/entities'
import type { WorkflowDefinitionAuthoring } from '@open-mercato/core/modules/workflows/lib/owned-definition'
import { resolveWorkflowDefinitionExecutionUserId } from '@open-mercato/core/modules/workflows/lib/definition-grant'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { ProcessDefinition, ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import type { Scope } from './catalogRecord'
import { actingContext, readProductIdFromTask } from './board'
import { GitHubApiError, GitHubClient, readGitHubConfigFromEnv } from './github'
import { publishProductPage, type PublishResult } from './publishProduct'

const logger = createLogger('factory').child({ component: 'deliver' })

/** The process task_delegation's start-factory subscriber starts for a delegation (SPEC-002). */
export const FACTORY_DELIVER_PROCESS = 'factory.deliver'
export const DELIVER_WORKFLOW_ID = 'factory.deliver_product'
export const DELIVER_FUNCTION = 'factory.deliver_product_pr'
export const PR_OPEN_MILESTONE = 'pr_open'
/** The run's own principal: it may read and drive delegated tasks, nothing else. */
export const DELIVER_GRANTED_FEATURES = ['task_delegation.view', 'task_delegation.process'] as const

/**
 * `factory.deliver_product`: a delegated DEMO task → the product's website PR (SPEC-004 scene 3).
 * Input is `{ taskId, delegationId }` only; the function derives everything else.
 *
 * How outputs reach the persisted context in 0.8.0: a step never waits for its own async
 * activities, but an async TRANSITION activity parks the transition until the job completes
 * and merges its output under `<activityId>_result`; SET_VARIABLE persists only on transitions.
 * So the effector is the async activity of the transition into `pr_open`, and the outcome is a
 * SET_VARIABLE on the transition to `end`.
 */
const deliverProduct = defineWorkflow({
  workflowId: DELIVER_WORKFLOW_ID,
  workflowName: 'Factory: deliver product page',
  description: 'Opens the website PR for the product linked from a delegated board task.',
  metadata: { category: 'Factory', tags: ['factory', 'catalog', 'website', 'tasks'], icon: 'globe' },
  steps: [
    { stepId: 'start', stepName: 'Task delegated', stepType: 'START', description: 'Input: { taskId, delegationId }.' },
    {
      stepId: 'settle',
      stepName: 'Wait for the record to settle',
      stepType: 'AUTOMATED',
      description:
        'The catalog create form writes prices in follow-up calls after the product exists, so a short window lets the effector read the complete record.',
      activities: [{ activityId: 'settle_wait', activityName: 'settle_wait', activityType: 'WAIT', config: { duration: '10s' } }],
    },
    { stepId: PR_OPEN_MILESTONE, stepName: 'Website PR open', stepType: 'AUTOMATED', config: { milestone: PR_OPEN_MILESTONE } },
    { stepId: 'end', stepName: 'In review', stepType: 'END', description: 'The PR waits for Marek’s approval.' },
  ] as const,
  transitions: [
    { transitionId: 't_settle', transitionName: 'Settle', fromStepId: 'start', toStepId: 'settle', trigger: 'auto', priority: 100 },
    {
      transitionId: 't_open_pr',
      transitionName: 'Open PR',
      fromStepId: 'settle',
      toStepId: PR_OPEN_MILESTONE,
      trigger: 'auto',
      priority: 100,
      activities: [{
        activityId: 'open_product_pr',
        activityName: 'open_product_pr',
        activityType: 'EXECUTE_FUNCTION',
        config: { functionName: DELIVER_FUNCTION, args: {} },
        async: true,
        // One engine attempt: the function retries transient GitHub errors itself and closes the
        // task as failed on a final error (the 0.8.0 engine emits no workflows.instance.failed when
        // an async activity fails, so nothing else would release the task).
        retryPolicy: { maxAttempts: 1, initialIntervalMs: 5000, backoffCoefficient: 2, maxIntervalMs: 30000 },
      }],
    },
    {
      transitionId: 't_done',
      transitionName: 'Declare outcome',
      fromStepId: PR_OPEN_MILESTONE,
      toStepId: 'end',
      trigger: 'auto',
      priority: 100,
      activities: [{
        activityId: 'declare_outcome',
        activityName: 'declare_outcome',
        // The engine supports SET_VARIABLE; the shared builder's ActivityType union lags behind it.
        activityType: 'SET_VARIABLE' as ActivityType,
        config: {
          assignments: [{
            path: 'outcome',
            value: {
              type: 'factory:pull_request',
              id: '{{context.open_product_pr_result.result.prUrl}}',
              label: '{{context.open_product_pr_result.result.prLabel}}',
            },
          }],
        },
      }],
    },
  ],
})

/**
 * Seeds the owned workflow definition (with its least-privilege execution principal) and the
 * `factory.deliver` process definition. Idempotent; an existing process definition is pointed
 * back at the workflow and re-enabled.
 */
export async function ensureFactoryDeliver(container: AwilixContainer, scope: Scope): Promise<{ processDefinitionId: string; workflowDefinitionId: string }> {
  const em = (container.resolve('em') as EntityManager).fork()
  const authoring = container.resolve<WorkflowDefinitionAuthoring>('workflowDefinitionAuthoring')
  const owned = await authoring.upsertOwnedDefinition(em, {
    ownerModule: 'factory',
    ownerId: FACTORY_DELIVER_PROCESS,
    workflowId: DELIVER_WORKFLOW_ID,
    workflowName: deliverProduct.workflowName,
    description: deliverProduct.description ?? null,
    definition: deliverProduct.definition as unknown as WorkflowDefinitionData,
    metadata: deliverProduct.metadata ?? null,
    grantedFeatures: [...DELIVER_GRANTED_FEATURES],
    enabled: true,
    ...scope,
  })
  if (!owned.ok) throw new Error(`Workflow ${DELIVER_WORKFLOW_ID} exists and is not owned by the factory module`)

  const triggers = [{ kind: 'manual' as const, requireFeatures: [] }]
  const milestones = [{ key: PR_OPEN_MILESTONE, label: 'PR open', order: 1 }]
  let definition = await em.findOne(ProcessDefinition, { ...scope, name: FACTORY_DELIVER_PROCESS, deletedAt: null })
  if (!definition) {
    definition = em.create(ProcessDefinition, {
      ...scope,
      name: FACTORY_DELIVER_PROCESS,
      description: 'A board task delegated to Software Engineer becomes the product page PR in the website repo (SPEC-004 scene 3).',
      workflowId: DELIVER_WORKFLOW_ID,
      inputDefaults: null,
      inputSchema: null,
      outcomeSchema: null,
      triggers,
      milestones,
      uiMetadata: { icon: 'globe' },
      enabled: true,
      createdBy: null,
    })
  } else {
    definition.workflowId = DELIVER_WORKFLOW_ID
    definition.triggers = triggers
    definition.milestones = milestones
    definition.enabled = true
  }
  em.persist(definition)
  await em.flush()
  return { processDefinitionId: definition.id, workflowDefinitionId: owned.definition.id }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export type DeliverDeps = {
  resolveContainer: () => Promise<AwilixContainer>
  openPullRequest: (em: EntityManager, scope: Scope, productId: string) => Promise<PublishResult>
}

const defaultDeps: DeliverDeps = {
  resolveContainer: () => createRequestContainer(),
  openPullRequest: (em, scope, productId) =>
    publishProductPage({ em, github: new GitHubClient(readGitHubConfigFromEnv()), appUrl: process.env.APP_URL ?? null }, scope, productId),
}

/**
 * `EXECUTE_FUNCTION` handler of `factory.deliver_product`. Identity comes from the engine, never
 * from the payload: the process is the one bound to this workflow instance, the actor is the
 * definition's execution principal, and every task write goes through the tasks commands, which
 * re-check that binding (SPEC-002 process authority). Step ids make each write replay-safe.
 */
export function createDeliverFunction(deps: DeliverDeps = defaultDeps) {
  return async (_args: Record<string, unknown>, context: ActivityContext): Promise<PublishResult> => {
    const instance = context.workflowInstance
    const tenantId = instance.tenantId ?? null
    const organizationId = instance.organizationId ?? null
    if (!tenantId || !organizationId) throw new Error(`${DELIVER_FUNCTION}: workflow instance has no tenant/organization scope`)
    const scope = { tenantId, organizationId }

    const container = await deps.resolveContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const process = await findOneWithDecryption(em, ProcessInstance, { ...scope, workflowInstanceId: instance.id, deletedAt: null }, {}, scope)
    const input = record(process?.input)
    const taskId = typeof input?.taskId === 'string' ? input.taskId : null
    const delegationId = typeof input?.delegationId === 'string' ? input.delegationId : null
    if (!process || !taskId || !delegationId) throw new Error(`${DELIVER_FUNCTION}: no delegated task is bound to workflow instance ${instance.id}`)

    const definition = await findOneWithDecryption(em, WorkflowDefinition, { ...scope, id: instance.definitionId }, {}, scope)
    const actorUserId = await resolveWorkflowDefinitionExecutionUserId(em, definition, null)
    if (!actorUserId) throw new Error(`${DELIVER_FUNCTION}: the workflow has no execution principal`)

    const bus = container.resolve<CommandBus>('commandBus')
    const identity = { taskId, delegationId, processInstanceId: process.id }
    const run = (commandId: string, stepId: string, extra: Record<string, unknown>) =>
      bus.execute(commandId, { input: { ...identity, stepId, ...extra }, ctx: actingContext(container, scope, actorUserId) })

    await run('task_delegation.task.set_status', `${DELIVER_FUNCTION}:in_progress`, { status: 'in_progress' })
    try {
      const tasks = await container.resolve<QueryEngine>('queryEngine').query<{ id: string; description: string | null }>('staff:staff_time_task', {
        fields: ['id', 'description'], filters: { id: taskId }, page: { page: 1, pageSize: 1 }, ...scope,
      })
      const productId = readProductIdFromTask(tasks.items[0]?.description)
      if (!productId) throw new Error(`${DELIVER_FUNCTION}: task ${taskId} does not link a catalog product`)

      const result = await withTransientRetry(() => deps.openPullRequest(em, scope, productId))
      await run('task_delegation.task.link', `${DELIVER_FUNCTION}:pr`, { kind: 'pr', ref: result.prLabel, url: result.prUrl })
      await run('task_delegation.task.set_status', `${DELIVER_FUNCTION}:in_review`, { status: 'in_review' })
      logger.info('product page PR on the task', { taskId, productId, prUrl: result.prUrl, reused: result.reused })
      return result
    } catch (error) {
      // The only release on failure: with one engine attempt, this is final (see t_open_pr).
      const reason = error instanceof Error ? error.message : String(error)
      logger.error('factory delivery failed; closing the task', { taskId, error: reason })
      await run('task_delegation.task.set_status', `${DELIVER_FUNCTION}:failed`, { status: 'failed', reason: reason.slice(0, 8000) })
        .catch((closeError: unknown) => logger.error('could not close the failed task', {
          taskId, error: closeError instanceof Error ? closeError.message : String(closeError),
        }))
      throw error
    }
  }
}

/** Retries GitHub 5xx/429 and network errors; opening the PR is idempotent per product branch. */
export async function withTransientRetry<T>(work: () => Promise<T>, attempts = 3, delayMs = 3000): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work()
    } catch (error) {
      const transient = error instanceof GitHubApiError ? error.status >= 500 || error.status === 429 : error instanceof TypeError
      if (!transient || attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt))
    }
  }
}
