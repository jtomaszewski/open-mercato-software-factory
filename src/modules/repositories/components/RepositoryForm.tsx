"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type QualificationCheck = { id: string; status: 'passed' | 'failed'; message: string }
type RepositoryDetail = {
  id: string
  fullName: string
  baseBranch: string
  kind: 'pr_only' | 'static_site'
  profile: {
    version: 1
    commands: { install: string; build: string; test: string; typecheck?: string; lint?: string }
    outputDirectory?: string
    vercel?: { accountId: string; projectId: string }
  }
  qualificationStatus: 'pending' | 'running' | 'passed' | 'failed' | 'stale'
  qualificationReport: { checks: QualificationCheck[] } | null
  status: 'active' | 'disabled'
  accessStatus: 'granted' | 'unavailable'
  updatedAt: string
}

type RepositoryFormValues = {
  id: string
  fullName: string
  baseBranch: string
  kind: 'pr_only' | 'static_site'
  install: string
  build: string
  test: string
  typecheck: string
  lint: string
  outputDirectory: string
  vercelAccountId: string
  vercelProjectId: string
  updatedAt: string
}

function toValues(repository: RepositoryDetail): RepositoryFormValues {
  return {
    id: repository.id,
    fullName: repository.fullName,
    baseBranch: repository.baseBranch,
    kind: repository.kind,
    install: repository.profile.commands.install,
    build: repository.profile.commands.build,
    test: repository.profile.commands.test,
    typecheck: repository.profile.commands.typecheck ?? '',
    lint: repository.profile.commands.lint ?? '',
    outputDirectory: repository.profile.outputDirectory ?? '',
    vercelAccountId: repository.profile.vercel?.accountId ?? '',
    vercelProjectId: repository.profile.vercel?.projectId ?? '',
    updatedAt: repository.updatedAt,
  }
}

function profileFromValues(values: RepositoryFormValues): Record<string, unknown> {
  const commands = {
    install: values.install,
    build: values.build,
    test: values.test,
    ...(values.typecheck.trim() ? { typecheck: values.typecheck } : {}),
    ...(values.lint.trim() ? { lint: values.lint } : {}),
  }
  if (values.kind === 'static_site') {
    return { version: 1, commands, outputDirectory: values.outputDirectory, vercel: { accountId: values.vercelAccountId, projectId: values.vercelProjectId } }
  }
  return { version: 1, commands }
}

export function RepositoryForm({ id }: { id: string }) {
  const t = useT()
  const router = useRouter()
  const [repository, setRepository] = React.useState<RepositoryDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const value = await readApiResultOrThrow<RepositoryDetail>(`/api/repositories/${encodeURIComponent(id)}`)
        if (!cancelled) setRepository(value)
      } catch (caught) {
        const status = typeof caught === 'object' && caught !== null ? (caught as { status?: unknown }).status : null
        if (!cancelled) {
          if (status === 404) setNotFound(true)
          else setError(t('repositories.detail.loadError'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id, t])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'fullName', label: t('repositories.form.fullName'), type: 'text', disabled: true },
    { id: 'baseBranch', label: t('repositories.form.baseBranch'), type: 'text', required: true, maxLength: 255 },
    { id: 'kind', label: t('repositories.form.kind'), type: 'select', required: true, options: [
      { value: 'pr_only', label: t('repositories.kind.pr_only') },
      { value: 'static_site', label: t('repositories.kind.static_site') },
    ] },
    { id: 'install', label: t('repositories.form.commands.install'), type: 'textarea', required: true, maxLength: 2000, rows: 2 },
    { id: 'build', label: t('repositories.form.commands.build'), type: 'textarea', required: true, maxLength: 2000, rows: 2 },
    { id: 'test', label: t('repositories.form.commands.test'), type: 'textarea', required: true, maxLength: 2000, rows: 2 },
    { id: 'typecheck', label: t('repositories.form.commands.typecheck'), type: 'textarea', maxLength: 2000, rows: 2 },
    { id: 'lint', label: t('repositories.form.commands.lint'), type: 'textarea', maxLength: 2000, rows: 2 },
    { id: 'outputDirectory', label: t('repositories.form.outputDirectory'), type: 'text', required: true, visibleWhen: { field: 'kind', equals: 'static_site' } },
    { id: 'vercelAccountId', label: t('repositories.form.vercelAccountId'), type: 'text', required: true, visibleWhen: { field: 'kind', equals: 'static_site' } },
    { id: 'vercelProjectId', label: t('repositories.form.vercelProjectId'), type: 'text', required: true, visibleWhen: { field: 'kind', equals: 'static_site' } },
  ], [t])

  const checkColumns = React.useMemo<ColumnDef<QualificationCheck>[]>(() => [
    { accessorKey: 'id', header: t('repositories.detail.check') },
    { accessorKey: 'status', header: t('repositories.detail.result'), cell: ({ row }) => <StatusBadge variant={row.original.status === 'passed' ? 'success' : 'error'}>{t(`repositories.check.${row.original.status}`)}</StatusBadge> },
    { accessorKey: 'message', header: t('repositories.detail.message') },
  ], [t])

  if (loading) return <LoadingMessage label={t('repositories.detail.loading')} />
  if (notFound) return <RecordNotFoundState label={t('repositories.detail.notFound')} />
  if (error || !repository) return <ErrorMessage label={error ?? t('repositories.detail.loadError')} />
  const initialValues = toValues(repository)
  const checks = repository.qualificationReport?.checks ?? []

  return (
    <Page>
      <PageBody>
        <CrudForm<RepositoryFormValues>
          title={repository.fullName}
          titleHeadingLevel={1}
          formId="repositories.repository.edit"
          entityId="repositories:repository"
          injectionSpotId="crud-form:repositories.repository:fields"
          fields={fields}
          initialValues={initialValues}
          backHref="/backend/repositories"
          cancelHref="/backend/repositories"
          submitLabel={t('repositories.actions.save')}
          deleteVisible={repository.status === 'disabled'}
          onSubmit={async (values) => {
            await apiCallOrThrow(`/api/repositories/${encodeURIComponent(repository.id)}`, {
              method: 'PUT', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ baseBranch: values.baseBranch, kind: values.kind, profile: profileFromValues(values), updatedAt: repository.updatedAt }),
            })
            flash(t('repositories.detail.saved'), 'success')
            router.refresh()
          }}
          onDelete={async () => {
            await apiCallOrThrow(`/api/repositories/${encodeURIComponent(repository.id)}`, {
              method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updatedAt: repository.updatedAt }),
            })
          }}
          deleteRedirect="/backend/repositories"
        />
        <DataTable
          title={t('repositories.detail.qualificationReport')}
          columns={checkColumns}
          data={checks}
          extensionTableId="repositories.qualification-checks"
          emptyState={<div className="text-sm text-muted-foreground">{t('repositories.detail.noQualificationReport')}</div>}
        />
      </PageBody>
    </Page>
  )
}

export { profileFromValues }

