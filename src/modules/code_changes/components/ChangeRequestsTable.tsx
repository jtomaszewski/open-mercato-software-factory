"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { CodeSectionTabs } from '@/components/CodeSectionTabs'
import type { ChangeRequestDto, ChangeRequestPage } from '../lib/changeRequests'
import { CHANGE_REQUEST_STATUSES, changeRequestChip } from '../lib/changeRequestPresentation'

const PAGE_SIZE = 20
const EMPTY: ChangeRequestPage = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 }

/**
 * Every proposed change in one list, newest first.
 *
 * "Change request" rather than "pull request" on purpose: the person deciding these is the one who
 * asked for the change, not the one who wrote it, and they should not have to learn what a pull
 * request is to say yes. The provider's number is still there — as a link, for whoever wants it.
 */
export function ChangeRequestsTable() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [result, setResult] = React.useState<ChangeRequestPage>(EMPTY)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<string>('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (search.trim()) params.set('search', search.trim())
      if (status) params.set('status', status)
      const call = await apiCall<ChangeRequestPage>(`/api/code_changes/change-requests?${params.toString()}`, undefined, { fallback: EMPTY })
      if (cancelled) return
      if (!call.ok || !call.result) setError(t('code_changes.changeRequests.list.loadError'))
      else setResult(call.result)
      setIsLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [page, search, status, scopeVersion, t])

  const filters = React.useMemo<FilterDef[]>(() => [{
    id: 'status',
    label: t('code_changes.changeRequests.list.columns.status'),
    type: 'select',
    options: CHANGE_REQUEST_STATUSES.map((value) => ({ value, label: t(changeRequestChip(value).labelKey) })),
  }], [t])

  const columns = React.useMemo<ColumnDef<ChangeRequestDto>[]>(() => [
    {
      accessorKey: 'title',
      header: t('code_changes.changeRequests.list.columns.change'),
      cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
    },
    {
      id: 'status',
      header: t('code_changes.changeRequests.list.columns.status'),
      cell: ({ row }) => {
        const chip = changeRequestChip(row.original.status)
        return <span title={row.original.statusReason ?? undefined}>
          <StatusBadge variant={chip.variant}>{t(chip.labelKey)}</StatusBadge>
        </span>
      },
    },
    {
      id: 'project',
      header: t('code_changes.changeRequests.list.columns.project'),
      cell: ({ row }) => row.original.projectName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'repository',
      header: t('code_changes.changeRequests.list.columns.repository'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.repoFullName}</span>,
    },
    {
      id: 'number',
      header: t('code_changes.changeRequests.list.columns.pullRequest'),
      cell: ({ row }) => {
        const { url, number } = row.original
        if (!url || !number) return <span className="text-muted-foreground">—</span>
        return <a
          className="text-primary underline"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
        >{`#${number}`}</a>
      },
    },
    {
      id: 'createdAt',
      header: t('code_changes.changeRequests.list.columns.createdAt'),
      cell: ({ row }) => formatDisplayDateTime(row.original.createdAt) ?? '—',
    },
  ], [t])

  return (
    <Page>
      <CodeSectionTabs active="changes" />
      <PageBody>
        <DataTable
          title={t('code_changes.changeRequests.list.title')}
          titleHeadingLevel={1}
          columns={columns}
          data={result.items}
          entityId="code_changes:change_request"
          extensionTableId="code_changes.change_requests"
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('code_changes.changeRequests.list.search')}
          filters={filters}
          filterValues={status ? { status } : {}}
          onFiltersApply={(values: FilterValues) => {
            setStatus(typeof values.status === 'string' ? values.status : '')
            setPage(1)
          }}
          onFiltersClear={() => { setStatus(''); setPage(1) }}
          onRowClick={(row) => { router.push(`/backend/code/changes/${row.id}`) }}
          rowActions={(row) => <RowActions items={[
            { id: 'code_changes.change_request.open', label: t('code_changes.changeRequests.actions.open'), href: `/backend/code/changes/${row.id}` },
          ]} />}
          pagination={{ page, pageSize: PAGE_SIZE, total: result.total, totalPages: result.totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          error={error}
          emptyState={<ListEmptyState
            title={t('code_changes.changeRequests.list.empty.title')}
            description={t('code_changes.changeRequests.list.empty.description')}
          />}
        />
      </PageBody>
    </Page>
  )
}
