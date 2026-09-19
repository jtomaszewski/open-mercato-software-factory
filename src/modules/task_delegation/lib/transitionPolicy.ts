/**
 * The board is staff's default four columns; the factory adds none. The process phases before
 * review share In progress (the card badge shows the run state), and a run that ends without
 * shipping returns the task to Backlog, where it can be delegated again.
 */
export const PROCESS_STATUS_TO_COLUMN = {
  open: 'backlog',
  queued: 'in-progress',
  in_design: 'in-progress',
  in_progress: 'in-progress',
  in_review: 'in-review',
  done: 'done',
  rejected: 'backlog',
  failed: 'backlog',
} as const

export type ProcessTaskStatus = keyof typeof PROCESS_STATUS_TO_COLUMN
export type FactoryTaskColumn = (typeof PROCESS_STATUS_TO_COLUMN)[ProcessTaskStatus]
export type DelegationOutcome = 'done' | 'rejected' | 'failed'

export function mapProcessStatus(status: ProcessTaskStatus): FactoryTaskColumn {
  return PROCESS_STATUS_TO_COLUMN[status]
}

type HumanMutationInput =
  | {
      operation: 'status_change'
      from: string
      to: string
      activeDelegation: boolean
      actorIsAssignee: boolean
    }
  | { operation: 'update' | 'delete' | 'undo'; activeDelegation: boolean }

export type HumanMutationDecision =
  | { allowed: true; releaseOutcome?: 'done' | 'rejected' }
  | { allowed: false; code: 'process_owned' }

export function evaluateHumanTaskMutation(input: HumanMutationInput): HumanMutationDecision {
  if (input.operation !== 'status_change') {
    return input.activeDelegation ? { allowed: false, code: 'process_owned' } : { allowed: true }
  }
  if (input.from === input.to) return { allowed: true }
  if (input.activeDelegation) {
    if (input.actorIsAssignee && input.from === 'in-review' && input.to === 'done') {
      return { allowed: true, releaseOutcome: 'done' }
    }
    if (input.actorIsAssignee && input.from === 'in-review' && input.to === 'backlog') {
      return { allowed: true, releaseOutcome: 'rejected' }
    }
    return { allowed: false, code: 'process_owned' }
  }
  return { allowed: true }
}

const PROCESS_TRANSITIONS: Readonly<Record<FactoryTaskColumn, readonly FactoryTaskColumn[]>> = {
  backlog: ['in-progress'],
  'in-progress': ['in-review', 'backlog'],
  'in-review': ['done', 'in-progress', 'backlog'],
  done: [],
}

export function isAllowedProcessTransition(from: string, to: FactoryTaskColumn): boolean {
  if (from === to) return true
  return (PROCESS_TRANSITIONS[from as FactoryTaskColumn] ?? []).includes(to)
}

/**
 * Whether a process reached a milestone. The orchestrator's `milestones_reached` column can hold a
 * JSON-encoded string (`"[]"`) rather than an array, so both shapes are read.
 */
export function hasReachedMilestone(milestonesReached: unknown, key: string): boolean {
  let list = milestonesReached
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return false }
  }
  return Array.isArray(list) && list.some((milestone) => (milestone as { key?: unknown } | null)?.key === key)
}
