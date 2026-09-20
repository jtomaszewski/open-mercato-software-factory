import type { TaskRunAgentRun, TaskRunDetail } from '../../task_delegation/lib/runsQuery'

/** The page's `t`, narrowed to what this builder uses. */
export type Translate = (key: string, fallback?: string, params?: Record<string, string | number>) => string

/** One row of „Jak powstawała”: when it happened, what happened, and where the evidence is. */
export type RunTimelineEntry = {
  at: string
  label: string
  detail?: string | null
  /** In-app href for this row's evidence — an agent row links its own trace. */
  href?: string | null
  /** Label of the `href` link; set whenever `href` is. */
  hrefLabel?: string | null
}

const AGENT_RUN_LABELS: Record<string, string> = {
  running: 'code_changes.runs.agentRun.running',
  ok: 'code_changes.runs.agentRun.ok',
  error: 'code_changes.runs.agentRun.error',
  cancelled: 'code_changes.runs.agentRun.cancelled',
}

/** Where an agent run's trace lives: every tool call, prompt and cost the run produced. */
export function traceHref(agentRunId: string): string {
  return `/backend/traces/${encodeURIComponent(agentRunId)}`
}

/**
 * How long the agent worked, from its own stamp or from its start and end — omitted while it is
 * still working, because a duration that stops counting the moment the page renders is a lie.
 */
function durationOf(run: TaskRunAgentRun, t: Translate): string | null {
  const ms = run.latencyMs ?? (run.completedAt ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : null)
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return t('code_changes.runs.duration.seconds', '{seconds} s', { seconds })
  return t('code_changes.runs.duration.minutes', '{minutes} min {seconds} s', {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  })
}

function agentEntry(run: TaskRunAgentRun, t: Translate, canViewTrace: boolean): RunTimelineEntry {
  const detail = [run.agentId, durationOf(run, t), run.status === 'error' ? run.errorMessage : null]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ')
  return {
    at: run.startedAt,
    label: t(AGENT_RUN_LABELS[run.status] ?? 'code_changes.runs.agentRun.unknown', run.status),
    detail,
    // Without the orchestrator's trace feature the trace page answers 403, so the row states what
    // happened and offers no link, rather than sending the reader to a wall.
    href: canViewTrace ? traceHref(run.id) : null,
    hrefLabel: canViewTrace ? t('code_changes.runs.detail.openTrace', 'Open trace') : null,
  }
}

/**
 * „Jak powstawała”: the delegation, the milestones the process announced, the writes the run made
 * on its task and every agent invocation it took — one list, oldest first.
 *
 * The agent rows are the ones that answer „what is this run actually doing”, which neither the
 * board writes nor the milestones can: they carry the agent, how it ended and the link to its
 * trace. Steps stay labelled by what the write did, never by the step id, which carries function
 * names and instance uuids that say nothing to a reader.
 */
export function buildRunTimeline(
  run: TaskRunDetail | null | undefined,
  t: Translate,
  options: { canViewTrace: boolean },
): RunTimelineEntry[] {
  if (!run) return []
  const entries: RunTimelineEntry[] = [
    { at: run.delegation.startedAt, label: t('code_changes.runs.timeline.delegated') },
    ...(run.process?.milestones ?? []).map((milestone) => ({
      at: milestone.at,
      label: t(`code_changes.runs.milestone.${milestone.key}`, milestone.key),
      detail: t('code_changes.runs.timeline.milestone'),
    })),
    ...(run.agentRuns ?? []).map((agentRun) => agentEntry(agentRun, t, options.canViewTrace)),
    ...run.steps.map((step) => ({
      at: step.at,
      label: step.status
        ? `${t('code_changes.runs.step.status')} → ${t(`code_changes.runs.taskStatus.${step.status}`, step.status)}`
        : t(`code_changes.runs.step.${step.commandId}`, step.commandId),
      detail: step.stepId,
    })),
  ]
  if (run.delegation.releasedAt) {
    entries.push({
      at: run.delegation.releasedAt,
      label: t('code_changes.runs.timeline.released'),
      detail: run.delegation.closeReason,
    })
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at))
}
