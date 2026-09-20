import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { defineWorkflow } from '@open-mercato/shared/modules/workflows'
import type { ActivityType } from '@open-mercato/shared/modules/workflows'
import type { WorkflowDefinitionData } from '@open-mercato/core/modules/workflows/data/entities'
import type { WorkflowDefinitionAuthoring } from '@open-mercato/core/modules/workflows/lib/owned-definition'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { ProcessDefinition } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { OPEN_PULL_REQUEST_FUNCTION, PREPARE_CHECKOUT_FUNCTION } from '../../code_changes/lib/functions'
import { bindRun, closeOnFailure } from '../../code_changes/lib/run'
import { DEVELOPER_AGENT_ID, RESEARCHER_AGENT_ID } from './agents'
import { readOrderIdFromTask, readProductIdFromTask } from './board'
import { loadCatalogRecordView, type CatalogRecordView, type Scope } from './catalogRecord'
import { loadOrderRecordView, type OrderRecordView } from './orderRecord'

/** The process task_delegation starts for a delegation to the Software Engineer (its agent roster). */
export const WEBSITE_CHANGE_PROCESS = 'website_publishing.website_change'
export const WEBSITE_CHANGE_WORKFLOW_ID = 'website_publishing.website_change'
export const LOAD_RECORDS_FUNCTION = 'website_publishing.load_task_records'
export const PR_OPEN_MILESTONE = 'pr_open'
/**
 * The run's own principal: it may read and drive delegated tasks and run the agents (their
 * OpenCode sessions call MCP tools and submit outcomes as this principal), nothing else. The
 * Researcher's `web_fetch` needs both default-off web features (SPEC-006).
 */
export const WEBSITE_CHANGE_GRANTED_FEATURES = [
  'task_delegation.view',
  'task_delegation.process',
  'agent_orchestrator.agents.run',
  'agent_orchestrator.web_search',
  'agent_orchestrator.web_fetch',
] as const

/** What `load_task_records` hands the agent steps: the business records the task links. */
export type TaskRecords = {
  record: CatalogRecordView | null
  /** The fulfilled order a realization task is about (SPEC-006), else null. */
  order: OrderRecordView | null
}

const PREPARED = '{{context.prepare_checkout_result.result'
const RECORDS = '{{context.load_task_records_result.result'

/**
 * The engine evaluates an inline `transition.condition` (business_rules ConditionExpression over
 * the instance context); the shared builder's transition type lags behind it.
 */
const ONLY_WITH_ORDER: Record<string, unknown> = {
  condition: { field: 'load_task_records_result.result.order', operator: 'IS_NOT_EMPTY', value: null },
}

/** One engine attempt: the functions close the task as failed themselves (see `closeOnFailure`). */
const ONE_ATTEMPT = { maxAttempts: 1, initialIntervalMs: 5000, backoffCoefficient: 2, maxIntervalMs: 30000 }

/**
 * `website_publishing.website_change`: a delegated WWW task → a website PR (SPEC-004 scene 3,
 * SPEC-006 scene 3b). Input is `{ taskId, delegationId }` only; the functions derive everything
 * else. `code_changes` owns the checkout and the PR; this module adds the records the task links,
 * the Researcher for a realization and the Developer that edits the site.
 *
 * How outputs reach the persisted context in 0.8.0: a step never waits for its own async
 * activities, but an async TRANSITION activity parks the transition until the job completes
 * and merges its output under `<activityId>_result`; SET_VARIABLE persists only on transitions.
 * `INVOKE_AGENT` is the exception: it is a step activity that parks the step until the agent's
 * outcome arrives as a signal, whose payload (`outputMapping`) is merged into the context.
 */
