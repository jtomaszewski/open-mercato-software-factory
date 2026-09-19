'use client'
import { AssignedToPicker } from '../../../components/AssignedToPicker'

/**
 * The same picker on the board card, so assigning does not cost opening the drawer. The run badge
 * stays with `task-delegate-badge` in this spot; the trigger here carries the owner only.
 */
export default function TaskAssignedToCard({ context }: { context?: { taskId?: string } }) {
  if (!context?.taskId) return null
  return <AssignedToPicker taskId={context.taskId} variant="card" />
}
