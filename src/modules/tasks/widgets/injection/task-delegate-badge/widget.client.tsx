'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useTaskDelegation } from '../../use-task-delegation'

export default function TaskDelegateBadge({ context }: { context?: { taskId?: string } }) {
  const t = useT()
  const { item, loading } = useTaskDelegation(context?.taskId)
  if (loading && !item) return <span className="h-4 w-16 animate-pulse rounded bg-muted" aria-label={t('tasks.loading')} />
  const delegation = item?.delegation
  if (!delegation) return null
  const variant = delegation.runState === 'failed' ? 'error' : delegation.runState === 'complete' ? 'success' : 'neutral'
  return <span title={delegation.closeReason ?? undefined}><StatusBadge variant={variant}>{delegation.runState ? t(`tasks.runState.${delegation.runState}`) : t('tasks.delegate.assigned')}</StatusBadge></span>
}
