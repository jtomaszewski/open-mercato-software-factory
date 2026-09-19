'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AssignedToPicker } from '../../../components/AssignedToPicker'
import {
  HIDE_OWNER_IRRELEVANT_DRAWER_CHROME,
  HIDE_STAFF_ASSIGNEE_FIELD,
  STAFF_ASSIGNEE_FIELD_TESTID,
} from '../../../components/staffChrome'

// Re-exported where they have always been imported from, so the tripwire and any call site keep
// one name for the rule; the rules themselves now live with the rest of the staff chrome we hide.
export { HIDE_STAFF_ASSIGNEE_FIELD, STAFF_ASSIGNEE_FIELD_TESTID }

/**
 * The drawer's assignment control, and the one place the drawer's staff chrome is trimmed. Both are
 * `staff` internals we reach into through injected CSS rather than a published seam — see
 * `components/staffChrome.ts` for why, and for the tripwire that fails when staff's markup moves.
 */
export default function TaskAssignedToHeader({ context }: { context?: { taskId?: string } }) {
  const t = useT()
  if (!context?.taskId) return null
  return <section className="space-y-1" aria-label={t('task_delegation.assign.title', 'Assigned to')} data-om-assigned-to-host data-testid="task-assigned-to">
    <style>{HIDE_STAFF_ASSIGNEE_FIELD}{HIDE_OWNER_IRRELEVANT_DRAWER_CHROME}</style>
    <span className="text-xs font-medium text-muted-foreground">{t('task_delegation.assign.title', 'Assigned to')}</span>
    <AssignedToPicker taskId={context.taskId} variant="drawer" keyboardShortcut />
  </section>
}
