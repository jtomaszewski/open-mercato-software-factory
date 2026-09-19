'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Button } from '@open-mercato/ui/primitives/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import type { TasksAgentDto } from '../../../lib/delegationService'
import { useTaskDelegation } from '../../use-task-delegation'

function safeLink(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (value.startsWith('/backend/')) return value
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined } catch { return undefined }
}

export default function TaskDelegateSidebar({ context }: { context?: { taskId?: string } }) {
  const t = useT()
  const { payload } = useBackendChrome()
  const canDelegate = hasFeature(payload?.grantedFeatures, 'tasks.delegate')
  const { item, loading, error, refresh } = useTaskDelegation(context?.taskId)
  const hasActiveDelegation = Boolean(item?.delegation && !item.delegation.releasedAt)
  const [agents, setAgents] = React.useState<TasksAgentDto[]>([])
  const [agentUserId, setAgentUserId] = React.useState('')
  const [agentError, setAgentError] = React.useState(false)
  const [agentsLoading, setAgentsLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [mutationError, setMutationError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: 'tasks.delegate', blockedMessage: t('tasks.errors.blocked') })
  React.useEffect(() => {
    if (!canDelegate || hasActiveDelegation) return
    let current = true
    setAgents([])
    setAgentUserId('')
    setAgentError(false)
    setAgentsLoading(true)
    void readApiResultOrThrow<{ items: TasksAgentDto[] }>('/api/tasks/agents').then((value) => {
      if (current) setAgents(value.items)
    }, () => { if (current) setAgentError(true) }).finally(() => { if (current) setAgentsLoading(false) })
    return () => { current = false }
  }, [canDelegate, hasActiveDelegation, item?.taskId, payload?.currentOrganization?.id])

  async function mutate(remove: boolean) {
    if (!item || saving) return
    setSaving(true)
    setMutationError(null)
    try {
      await runMutation({
        context: { taskId: item.taskId, retryLastMutation },
        mutationPayload: remove ? { taskId: item.taskId } : { taskId: item.taskId, agentUserId },
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(item.taskUpdatedAt), () => apiCallOrThrow(
          remove ? `/api/tasks/delegations/${item.taskId}` : '/api/tasks/delegations',
          remove ? { method: 'DELETE' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: item.taskId, agentUserId }) },
        )),
      })
      refresh()
    } catch (failure) {
      setMutationError(failure instanceof Error ? failure.message : t('tasks.errors.mutation'))
    } finally { setSaving(false) }
  }

  if (loading && !item) return <LoadingMessage label={t('tasks.loading')} />
  if (error) return <ErrorMessage label={t('tasks.errors.load')} />
  if (!item) return null
  const delegation = item.delegation
  const active = delegation && !delegation.releasedAt
  return <section className="space-y-3" aria-label={t('tasks.delegate.title')} data-testid="tasks-delegate-sidebar">
    <h3 className="text-sm font-medium">{t('tasks.delegate.title')}</h3>
    {delegation ? <>
      <p className="text-sm">{delegation.delegateName}</p>
      <StatusBadge variant="neutral">{delegation.runState ? t(`tasks.runState.${delegation.runState}`) : t('tasks.delegate.assigned')}</StatusBadge>
      {delegation.closeReason ? <p className="text-sm text-muted-foreground">{delegation.closeReason}</p> : null}
      <ul className="space-y-1 text-sm">{delegation.links.map((link) => {
        const href = safeLink(link.url)
        return href ? <li key={`${link.kind}:${link.ref}`}><a className="text-primary underline" href={href} target={href.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer">{t(`tasks.links.${link.kind}`)}</a></li> : null
      })}</ul>
    </> : <p className="text-sm text-muted-foreground">{t('tasks.delegate.none')}</p>}
    {canDelegate && active ? <Button variant="outline" size="sm" disabled={saving || loading} onClick={() => void mutate(true)}>{t('tasks.delegate.remove')}</Button> : null}
    {canDelegate && !active ? <div className="space-y-2">
      {agentsLoading ? <LoadingMessage label={t('tasks.loading')} /> : agentError ? <ErrorMessage label={t('tasks.errors.agents')} /> : agents.length === 0 ? <p className="text-sm text-muted-foreground">{t('tasks.delegate.noAgents')}</p> : <>
        <Select value={agentUserId} onValueChange={setAgentUserId} disabled={saving}>
          <SelectTrigger aria-label={t('tasks.delegate.choose')}><SelectValue placeholder={t('tasks.delegate.choose')} /></SelectTrigger>
          <SelectContent>{agents.map((agent) => <SelectItem key={agent.userId} value={agent.userId}>{agent.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" disabled={!agentUserId || saving || loading} onClick={() => void mutate(false)}>{t('tasks.delegate.action')}</Button>
      </>}
    </div> : null}
    {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError}</p> : null}
  </section>
}
