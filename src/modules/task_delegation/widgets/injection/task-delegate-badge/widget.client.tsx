'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { resolveRunBarState, resolveRunChip } from '../../../lib/runPresentation'
import { useTaskDelegation } from '../../use-task-delegation'

/**
 * The card's state chip: one Polish phrase for what is happening with the task ("Pracuje · 12 min",
 * "Czeka na decyzję", "Do zatwierdzenia", "Nie udało się", "Opublikowane"), never a run-state name
 * the owner has to translate for themselves.
 */
export default function TaskDelegateBadge({ context }: { context?: { taskId?: string } }) {
  const t = useT()
  const { item, loading } = useTaskDelegation(context?.taskId)
  const delegation = item?.delegation ?? null
  const running = resolveRunBarState(delegation) === 'running'
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [running])

  if (loading && !item) return <span className="h-4 w-16 animate-pulse rounded bg-muted" aria-label={t('task_delegation.loading')} />
  // An undelegated task (released without an outcome) is back in human hands: no run chip.
  const chip = resolveRunChip(delegation, now)
  if (!chip) return null
  return <span title={delegation?.closeReason ?? undefined} data-testid="task-delegate-badge">
    <StatusBadge variant={chip.variant}>{t(chip.labelKey, chip.params)}</StatusBadge>
  </span>
}
