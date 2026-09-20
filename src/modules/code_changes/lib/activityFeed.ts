import type { AgentActivityRun, AgentActivityStep } from './activity'
import type { AgentStepKind } from './agentSteps'

export type FeedStepState = 'running' | 'done' | 'error'

/** One line of the feed, whichever source it came from. */
export type FeedStep = {
  key: string
  kind: AgentStepKind
  tool: string
  detail: string | null
  state: FeedStepState
  at: string
}

/** A line received live, before the run it belongs to is known to be this change request's. */
export type LiveStep = FeedStep & { runId: string; agentId: string; sequence: number }

export type FeedRun = {
  id: string
  agentId: string
  status: AgentActivityRun['status']
  startedAt: string
  errorMessage: string | null
  steps: FeedStep[]
  /** The lines came live, so they start when the page opened, not when the run did. */
  partial: boolean
}

function persistedToFeed(step: AgentActivityStep): FeedStep {
  return {
    key: step.id,
    kind: step.kind,
    tool: step.tool,
    detail: step.detail,
    state: step.status === 'error' ? 'error' : 'done',
    at: step.at,
  }
}

/**
 * The feed the card renders: the runs this change request owns, each showing its complete
 * persisted trace when it has one and the live lines received so far when it does not.
 *
 * Two rules do the real work here.
 *
 * Live lines are matched to a run by id and a run that is not in `runs` contributes NOTHING. The
 * `agent_orchestrator.run.progress` broadcast is scoped to the ORGANIZATION, so a second task
 * being worked on at the same time reaches this page too; rendering those would tell a reader the
 * agent did work on their change that it did on someone else's. Keeping them out of the feed
 * rather than out of the buffer is deliberate — a run whose row has simply not been polled yet is
 * not disproved, and its lines appear as soon as the next read confirms it.
 *
 * A run that has a persisted trace renders only that. The live lines for it were a preview of the
 * same calls, so showing both would double every step.
 */
export function mergeActivityFeed(runs: AgentActivityRun[], live: LiveStep[]): FeedRun[] {
  const linesFor = (runId: string) => live
    .filter((step) => step.runId === runId)
    .sort((a, b) => a.sequence - b.sequence)
  return runs
    .map((run) => ({
      id: run.id,
      agentId: run.agentId,
      status: run.status,
      startedAt: run.startedAt,
      errorMessage: run.errorMessage,
      steps: run.steps.length ? run.steps.map(persistedToFeed) : linesFor(run.id),
      partial: run.steps.length === 0 && linesFor(run.id).length > 0,
    }))
    // A run with neither steps nor a reason to be mentioned is noise on a decision page.
    .filter((run) => run.steps.length > 0 || run.status === 'running' || run.errorMessage)
}