const websiteChange = defineWorkflow({
  workflowId: WEBSITE_CHANGE_WORKFLOW_ID,
  workflowName: 'Website change',
  description: 'The Developer agent changes the website for a delegated board task and the platform opens the PR.',
  metadata: { category: 'Website publishing', tags: ['website', 'catalog', 'sales', 'tasks'], icon: 'globe' },
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
    { stepId: 'records_ready', stepName: 'Records loaded', stepType: 'AUTOMATED', description: 'The catalog product or the fulfilled order the task links.' },
    {
      stepId: 'research',
      stepName: 'Researcher reads the customer website',
      stepType: 'AUTOMATED',
      description: 'Realization tasks only (SPEC-006): the Researcher reads the customer’s public website with web_fetch and reports who they are, with the source.',
      signalConfig: { signalName: 'agent_orchestrator.proposal.ready' },
      activities: [{
        activityId: 'research',
        activityName: 'research',
        activityType: 'INVOKE_AGENT' as ActivityType,
        config: {
          agentId: RESEARCHER_AGENT_ID,
          input: {
            customer: `${RECORDS}.order.customer}}`,
            order: {
              orderNumber: `${RECORDS}.order.orderNumber}}`,
              lines: `${RECORDS}.order.lines}}`,
            },
          },
          onResult: { autoApproveThreshold: 0 },
          outputMapping: { research: 'data' },
        },
      }],
    },
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
            title: `${PREPARED}.title}}`,
            description: `${PREPARED}.description}}`,
            record: `${RECORDS}.record}}`,
            order: `${RECORDS}.order}}`,
            research: '{{context.research | default(null)}}',
            workDir: `${PREPARED}.workDir}}`,
          },
          // A research outcome is never a proposal, so no disposition applies; the schema needs a value.
          onResult: { autoApproveThreshold: 0 },
          outputMapping: { developer: 'data' },
        },
      }],
    },
    { stepId: PR_OPEN_MILESTONE, stepName: 'Website PR open', stepType: 'AUTOMATED', config: { milestone: PR_OPEN_MILESTONE } },
    { stepId: 'end', stepName: 'In review', stepType: 'END', description: 'The PR waits for Norbert’s approval.' },
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
        config: { functionName: PREPARE_CHECKOUT_FUNCTION, args: {} },
        async: true,
        retryPolicy: ONE_ATTEMPT,
      }],
    },
    {
      transitionId: 't_records',
      transitionName: 'Load the linked records',
      fromStepId: 'checkout_ready',
      toStepId: 'records_ready',
      trigger: 'auto',
      priority: 100,
      activities: [{
        activityId: 'load_task_records',
        activityName: 'load_task_records',
        activityType: 'EXECUTE_FUNCTION',
        config: { functionName: LOAD_RECORDS_FUNCTION, args: {} },
        async: true,
        retryPolicy: ONE_ATTEMPT,
      }],
    },
    {
      transitionId: 't_research',
      transitionName: 'Research the customer',
      fromStepId: 'records_ready',
      toStepId: 'research',
      trigger: 'auto',
      // Tried before t_develop: only a realization task carries an order.
      priority: 200,
      ...ONLY_WITH_ORDER,
    },
    { transitionId: 't_develop', transitionName: 'Develop', fromStepId: 'records_ready', toStepId: 'develop', trigger: 'auto', priority: 100 },
    { transitionId: 't_research_develop', transitionName: 'Develop', fromStepId: 'research', toStepId: 'develop', trigger: 'auto', priority: 100 },
    {
      transitionId: 't_open_pr',
      transitionName: 'Open PR',
      fromStepId: 'develop',
      toStepId: PR_OPEN_MILESTONE,
      trigger: 'auto',
      priority: 100,
      activities: [{
        activityId: 'open_pull_request',
        activityName: 'open_pull_request',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: OPEN_PULL_REQUEST_FUNCTION,
          args: { summary: '{{context.developer.summary}}', agentLabel: 'agent Developer (OpenCode w sandboxie orkiestratora)' },
        },
        async: true,
        retryPolicy: ONE_ATTEMPT,
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
              type: 'code_changes:pull_request',
              id: '{{context.open_pull_request_result.result.prUrl}}',
              label: '{{context.open_pull_request_result.result.prLabel}}',
            },
          }],
        },
      }],
    },
  ],
})

