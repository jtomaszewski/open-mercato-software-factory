import type { z } from 'zod'
import { prOnlyProfileSchema } from '@/modules/repositories/data/validators'
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
import type { CatalogRecordView, Scope } from './catalogRecord'
import { actingContext, readProductIdFromTask } from './board'
import type { RepositoryBroker, RepositoryExecutionBinding } from '@/modules/repositories/lib/broker'
import { REPOSITORY_TARGET_RESOLVER, type RepositoryTargetResolver, type ResolvedRepositoryTarget } from '@/modules/repositories/lib/target-resolver'
import { prepareRepositoryCheckout, collectRepositoryChanges } from './repository-checkout'
import { loadCatalogRecordView } from './catalogRecord'
import { readCheckoutConfigFromEnv, removeCheckout, type CollectedChange, type PreparedCheckout } from './checkout'
import { DEVELOPER_AGENT_ID, pullRequestSummary, type DeliveredPr, type DeveloperChange, type DeveloperTask } from './developer'

const logger = createLogger('factory').child({ component: 'deliver' })

/** The process task_delegation's start-factory subscriber starts for a delegation (SPEC-002). */
export const FACTORY_DELIVER_PROCESS = 'factory.deliver'
export const DELIVER_WORKFLOW_ID = 'factory.deliver_product'
export const PREPARE_FUNCTION = 'factory.prepare_checkout'
export const DELIVER_FUNCTION = 'factory.deliver_product_pr'
export const PR_OPEN_MILESTONE = 'pr_open'
/**
 * The run's own principal: it may read and drive delegated tasks and run the Developer agent
 * (the agent's OpenCode session submits its outcome through MCP as this principal), nothing else.
 */
export const DELIVER_GRANTED_FEATURES = ['task_delegation.view', 'task_delegation.process', 'agent_orchestrator.agents.run'] as const

/** What `prepare_checkout` hands the agent step through the workflow context. */
export type DeveloperInput = {
  delegationId: string
  taskId: string
  repositoryFullName: string
  baseBranch: string
  verificationCommands: z.infer<typeof prOnlyProfileSchema>['commands']
  title: string
  description: string
  record: CatalogRecordView | null
  /** The checkout as the sidecar sees it. */
  workDir: string
  baseSha: string
}

const PREPARED = '{{context.prepare_checkout_result.result'

/**
 * `factory.deliver_product`: a delegated DEMO task → the product's website PR (SPEC-004 scene 3).
 * Input is `{ taskId, delegationId }` only; the functions derive everything else.
 *
 * How outputs reach the persisted context in 0.8.0: a step never waits for its own async
 * activities, but an async TRANSITION activity parks the transition until the job completes
 * and merges its output under `<activityId>_result`; SET_VARIABLE persists only on transitions.
 * `INVOKE_AGENT` is the exception: it is a step activity that parks the step until the agent's
 * outcome arrives as a signal, whose payload (`outputMapping`) is merged into the context.
 */
