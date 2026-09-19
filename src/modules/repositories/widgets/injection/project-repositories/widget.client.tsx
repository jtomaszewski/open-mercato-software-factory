'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'

type Link = { id: string; repositoryId: string; fullName: string; kind: string; isDefault: boolean; updatedAt: string }
type Option = { id: string; fullName: string; kind: string; qualificationStatus: string }

export default function ProjectRepositories({ context }: { context?: { projectId?: string | null } }) {
  const t = useT()
  const projectId = context?.projectId ?? null
  const [links, setLinks] = React.useState<Link[] | null>(null)
  const [options, setOptions] = React.useState<Option[]>([])
  const [selected, setSelected] = React.useState('')
  const [error, setError] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: `repositories.project-links.${projectId ?? 'missing'}` })

  React.useEffect(() => {
    if (!projectId) return
    let current = true
    setError(false)
    void Promise.all([
      readApiResultOrThrow<{ items: Link[] }>(`/api/repositories/project-links?projectId=${encodeURIComponent(projectId)}`),
      readApiResultOrThrow<{ items: Option[] }>('/api/repositories/options?page=1'),
    ]).then(([linked, available]) => {
      if (!current) return
      setLinks(linked.items)
      setOptions(available.items)
    }, () => { if (current) setError(true) })
    return () => { current = false }
  }, [projectId, revision])

  async function mutate(body: Record<string, unknown>, method: 'POST' | 'DELETE', updatedAt?: string) {
    await runMutation({
      context: { projectId, retryLastMutation }, mutationPayload: body,
      operation: () => withScopedApiRequestHeaders(updatedAt ? buildOptimisticLockHeader(updatedAt) : {}, () => apiCallOrThrow('/api/repositories/project-links', {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })),
    })
    setRevision((value) => value + 1)
  }

  if (!projectId) return null
  if (links === null && !error) return <LoadingMessage label={t('repositories.projectLinks.loading', 'Loading repositories...')} />
  if (error) return <ErrorMessage label={t('repositories.projectLinks.error', 'Could not load repositories.')} />
  const linkedIds = new Set((links ?? []).map((link) => link.repositoryId))
  const available = options.filter((option) => !linkedIds.has(option.id))
  return <section className="space-y-4" aria-label={t('repositories.projectLinks.tab', 'Repositories')}>
    <div className="flex flex-wrap items-center gap-2">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="w-80"><SelectValue placeholder={t('repositories.projectLinks.choose', 'Choose a repository')} /></SelectTrigger>
        <SelectContent>{available.map((option) => <SelectItem key={option.id} value={option.id}>{option.fullName}</SelectItem>)}</SelectContent>
      </Select>
      <Button disabled={!selected} onClick={() => void mutate({ projectId, repositoryId: selected, isDefault: (links ?? []).length === 0 }, 'POST').then(() => setSelected(''))}>
        {t('repositories.projectLinks.add', 'Add repository')}
      </Button>
    </div>
    {(links ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t('repositories.projectLinks.empty', 'No repositories are linked to this project.')}</p> : null}
    <ul className="divide-y rounded-md border border-border">{(links ?? []).map((link) => <li key={link.id} className="flex items-center justify-between gap-3 p-3">
      <div><p className="text-sm font-medium">{link.fullName}</p><p className="text-xs text-muted-foreground">{link.kind}{link.isDefault ? ` · ${t('repositories.projectLinks.default', 'Default')}` : ''}</p></div>
      <div className="flex gap-2">
        {!link.isDefault ? <Button variant="outline" size="sm" onClick={() => void mutate({ projectId, repositoryId: link.repositoryId, isDefault: true, updatedAt: link.updatedAt }, 'POST', link.updatedAt)}>{t('repositories.projectLinks.makeDefault', 'Make default')}</Button> : null}
        <Button variant="outline" size="sm" onClick={() => void mutate({ projectId, repositoryId: link.repositoryId, updatedAt: link.updatedAt }, 'DELETE', link.updatedAt)}>{t('repositories.projectLinks.remove', 'Remove')}</Button>
      </div>
    </li>)}</ul>
  </section>
}
