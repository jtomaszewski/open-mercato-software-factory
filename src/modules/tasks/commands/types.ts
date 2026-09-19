import type { ProcessTaskStatus } from '../lib/transitionPolicy'
import type { TaskDelegationLinkKind } from '../data/entities'

export type { DelegateTaskInput, UndelegateTaskInput } from '../data/validators'
export type DelegateTaskResult = { taskId: string; delegationId: string }
export type UndelegateTaskResult = { taskId: string; delegationId: string; released: boolean }

export type ProcessCommandIdentity = {
  delegationId: string
  processInstanceId: string
  stepId: string
}

export type SetTaskStatusInput = ProcessCommandIdentity & {
  taskId: string
  status: ProcessTaskStatus
  reason?: string
}
export type SetTaskStatusResult = { applied: boolean; stale: boolean; status: ProcessTaskStatus }
export type LinkTaskInput = ProcessCommandIdentity & {
  taskId: string
  kind: TaskDelegationLinkKind
  ref: string
  url?: string
}
export type LinkTaskResult = { applied: boolean; stale: boolean }
export type CreateFollowupInput = ProcessCommandIdentity & {
  parentId: string
  title: string
  body: string
}
export type CreateFollowupResult = { applied: boolean; stale: boolean; taskId?: string }
