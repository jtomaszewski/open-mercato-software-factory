import type { TaskDelegationDto } from './delegationService'

/**
 * One vocabulary for "what is happening with this task", shared by the drawer's status bar and the
 * board card's chip so the two can never disagree.
 *
 * It is deliberately wider than `TaskDelegationRunState`: the owner-facing surfaces split two
 * states the read model folds together — `complete` before and after the change is published, and
 * `failed` by configuration versus `failed` by the agent.
 */
export type RunBarState =
  | 'none'
  | 'starting'
  | 'stalled'
  | 'running'
  | 'awaiting_decision'
  | 'complete'
  | 'published'
  | 'failedConfig'
  | 'failedAgent'
  | 'rejected'

export type RunBarAction = 'delegate' | 'retry' | 'takeOver' | 'caseload' | 'changeDetail'

/**
 * A delegation released without an outcome is an agent a person removed: the task is back in human
 * hands and reads as if it had never been delegated.
 */
export function isLiveOrClosedRun(delegation: TaskDelegationDto | null | undefined): delegation is TaskDelegationDto {
  if (!delegation) return false
  return !(delegation.releasedAt && !delegation.outcome)
}

/**
 * Configuration failure, or the agent's own failure?
 *
 * The delegation stores no failure kind — only a free-text `closeReason` — and this change adds no
 * column, so the split is a heuristic and is treated as one: it decides which sentence the owner
 * reads and whether "Spróbuj ponownie" is offered, never whether a write is allowed.
 *
 * A run that never reached a process instance could not have been the agent's fault; beyond that,
 * the reasons raised before the agent does anything name their setting (`CODE_CHANGES_GITHUB_TOKEN`,
 * `CODE_CHANGES_REPO`, or `FACTORY_*` in reasons stored before the rename; a clone that could not start) or say the orchestrator was unavailable.
 * Those env-var names are internal and never reach the owner: the copy for this state talks about
 * the Software Engineer not being able to start, because that is the only name for the agent the
 * owner has ever been shown (SPEC-008).
 */
const CONFIGURATION_REASON = /(?:CODE_CHANGES|FACTORY)_[A-Z_]+|orchestrator|orkiestrator|is not set|must be owner\/name|Cannot clone|unavailable|niedostępn/i

export function isConfigurationFailure(delegation: TaskDelegationDto): boolean {
  if (!delegation.processInstanceId) return true
  return CONFIGURATION_REASON.test(delegation.closeReason ?? '')
}

export function resolveRunBarState(delegation: TaskDelegationDto | null | undefined): RunBarState {
  if (!isLiveOrClosedRun(delegation)) return 'none'
  if (delegation.outcome === 'done') return 'published'
  switch (delegation.runState) {
    case 'starting': return 'starting'
    case 'stalled': return 'stalled'
    case 'running': return 'running'
    case 'awaiting_decision': return 'awaiting_decision'
    case 'complete': return 'complete'
    case 'rejected': return 'rejected'
    case 'failed': return isConfigurationFailure(delegation) ? 'failedConfig' : 'failedAgent'
    // The read model answers `null` when the orchestrator cannot be read; the delegation still
    // exists, so the bar says the work has not visibly started rather than inventing progress.
    default: return 'stalled'
  }
}

/**
 * What the owner may do, in the order the bar renders it. The primary action is first.
 *
 * While the agent is working normally the one offer is to open its change and watch it happen —
 * taking the task over mid-run is an escape hatch, not the owner's next step, so it is kept for
 * the states where the run is not going anywhere (stalled, failed, rejected). Without a change to
 * open — a run that died before it proposed one — the escape hatch is all that is left.
 *
 * `awaiting_decision` links to the Caseload and offers nothing else: deciding a plan inline is out
 * of scope for this change (assumption A-1 of the discovery prototype).
 */
export function runBarActions(state: RunBarState, hasChangeLink = false): RunBarAction[] {
  switch (state) {
    case 'none': return ['delegate']
    case 'starting':
    case 'running': return hasChangeLink ? ['changeDetail'] : ['takeOver']
    case 'stalled': return hasChangeLink ? ['changeDetail', 'takeOver'] : ['takeOver']
    case 'awaiting_decision': return ['caseload']
    case 'failedConfig': return ['takeOver']
    case 'failedAgent':
    case 'rejected': return ['retry', 'takeOver']
    // `complete` and `published` are the `code_changes` panel's: it owns the preview and „Zatwierdź i
    // publikuj”, and it renders directly under this bar.
    default: return []
  }
}

/** Minutes the run has been going, rounded up so a fresh run never reads "0 min". */
export function runElapsedMinutes(delegation: TaskDelegationDto, now: number): number {
  const started = Date.parse(delegation.startedAt)
  if (Number.isNaN(started)) return 1
  return Math.max(1, Math.floor((now - started) / 60_000))
}

export type RunChip = {
  /** i18n key of the whole phrase — the card never assembles a label from parts. */
  labelKey: string
  params?: Record<string, string | number>
  variant: 'neutral' | 'success' | 'warning' | 'error'
}

/** The board card's one-phrase state chip, or `null` when no run is worth announcing. */
export function resolveRunChip(delegation: TaskDelegationDto | null | undefined, now: number): RunChip | null {
  const state = resolveRunBarState(delegation)
  if (state === 'none' || !delegation) return null
  switch (state) {
    case 'starting': return { labelKey: 'task_delegation.runState.starting', variant: 'neutral' }
    case 'stalled': return { labelKey: 'task_delegation.runState.stalled', variant: 'neutral' }
    case 'running': return {
      labelKey: 'task_delegation.runState.runningWithMinutes',
      params: { minutes: runElapsedMinutes(delegation, now) },
      variant: 'neutral',
    }
    case 'awaiting_decision': return { labelKey: 'task_delegation.runState.awaiting_decision', variant: 'warning' }
    case 'complete': return { labelKey: 'task_delegation.runState.complete', variant: 'success' }
    case 'published': return { labelKey: 'task_delegation.runState.published', variant: 'success' }
    case 'rejected': return { labelKey: 'task_delegation.runState.rejected', variant: 'warning' }
    default: return { labelKey: 'task_delegation.runState.failed', variant: 'error' }
  }
}

/**
 * The actions this owner can actually take right now.
 *
 * Every write here goes through a command that requires `task_delegation.delegate`, so without it
 * the bar explains and offers nothing. `takeOver` removes the agent, which only means something
 * while a delegation is live: a failed or rejected run has already released it and left the task
 * in Backlog with its person, so the button would be a no-op and is not offered.
 */
export function availableRunBarActions(input: {
  state: RunBarState
  hasActiveDelegation: boolean
  canDelegate: boolean
  hasChangeLink?: boolean
}): RunBarAction[] {
  return runBarActions(input.state, input.hasChangeLink ?? false).filter((action) => {
    // Reading the change is not a write: everyone who can see the task may open it.
    if (action === 'caseload' || action === 'changeDetail') return true
    if (!input.canDelegate) return false
    if (action === 'takeOver') return input.hasActiveDelegation
    return true
  })
}
