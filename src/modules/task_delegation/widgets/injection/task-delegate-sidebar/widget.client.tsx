'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useTaskDelegation } from '../../use-task-delegation'

function safeLink(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (value.startsWith('/backend/')) return value
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined } catch { return undefined }
}

/**
 * What the run produced, and nothing that sets it: setting and removing the delegate moved to the
 * "Assigned to" picker in the drawer header, so the drawer offers one assignment control.
 */
export default function TaskDelegateSidebar({ context }: { context?: { taskId?: string } }) {
  const t = useT()
  const { item, loading, error } = useTaskDelegation(context?.taskId)
  if (loading && !item) return <LoadingMessage label={t('task_delegation.loading')} />
  if (error) return <ErrorMessage label={t('task_delegation.errors.load')} />
  if (!item) return null
  const delegation = item.delegation
  return <section className="space-y-3" aria-label={t('task_delegation.delegate.title')} data-testid="tasks-delegate-sidebar">
    <h3 className="text-sm font-medium">{t('task_delegation.delegate.title')}</h3>
    {delegation ? <>
      <p className="text-sm">{delegation.delegateName}</p>
      <StatusBadge variant="neutral">{delegation.runState ? t(`task_delegation.runState.${delegation.runState}`) : t('task_delegation.delegate.assigned')}</StatusBadge>
      {delegation.closeReason ? <p className="text-sm text-muted-foreground">{delegation.closeReason}</p> : null}
      <ul className="space-y-1 text-sm">{delegation.links.map((link) => {
        const href = safeLink(link.url)
        return href ? <li key={`${link.kind}:${link.ref}`}><a className="text-primary underline" href={href} target={href.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer">{t(`task_delegation.links.${link.kind}`)}</a></li> : null
      })}</ul>
    </> : <p className="text-sm text-muted-foreground">{t('task_delegation.delegate.none')}</p>}
  </section>
}
