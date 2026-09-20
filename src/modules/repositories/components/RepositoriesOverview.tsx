"use client"
import * as React from 'react'
import Link from 'next/link'
import { GitBranch } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card } from '@open-mercato/ui/primitives/card'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import type { RepositoryOverviewItem } from '../api/handlers/repository-overview'
import { CodeSectionTabs } from '@/components/CodeSectionTabs'

function RepositoryCard({ item }: { item: RepositoryOverviewItem }) {
  const t = useT()
  const shortSha = item.head ? item.head.sha.slice(0, 7) : null
  return (
    <Card className="gap-3 py-4" data-testid="repository-card">
      <div className="flex flex-wrap items-start justify-between gap-2 px-6">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{item.fullName}</h2>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <GitBranch className="size-3.5" aria-hidden />
            {item.baseBranch}
          </p>
        </div>
        <StatusBadge variant={item.status === 'active' ? 'success' : 'warning'}>{t(`repositories.status.${item.status}`)}</StatusBadge>
      </div>

      <div className="px-6">
        <p className="text-xs text-muted-foreground">{t('repositories.overview.version')}</p>
        {shortSha
          ? <p className="mt-0.5 font-mono text-sm">
            {item.head?.htmlUrl
              ? <a className="text-primary underline" href={item.head.htmlUrl} target="_blank" rel="noopener noreferrer">{shortSha}</a>
              : shortSha}
          </p>
          : <p className="mt-0.5 text-sm text-muted-foreground">
            {item.headError ? t(`repositories.overview.headError.${item.headError}`, t('repositories.overview.headError.unavailable')) : '—'}
          </p>}
      </div>

      {item.head ? (
        <div className="px-6">
          <p className="text-xs text-muted-foreground">{t('repositories.overview.lastUpdate')}</p>
          <p className="mt-0.5 line-clamp-2 text-sm">{item.head.subject || '—'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('repositories.overview.byWhenAuthor', {
              author: item.head.authorName ?? t('repositories.overview.unknownAuthor'),
              when: (item.head.committedAt ? formatDisplayDateTime(item.head.committedAt) : null) ?? '—',
            })}
          </p>
        </div>
      ) : null}

      {item.projectNames.length ? (
        <div className="px-6">
          <p className="text-xs text-muted-foreground">{t('repositories.overview.projects')}</p>
          <p className="mt-0.5 text-sm">{item.projectNames.join(', ')}</p>
        </div>
      ) : null}
    </Card>
  )
}

/**
 * The Code section's "what are we changing" half: one card per registered repository, the version
 * its base branch is on, and who moved it there last.
 *
 * Read-only by design. Connecting, disabling and linking a repository to a project are settings
 * decisions with their own screens, so this page links to them rather than reproducing them —
 * the cards are for the person who wants to know the state of things, not change it.
 */
export function RepositoriesOverview() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [items, setItems] = React.useState<RepositoryOverviewItem[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(false)
      const call = await apiCall<{ items: RepositoryOverviewItem[] }>('/api/repositories/overview', undefined, { fallback: { items: [] } })
      if (cancelled) return
      if (!call.ok || !call.result) setError(true)
      else setItems(call.result.items)
      setIsLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [scopeVersion])

  return (
    <Page>
      <CodeSectionTabs active="repositories" />
      <PageHeader
        title={t('repositories.overview.title')}
        description={t('repositories.overview.description')}
        actions={<Button asChild variant="outline">
          <Link href="/backend/repositories">{t('repositories.overview.settings')}</Link>
        </Button>}
      />
      <PageBody>
        {isLoading ? <LoadingMessage label={t('repositories.overview.loading')} /> : null}
        {!isLoading && error ? <ErrorMessage label={t('repositories.list.loadError')} /> : null}
        {!isLoading && !error && !items.length
          ? <ListEmptyState
            title={t('repositories.overview.empty.title')}
            description={t('repositories.overview.empty.description')}
          />
          : null}
        {!isLoading && !error && items.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => <RepositoryCard key={item.id} item={item} />)}
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
