'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AssignedToPicker } from '../../../components/AssignedToPicker'

/**
 * `staff` 0.8.0 publishes ten overridable components and nine injection spots, and the drawer's
 * own assignee `Select` is none of them. Until it is, this rule hides the field our picker
 * replaces — `display: none` also takes it out of the tab order, so there is one assignment
 * control, not one visible and one reachable. `.ai/qa/tests` owns the tripwire that fails when
 * staff's markup moves and this selector stops matching.
 */
export const STAFF_ASSIGNEE_FIELD_TESTID = 'task-drawer-assignee-select'

export const HIDE_STAFF_ASSIGNEE_FIELD = `
div:has(> [data-testid="task-drawer-assignee-select"]) { display: none !important; }
`

export default function TaskAssignedToHeader({ context }: { context?: { taskId?: string } }) {
  const t = useT()
  if (!context?.taskId) return null
  return <section className="space-y-1" aria-label={t('task_delegation.assign.title', 'Assigned to')} data-om-assigned-to-host data-testid="task-assigned-to">
    <style>{HIDE_STAFF_ASSIGNEE_FIELD}</style>
    <span className="text-xs font-medium text-muted-foreground">{t('task_delegation.assign.title', 'Assigned to')}</span>
    <AssignedToPicker taskId={context.taskId} variant="drawer" keyboardShortcut />
  </section>
}
