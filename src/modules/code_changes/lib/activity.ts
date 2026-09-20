import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import {
  AgentRun,
  AgentSpan,
  AgentToolCall,
  ProcessInstance,
} from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { requireTaskScope } from '../../task_delegation/lib/auth'
import { TaskDelegation } from '../../task_delegation/data/entities'
import { readChangeRequest } from './changeRequests'
import { agentStepDetail, agentStepKind, normalizeToolName, type AgentStepKind } from './agentSteps'

const logger = createLogger('code_changes').child({ component: 'activity' })

/** One tool the agent used, as the page shows it: what it was doing, and what it ran. */
export type AgentActivityStep = {
  id: string
  kind: AgentStepKind
  /** The bare tool name, for the technical fold. */
  tool: string
  /** The command, file or query — `null` when the tool's arguments carry none. */
  detail: string | null
  status: 'ok' | 'error'
  at: string
  durationMs: number | null
}

/** One agent invocation of this run. */
export type AgentActivityRun = {
  id: string
  agentId: string
  status: 'running' | 'ok' | 'error' | 'cancelled'
  startedAt: string
  completedAt: string | null
  errorMessage: string | null
  /**
   * The tool calls this run made, oldest first. Empty while the run is still in flight: the
   * OpenCode runtime ingests its trace once, when the session ends. Until then the browser's live
   * `agent_orchestrator.run.progress` subscription is the only source, which is why the page
   * merges the two rather than rendering this alone.
   */
  steps: AgentActivityStep[]
}

/**
 * What is happening to a change request right now.
 *
 * Deliberately separate from the change request itself: the orchestrator is an optional
 * registration and the workflow tables are another module's, so every read here degrades to "no
 * activity known" rather than taking the decision page down with it.
 */
export type ChangeRequestActivity = {
  /** Something is still working on this change — the page polls and shows a live indicator. */
  active: boolean
  /** The workflow step id, translated by the surface; `null` when the run has no workflow. */
  stage: string | null
  /** The newest fact this activity knows about, whatever produced it. */
  lastActivityAt: string | null
  runs: AgentActivityRun[]
}

const EMPTY: ChangeRequestActivity = { active: false, stage: null, lastActivityAt: null, runs: [] }

const LIVE_WORKFLOW_STATUSES = new Set(['RUNNING', 'WAITING_FOR_ACTIVITIES', 'FORKED', 'COMPENSATING'])

function newest(...values: (string | null | undefined)[]): string | null {
  let latest: string | null = null
  for (const value of values) {
    if (!value) continue
    if (!latest || value > latest) latest = value
  }
  return latest
}

function toolNameOf(call: AgentToolCall, span: AgentSpan | undefined): string {
  return normalizeToolName(call.toolName || span?.name || 'tool')
}

/**
 * The tool calls of the given runs, keyed by run id and ordered as they happened.
 *
 * Ordered by the span sequence rather than by `created_at`: the whole trace of an OpenCode run is
 * written in one ingest at the end of the session, so every row shares a timestamp to the
 * millisecond and only the sequence preserves the order the agent actually worked in.
 */
async function readSteps(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  runIds: string[],
): Promise<Map<string, AgentActivityStep[]>> {
  const byRun = new Map<string, AgentActivityStep[]>()
  if (!runIds.length) return byRun
  const [spans, calls] = await Promise.all([
    findWithDecryption(em, AgentSpan, { ...scope, agentRunId: { $in: runIds } }, { orderBy: { sequence: 'asc' } }, scope),
    findWithDecryption(em, AgentToolCall, { ...scope, agentRunId: { $in: runIds } }, {}, scope),
  ])
  const spanById = new Map(spans.map((span) => [span.id, span]))
  const sequenceOf = (call: AgentToolCall) => spanById.get(call.spanId)?.sequence ?? Number.MAX_SAFE_INTEGER
  for (const call of [...calls].sort((a, b) => sequenceOf(a) - sequenceOf(b))) {
    const span = spanById.get(call.spanId)
    const steps = byRun.get(call.agentRunId) ?? []
    steps.push({
      id: call.id,
      kind: agentStepKind(toolNameOf(call, span)),
      tool: toolNameOf(call, span),
      detail: agentStepDetail(call.requestSummary),
      status: call.status === 'error' ? 'error' : 'ok',
      at: (span?.startedAt ?? call.createdAt).toISOString(),
      durationMs: call.latencyMs ?? span?.durationMs ?? null,
    })
    byRun.set(call.agentRunId, steps)
  }
  return byRun
}

/**
 * How the change is being made, right now.
 *
 * Access is decided by `readChangeRequest` — a change request the caller cannot open answers 404
 * there, so this endpoint can never confirm the existence of a run on a project outside their
 * access either.
 */
export async function readChangeRequestActivity(
  ctx: CommandRuntimeContext,
  changeRequestId: string,
): Promise<ChangeRequestActivity> {
  const changeRequest = await readChangeRequest(ctx, changeRequestId)
  if (!changeRequest.delegationId) return EMPTY

  const em = ctx.container.resolve<EntityManager>('em')
  // `readChangeRequest` already checked `code_changes.view`; this only re-derives the scope it
  // validated, so the reads below can never widen past the organization it answered for.
  const { tenantId, organizationId } = await requireTaskScope(ctx)
  const scope = { tenantId, organizationId }

  try {
    const delegation = await findOneWithDecryption(em, TaskDelegation, { ...scope, id: changeRequest.delegationId }, {}, scope)
    if (!delegation?.processInstanceId) return EMPTY
    const process = await findOneWithDecryption(em, ProcessInstance, { ...scope, id: delegation.processInstanceId }, {}, scope)
    if (!process) return EMPTY

    // Agent runs are found through the workflow instance, not the process: the process row is a
    // projection recomputed from those runs, while `agent_runs.workflow_instance_id` is stamped by
    // the runner when it creates the row — so a run that is still in flight is already there.
    const workflowInstanceId = process.workflowInstanceId ?? null
    const [instance, runs] = await Promise.all([
      workflowInstanceId ? em.findOne(WorkflowInstance, { ...scope, id: workflowInstanceId }) : null,
      workflowInstanceId
        ? findWithDecryption(em, AgentRun, { ...scope, deletedAt: null, workflowInstanceId }, { orderBy: { createdAt: 'asc' } }, scope)
        : [],
    ])
    const steps = await readSteps(em, scope, runs.map((run) => run.id))

    const activeRun = runs.some((run) => run.status === 'running')
    const activeWorkflow = instance ? LIVE_WORKFLOW_STATUSES.has(instance.status) : false
    return {
      // A released delegation is finished whatever a stale row still says: the run closed its own
      // task, so nothing is working on this change any more and the page must stop polling.
      active: !delegation.releasedAt && (activeRun || activeWorkflow),
      stage: instance?.currentStepId ?? null,
      lastActivityAt: newest(
        process.lastActivityAt ? new Date(process.lastActivityAt).toISOString() : null,
        instance?.updatedAt?.toISOString(),
        ...runs.map((run) => (run.completedAt ?? run.updatedAt ?? run.createdAt)?.toISOString()),
      ),
      runs: runs.map((run) => ({
        id: run.id,
        agentId: run.agentId,
        status: run.status,
        startedAt: run.createdAt.toISOString(),
        completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
        errorMessage: run.errorMessage ?? null,
        steps: steps.get(run.id) ?? [],
      })),
    }
  } catch (error) {
    // The orchestrator and the workflow engine are optional to this page, never load-bearing.
    logger.warn('agent activity unavailable', {
      changeRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
    return EMPTY
  }
}
