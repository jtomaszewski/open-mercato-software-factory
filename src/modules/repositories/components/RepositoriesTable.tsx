"use client"
import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Inbox, Plus } from 'lucide-react'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

export type RepositoryRow = {
  id: string
  fullName: string
  baseBranch: string
  status: 'active' | 'disabled'
  updatedAt: string
}

type RepositoryPage = { items: RepositoryRow[]; total: number; totalPages: number }

export function RepositoriesTable() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [items, setItems] = React.useState<RepositoryRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reload, setReload] = React.useState(0)
  const { runMutation } = useGuardedMutation({ contextId: 'repositories:list' })
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: '20' })
      if (search.trim()) params.set('search', search.trim())
      const call = await apiCall<RepositoryPage>(`/api/repositories?${params.toString()}`, undefined, { fallback: { items: [], total: 0, totalPages: 1 } })
      if (!cancelled) {
        if (!call.ok || !call.result) setError(t('repositories.list.loadError'))
        else {
          setItems(call.result.items)
          setTotal(call.result.total)
          setTotalPages(call.result.totalPages)
        }
        setIsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [page, reload, scopeVersion, search, t])

  const connect = React.useCallback(async () => {
    try {
      const call = await runMutation({
        context: { entityId: 'repositories:connection', operation: 'create' },
        mutationPayload: {},
        operation: () => apiCallOrThrow<{ redirectUrl: string }>('/api/repositories/connections/start', { method: 'POST' }),
      })
      if (call.result?.redirectUrl) window.location.assign(call.result.redirectUrl)
    } catch {
      flash(t('repositories.connect.startError'), 'error')
    }
  }, [runMutation, t])

  const mutate = React.useCallback(async (row: RepositoryRow, action: 'disable' | 'enable' | 'remove') => {
    if (action === 'remove' && !await confirm({ title: t('repositories.list.confirmRemove'), variant: 'destructive' })) return
    const method = action === 'remove' ? 'DELETE' : 'POST'
    const path = action === 'remove'
      ? `/api/repositories/${encodeURIComponent(row.id)}`
      : `/api/repositories/${encodeURIComponent(row.id)}/${action}`
    try {
      await runMutation({
        context: { entityId: 'repositories:repository', recordId: row.id, operation: action },
        mutationPayload: { id: row.id, updatedAt: row.updatedAt },
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () => apiCallOrThrow(path, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ updatedAt: row.updatedAt }),
        })),
      })
      flash(t(`repositories.list.success.${action}`), 'success')
      setReload((value) => value + 1)
    } catch {
      flash(t(`repositories.list.error.${action}`), 'error')
    }
  }, [confirm, runMutation, t])

  const columns = React.useMemo<ColumnDef<RepositoryRow>[]>(() => [
    { accessorKey: 'fullName', header: t('repositories.list.columns.repository') },
    { accessorKey: 'baseBranch', header: t('repositories.list.columns.branch') },
    { accessorKey: 'status', header: t('repositories.list.columns.status'), cell: ({ row }) => <StatusBadge variant={row.original.status === 'active' ? 'success' : 'warning'}>{t(`repositories.status.${row.original.status}`)}</StatusBadge> },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('repositories.list.title')}
          titleHeadingLevel={1}
          columns={columns}
          data={items}
          entityId="repositories:repository"
          extensionTableId="repositories.repositories"
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('repositories.list.search')}
          actions={<div className="flex flex-wrap gap-2">
            <Button asChild type="button" variant="outline"><Link href="/backend/repositories/connect-existing">{t('repositories.actions.connectExisting')}</Link></Button>
            <Button type="button" onClick={() => { void connect() }}>{t('repositories.actions.connect')}</Button>
          </div>}
          rowActions={(row) => <RowActions items={[
            { id: 'repositories.repository.edit', label: t('repositories.actions.edit'), href: `/backend/repositories/${row.id}` },
            row.status === 'active'
              ? { id: 'repositories.repository.disable', label: t('repositories.actions.disable'), onSelect: () => { void mutate(row, 'disable') } }
              : { id: 'repositories.repository.enable', label: t('repositories.actions.enable'), onSelect: () => { void mutate(row, 'enable') } },
            { id: 'repositories.repository.remove', label: t('repositories.actions.remove'), destructive: true, onSelect: () => { void mutate(row, 'remove') } },
          ]} />}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          error={error}
          emptyState={
            // Both doors, not just the first one. "Connect GitHub" opens the App's *install* page,
            // which is a dead end once the App is already installed: GitHub shows the configure
            // screen instead of an OAuth consent, so no code comes back. The toolbar offers the
            // existing-installation path, but the toolbar is not what an operator reads when the
            // list is empty — and an empty list is exactly when the App is most likely installed
            // already (a reset drops our rows; GitHub keeps the installation).
            <EmptyState
              variant="subtle"
              size="lg"
              icon={<Inbox className="size-7" aria-hidden />}
              title={t('repositories.list.empty.title')}
              description={t('repositories.list.empty.description')}
              actions={<div className="flex flex-wrap items-center justify-center gap-2">
                <Button type="button" onClick={() => { void connect() }}>
                  <Plus className="size-4" aria-hidden />
                  {t('repositories.actions.connect')}
                </Button>
                <Button asChild type="button" variant="outline">
                  <Link href="/backend/repositories/connect-existing">{t('repositories.actions.connectExisting')}</Link>
                </Button>
              </div>}
            />
          }
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
