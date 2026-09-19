import type { ProcessTaskStatus } from '../lib/transitionPolicy'
import type { TaskDelegationLinkKind } from '../data/entities'

export type { AssignTaskInput, DelegateTaskInput, UndelegateTaskInput } from '../data/validators'
export type DelegateTaskResult = { taskId: string; delegationId: string }
export type UndelegateTaskResult = { taskId: string; delegationId: string; released: boolean }
/**
 * `previousAssigneeStaffMemberId` and `assigneeChanged` are what the audit entry needs to undo the
 * human half; the route answers with the first three fields only.
 */
export type AssignTaskResult = {
  taskId: string
  assigneeStaffMemberId: string | null
  delegation: { id: string } | null
  previousAssigneeStaffMemberId: string | null
  assigneeChanged: boolean
}

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