const deliverProduct = defineWorkflow({
  workflowId: DELIVER_WORKFLOW_ID,
  workflowName: 'Factory: deliver website change',
  description: 'The Developer agent changes the website for a delegated board task and the platform opens the PR.',
  metadata: { category: 'Factory', tags: ['factory', 'catalog', 'website', 'tasks'], icon: 'globe' },
  steps: [
    { stepId: 'start', stepName: 'Task delegated', stepType: 'START', description: 'Input: { taskId, delegationId }.' },
    {
      stepId: 'settle',
      stepName: 'Wait for the record to settle',
      stepType: 'AUTOMATED',
      description:
        'The catalog create form writes prices in follow-up calls after the product exists, so a short window lets the run read the complete record.',
      activities: [{ activityId: 'settle_wait', activityName: 'settle_wait', activityType: 'WAIT', config: { duration: '10s' } }],
    },
    { stepId: 'checkout_ready', stepName: 'Website checked out', stepType: 'AUTOMATED', description: 'The site repo is cloned into the run sandbox.' },
    {
      stepId: 'develop',
      stepName: 'Developer agent works',
      stepType: 'AUTOMATED',
      description: 'The Developer file agent edits and builds the checkout in the OpenCode sidecar; its run, trace and cost are the orchestrator’s.',
      signalConfig: { signalName: 'agent_orchestrator.proposal.ready' },
      activities: [{
        activityId: 'develop',
        activityName: 'develop',
        // The engine supports INVOKE_AGENT; the shared builder's ActivityType union lags behind it.
        activityType: 'INVOKE_AGENT' as ActivityType,
        config: {
          agentId: DEVELOPER_AGENT_ID,
          input: {
            taskId: `${PREPARED}.taskId}}`,
            delegationId: `${PREPARED}.delegationId}}`,
            repositoryFullName: `${PREPARED}.repositoryFullName}}`,
            baseBranch: `${PREPARED}.baseBranch}}`,
            verificationCommands: `${PREPARED}.verificationCommands}}`,
            title: `${PREPARED}.title}}`,
            description: `${PREPARED}.description}}`,
            record: `${PREPARED}.record}}`,
            workDir: `${PREPARED}.workDir}}`,
          },
          // A research outcome is never a proposal, so no disposition applies; the schema needs a value.
          onResult: { autoApproveThreshold: 0 },
          outputMapping: { developer: 'data' },
        },
      }],
    },
    { stepId: PR_OPEN_MILESTONE, stepName: 'Website PR open', stepType: 'AUTOMATED', config: { milestone: PR_OPEN_MILESTONE } },
    { stepId: 'end', stepName: 'In review', stepType: 'END', description: 'The PR waits for Marek’s approval.' },
  ] as const,
  transitions: [
    { transitionId: 't_settle', transitionName: 'Settle', fromStepId: 'start', toStepId: 'settle', trigger: 'auto', priority: 100 },
    {
      transitionId: 't_prepare',
      transitionName: 'Check out the website',
      fromStepId: 'settle',
      toStepId: 'checkout_ready',
      trigger: 'auto',
      priority: 100,
      activities: [{
        activityId: 'prepare_checkout',
        activityName: 'prepare_checkout',
        activityType: 'EXECUTE_FUNCTION',
        config: { functionName: PREPARE_FUNCTION, args: {} },
        async: true,
        // One engine attempt: the function closes the task as failed on an error (the 0.8.0 engine
        // emits no workflows.instance.failed when an async activity fails).
        retryPolicy: { maxAttempts: 1, initialIntervalMs: 5000, backoffCoefficient: 2, maxIntervalMs: 30000 },
      }],
    },
    { transitionId: 't_develop', transitionName: 'Develop', fromStepId: 'checkout_ready', toStepId: 'develop', trigger: 'auto', priority: 100 },
    {
      transitionId: 't_open_pr',
      transitionName: 'Open PR',
      fromStepId: 'develop',
      toStepId: PR_OPEN_MILESTONE,
      trigger: 'auto',
      priority: 100,
      activities: [{
        activityId: 'open_product_pr',
        activityName: 'open_product_pr',
        activityType: 'EXECUTE_FUNCTION',
        config: { functionName: DELIVER_FUNCTION, args: { summary: '{{context.developer.summary}}' } },
        async: true,
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
  loadRecord: (em: EntityManager, scope: Scope, productId: string) => Promise<CatalogRecordView | null>
  prepareCheckout: (delegationId: string, repository: ResolvedRepositoryTarget) => Promise<PreparedCheckout>
  collectChanges: (delegationId: string, repository: ResolvedRepositoryTarget) => Promise<CollectedChange>
  removeCheckout: (delegationId: string, repository: ResolvedRepositoryTarget) => Promise<void>
  openPullRequest: (task: DeveloperTask, change: DeveloperChange, delegationId: string, repository: ResolvedRepositoryTarget) => Promise<DeliveredPr>
}

const defaultDeps: DeliverDeps = {
  resolveContainer: () => createRequestContainer(),
  loadRecord: loadCatalogRecordView,
  async prepareCheckout(delegationId, repository) {
    const container = await createRequestContainer()
    const source = await container.resolve<RepositoryBroker>('repositoryBroker').exportSource(executionBinding(delegationId, repository))
    return prepareRepositoryCheckout(checkoutConfiguration(repository), delegationId, {
      baseSha: source.baseSha,
      files: source.files.map((file) => ({ path: file.path, content: file.contentBase64, executable: file.mode === '100755' })),
    })
  },
  collectChanges: (delegationId, repository) => collectRepositoryChanges(checkoutConfiguration(repository), delegationId),
  removeCheckout: (delegationId, repository) => removeCheckout(checkoutConfiguration(repository), delegationId),
  async openPullRequest(task, change, delegationId, repository) {
    const container = await createRequestContainer()
    const result = await container.resolve<RepositoryBroker>('repositoryBroker').openPullRequest({
      ...executionBinding(delegationId, repository),
      baseSha: change.baseSha,
      title: task.title.slice(0, 120),
      body: pullRequestSummary(change.summary) || task.title,
      files: change.files,
    })
    return { prNumber: result.number, prUrl: result.url, prLabel: `PR #${result.number}`, branch: result.branch }
  },
}

function checkoutConfiguration(repository: ResolvedRepositoryTarget) {
  return { ...readCheckoutConfigFromEnv({ ...process.env, FACTORY_SITE_REPO: repository.fullName, FACTORY_SITE_BASE_BRANCH: repository.baseBranch }), repo: repository.fullName, baseBranch: repository.baseBranch }
}

function executionBinding(delegationId: string, repository: ResolvedRepositoryTarget): RepositoryExecutionBinding {
  return { delegationId, repositoryId: repository.repositoryId, epoch: repository.configEpoch, profileDigest: repository.profileDigest,
    installationId: repository.installationId, authorizationId: repository.brokerAuthorizationId,
    githubRepositoryId: repository.githubRepositoryId, baseBranch: repository.baseBranch }
}

type BoundRun = {
  delegationId: string
  scope: Scope
  container: AwilixContainer
  em: EntityManager
  task: DeveloperTask
  /** A task write through the task_delegation commands, replay-safe per step id. */
  run: (commandId: string, stepId: string, extra: Record<string, unknown>) => Promise<unknown>
}

/**
 * Identity comes from the engine, never from the payload: the process is the one bound to this
 * workflow instance, the actor is the definition's execution principal, and every task write goes
 * through the task_delegation commands, which re-check that binding (SPEC-002 process authority).
 */
async function bindRun(functionName: string, context: ActivityContext, deps: DeliverDeps): Promise<BoundRun> {
  const instance = context.workflowInstance
  const tenantId = instance.tenantId ?? null
  const organizationId = instance.organizationId ?? null
  if (!tenantId || !organizationId) throw new Error(`${functionName}: workflow instance has no tenant/organization scope`)
  const scope = { tenantId, organizationId }

  const container = await deps.resolveContainer()
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

  const tasks = await container.resolve<QueryEngine>('queryEngine').query<{ id: string; title: string; description: string | null }>('staff:staff_time_task', {
    fields: ['id', 'title', 'description'], filters: { id: taskId }, page: { page: 1, pageSize: 1 }, ...scope,
  })
  const task = tasks.items[0]
  if (!task) throw new Error(`${functionName}: task ${taskId} is not visible in its organization`)
  return { delegationId, scope, container, em, task: { id: task.id, title: task.title, description: task.description }, run }
}

/** The only release on failure: with one engine attempt per function, this is final. */
async function closeFailed(bound: BoundRun, functionName: string, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error)
  logger.error('factory delivery failed; closing the task', { taskId: bound.task.id, functionName, error: reason })
  await bound.run('task_delegation.task.set_status', `${functionName}:failed`, { status: 'failed', reason: reason.slice(0, 8000) })
    .catch((closeError: unknown) => logger.error('could not close the failed task', {
      taskId: bound.task.id, error: closeError instanceof Error ? closeError.message : String(closeError),
    }))
}

/**
 * `EXECUTE_FUNCTION` handler of `factory.prepare_checkout`: the task goes In progress and the site
 * repo is cloned into the run sandbox. Returns the Developer agent's input.
 */
export function createPrepareFunction(deps: DeliverDeps = defaultDeps) {
  return async (_args: Record<string, unknown>, context: ActivityContext): Promise<DeveloperInput> => {
    const bound = await bindRun(PREPARE_FUNCTION, context, deps)
    try {
      const repository = await bound.container.resolve<RepositoryTargetResolver>(REPOSITORY_TARGET_RESOLVER).resolveDelegationTarget({ ...bound.scope, delegationId: bound.delegationId })
      await bound.run('task_delegation.task.set_status', `${PREPARE_FUNCTION}:in_progress`, { status: 'in_progress' })
      const productId = readProductIdFromTask(bound.task.description)
      const catalogRecord = productId ? await deps.loadRecord(bound.em, bound.scope, productId) : null
      const checkout = await deps.prepareCheckout(bound.delegationId, repository)
      logger.info('website checked out for the Developer agent', { taskId: bound.task.id, productId, baseSha: checkout.baseSha })
      return {
        taskId: bound.task.id,
        delegationId: bound.delegationId,
        repositoryFullName: repository.fullName,
        baseBranch: repository.baseBranch,
        verificationCommands: prOnlyProfileSchema.shape.commands.parse(repository.profile.commands),
        title: bound.task.title,
        description: bound.task.description ?? '',
        record: catalogRecord,
        workDir: checkout.workDir,
        baseSha: checkout.baseSha,
      }
    } catch (error) {
      await closeFailed(bound, PREPARE_FUNCTION, error)
      throw error
    }
  }
}

/**
 * `EXECUTE_FUNCTION` handler of `factory.deliver_product_pr`: the agent's changes become one PR
 * on the task, which moves to In review. `args.summary` is the agent's outcome summary.
 */
export function createDeliverFunction(deps: DeliverDeps = defaultDeps) {
  return async (args: Record<string, unknown>, context: ActivityContext): Promise<DeliveredPr> => {
    const bound = await bindRun(DELIVER_FUNCTION, context, deps)
    try {
      const repository = await bound.container.resolve<RepositoryTargetResolver>(REPOSITORY_TARGET_RESOLVER).resolveDelegationTarget({ ...bound.scope, delegationId: bound.delegationId })
      const change = await deps.collectChanges(bound.delegationId, repository)
      const summary = typeof args.summary === 'string' && !args.summary.startsWith('{{') ? args.summary : ''
      const result = await deps.openPullRequest(bound.task, { ...change, summary }, bound.delegationId, repository)
      await bound.run('task_delegation.task.link', `${DELIVER_FUNCTION}:pr`, { kind: 'pr', ref: result.prLabel, url: result.prUrl })
      await bound.run('task_delegation.task.set_status', `${DELIVER_FUNCTION}:in_review`, { status: 'in_review' })
      await deps.removeCheckout(bound.delegationId, repository).catch((cleanupError: unknown) =>
        logger.warn('could not remove the checkout', { taskId: bound.task.id, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }))
      logger.info('website PR on the task', { taskId: bound.task.id, prUrl: result.prUrl })
      return result
    } catch (error) {
      await closeFailed(bound, DELIVER_FUNCTION, error)
      throw error
    }
  }
}
