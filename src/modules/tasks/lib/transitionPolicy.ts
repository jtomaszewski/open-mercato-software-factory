export const PROCESS_STATUS_TO_COLUMN = {
  open: 'backlog',
  queued: 'queued',
  in_design: 'in-design',
  in_progress: 'in-progress',
  in_review: 'in-review',
  done: 'done',
  rejected: 'closed',
  failed: 'closed',
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
  | { allowed: false; code: 'process_owned' | 'process_only_column' }

export function evaluateHumanTaskMutation(input: HumanMutationInput): HumanMutationDecision {
  if (input.operation !== 'status_change') {
    return input.activeDelegation ? { allowed: false, code: 'process_owned' } : { allowed: true }
  }
  if (input.from === input.to) return { allowed: true }
  if (input.activeDelegation) {
    if (input.actorIsAssignee && input.from === 'in-review' && input.to === 'done') {
      return { allowed: true, releaseOutcome: 'done' }
    }
    if (input.actorIsAssignee && input.from === 'in-review' && input.to === 'closed') {
      return { allowed: true, releaseOutcome: 'rejected' }
    }
    return { allowed: false, code: 'process_owned' }
  }
  if (input.to === 'queued' || input.to === 'in-design') {
    return { allowed: false, code: 'process_only_column' }
  }
  return { allowed: true }
}

const PROCESS_TRANSITIONS: Readonly<Record<FactoryTaskColumn, readonly FactoryTaskColumn[]>> = {
  backlog: ['queued'],
  queued: ['in-design', 'in-progress', 'closed'],
  'in-design': ['in-progress', 'closed'],
  'in-progress': ['in-review', 'closed'],
  'in-review': ['done', 'closed', 'in-progress'],
  done: [],
  closed: [],
}

export function isAllowedProcessTransition(from: string, to: FactoryTaskColumn): boolean {
  if (from === to) return true
  return (PROCESS_TRANSITIONS[from as FactoryTaskColumn] ?? []).includes(to)
}
