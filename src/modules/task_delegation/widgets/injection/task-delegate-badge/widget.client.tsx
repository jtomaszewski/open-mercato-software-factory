'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useTaskDelegation } from '../../use-task-delegation'

export default function TaskDelegateBadge({ context }: { context?: { taskId?: string } }) {
  const t = useT()
  const { item, loading } = useTaskDelegation(context?.taskId)
  if (loading && !item) return <span className="h-4 w-16 animate-pulse rounded bg-muted" aria-label={t('task_delegation.loading')} />
  const delegation = item?.delegation
  // An undelegated task (released without an outcome) is back in human hands: no run badge.
  if (!delegation || (delegation.releasedAt && !delegation.outcome)) return null
  const variant = delegation.runState === 'failed' ? 'error' : delegation.runState === 'rejected' ? 'warning' : delegation.runState === 'complete' ? 'success' : 'neutral'
  return <span title={delegation.closeReason ?? undefined}><StatusBadge variant={variant}>{delegation.runState ? t(`task_delegation.runState.${delegation.runState}`) : t('task_delegation.delegate.assigned')}</StatusBadge></span>
}