/**
 * Seeds the owned workflow definition (with its least-privilege execution principal) and the
 * process definition a delegation starts. Idempotent; an existing process definition is pointed
 * back at the workflow and re-enabled.
 */
export async function ensureWebsiteChangeProcess(container: AwilixContainer, scope: Scope): Promise<{ processDefinitionId: string; workflowDefinitionId: string }> {
  const em = (container.resolve('em') as EntityManager).fork()
  const authoring = container.resolve<WorkflowDefinitionAuthoring>('workflowDefinitionAuthoring')
  const owned = await authoring.upsertOwnedDefinition(em, {
    ownerModule: 'website_publishing',
    ownerId: WEBSITE_CHANGE_PROCESS,
    workflowId: WEBSITE_CHANGE_WORKFLOW_ID,
    workflowName: websiteChange.workflowName,
    description: websiteChange.description ?? null,
    definition: websiteChange.definition as unknown as WorkflowDefinitionData,
    metadata: websiteChange.metadata ?? null,
    grantedFeatures: [...WEBSITE_CHANGE_GRANTED_FEATURES],
    enabled: true,
    ...scope,
  })
  if (!owned.ok) throw new Error(`Workflow ${WEBSITE_CHANGE_WORKFLOW_ID} exists and is not owned by the website_publishing module`)

  const triggers = [{ kind: 'manual' as const, requireFeatures: [] }]
  const milestones = [{ key: PR_OPEN_MILESTONE, label: 'PR open', order: 1 }]
  let definition = await em.findOne(ProcessDefinition, { ...scope, name: WEBSITE_CHANGE_PROCESS, deletedAt: null })
  if (!definition) {
    definition = em.create(ProcessDefinition, {
      ...scope,
      name: WEBSITE_CHANGE_PROCESS,
      description: 'A board task delegated to the Software Engineer becomes a pull request in the website repo (SPEC-004 scene 3).',
      workflowId: WEBSITE_CHANGE_WORKFLOW_ID,
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
    definition.workflowId = WEBSITE_CHANGE_WORKFLOW_ID
    definition.triggers = triggers
    definition.milestones = milestones
    definition.enabled = true
  }
  em.persist(definition)
  await em.flush()
  return { processDefinitionId: definition.id, workflowDefinitionId: owned.definition.id }
}

export type LoadRecordsDeps = {
  resolveContainer: () => Promise<AwilixContainer>
  loadRecord: (em: EntityManager, scope: Scope, productId: string) => Promise<CatalogRecordView | null>
  loadOrder: (em: EntityManager, scope: Scope, orderId: string) => Promise<OrderRecordView | null>
}

const defaultDeps: LoadRecordsDeps = {
  resolveContainer: () => createRequestContainer(),
  loadRecord: loadCatalogRecordView,
  loadOrder: loadOrderRecordView,
}

/**
 * `EXECUTE_FUNCTION` handler of `website_publishing.load_task_records`: the catalog product or
 * the order the task description links, read from the task itself, never from the payload. A
 * task a person creates by hand with the same link works the same way.
 */
export function createLoadRecordsFunction(deps: LoadRecordsDeps = defaultDeps) {
  return async (_args: Record<string, unknown>, context: ActivityContext): Promise<TaskRecords> => {
    const bound = await bindRun(LOAD_RECORDS_FUNCTION, context, deps.resolveContainer)
    return closeOnFailure(bound, LOAD_RECORDS_FUNCTION, async () => {
      const productId = readProductIdFromTask(bound.task.description)
      const orderId = readOrderIdFromTask(bound.task.description)
      return {
        record: productId ? await deps.loadRecord(bound.em, bound.scope, productId) : null,
        order: orderId ? await deps.loadOrder(bound.em, bound.scope, orderId) : null,
      }
    })
  }
}
