"use client"
import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { completeConnectionOnce } from '../lib/connection-completion'

type GrantedRepository = { id: string; fullName: string; defaultBranch: string }
type ConnectedResult = { status: 'connected'; connectionId: string; grantedRepositories: GrantedRepository[] }
type WaitingResult = { status: 'waiting' }
type CompleteResult = ConnectedResult | WaitingResult
type CurrentGrant = { installationId: string; accountLogin: string; repositories: GrantedRepository[] }
type RegisterValues = { fullName: string; baseBranch: string }

export function RepositoryConnect() {
  const t = useT()
  const query = useSearchParams()
  const [queryString] = React.useState(() => query.toString())
  const [result, setResult] = React.useState<CompleteResult | null>(null)
  const [selected, setSelected] = React.useState<GrantedRepository | null>(null)
  const [registered, setRegistered] = React.useState<Set<string>>(new Set())
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const { runMutation } = useGuardedMutation({ contextId: 'repositories:connect' })

  React.useEffect(() => {
    let cancelled = false
    async function complete() {
      const params = new URLSearchParams(queryString)
      const connectionId = params.get('connectionId')
      if (connectionId) {
        try {
          const grant = await readApiResultOrThrow<CurrentGrant>(`/api/repositories/connections/${encodeURIComponent(connectionId)}/repositories`)
          if (!cancelled) setResult({ status: 'connected', connectionId, grantedRepositories: grant.repositories })
        } catch {
          if (!cancelled) setError(t('repositories.connect.loadError'))
        } finally {
          if (!cancelled) setLoading(false)
        }
        return
      }
      const installationId = params.get('installation_id')
      const setupAction = params.get('setup_action')
      const code = params.get('code')
      const state = params.get('state')
      const hasCallbackParameters = Boolean(installationId || setupAction || code || state)
      if (hasCallbackParameters) window.history.replaceState({}, '', '/backend/repositories/connect')
      if (!state || (!code && setupAction !== 'request')) {
        setError(t('repositories.connect.invalidReturn'))
        setLoading(false)
        return
      }
      try {
        const completed = await completeConnectionOnce(state, async () => {
          const call = await runMutation({
            context: { entityId: 'repositories:connection', operation: 'complete' },
            mutationPayload: { setupAction: setupAction ?? undefined },
            operation: () => apiCallOrThrow<CompleteResult>('/api/repositories/connections/complete', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ installationId: installationId ?? undefined, setupAction: setupAction ?? undefined, code: code ?? undefined, state }),
            }),
          })
          if (!call.result) throw new Error('[internal] Repository connection completion returned no result')
          return call.result
        })
        if (!cancelled) {
          setResult(completed)
          if (completed.status === 'connected') {
            window.history.replaceState({}, '', `/backend/repositories/connect?connectionId=${encodeURIComponent(completed.connectionId)}`)
          }
        }
      } catch {
        if (!cancelled) setError(t('repositories.connect.completeError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void complete()
    return () => { cancelled = true }
  }, [queryString, runMutation, t])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'fullName', label: t('repositories.form.fullName'), type: 'text', disabled: true },
    { id: 'baseBranch', label: t('repositories.form.baseBranch'), type: 'combobox', required: true, allowCustomValues: false, loadOptions: async () => {
      if (!selected || result?.status !== 'connected') return []
      const data = await readApiResultOrThrow<{ branches: string[] }>(`/api/repositories/connections/${encodeURIComponent(result.connectionId)}/branches?githubRepositoryId=${encodeURIComponent(selected.id)}`)
      return data.branches.map((branch) => ({ value: branch, label: branch }))
    } },
  ], [result, selected, t])

  const columns = React.useMemo<ColumnDef<GrantedRepository>[]>(() => [
    { accessorKey: 'fullName', header: t('repositories.list.columns.repository') },
    { accessorKey: 'defaultBranch', header: t('repositories.list.columns.branch') },
  ], [t])

  if (loading) return <LoadingMessage label={t('repositories.connect.loading')} />
  if (error || !result) return <Page><PageBody className="space-y-4">
    <ErrorMessage label={error ?? t('repositories.connect.invalidReturn')} />
    <Link className="text-sm text-primary underline" href="/backend/repositories">{t('repositories.connect.back')}</Link>
  </PageBody></Page>
  if (result.status === 'waiting') return <Alert><AlertTitle>{t('repositories.connect.waitingTitle')}</AlertTitle><AlertDescription>{t('repositories.connect.waitingDescription')}</AlertDescription></Alert>

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('repositories.connect.title')}
          titleHeadingLevel={1}
          columns={columns}
          data={result.grantedRepositories}
          extensionTableId="repositories.granted-repositories"
          rowActions={(row) => <RowActions items={registered.has(row.id)
            ? []
            : [{ id: 'repositories.repository.configure', label: t('repositories.actions.configure'), onSelect: () => setSelected(row) }]} />}
          emptyState={<Alert><AlertTitle>{t('repositories.connect.emptyTitle')}</AlertTitle><AlertDescription>{t('repositories.connect.emptyDescription')}</AlertDescription></Alert>}
        />
        {selected ? (
          <CrudForm<RegisterValues>
            key={selected.id}
            title={t('repositories.connect.configureTitle', { repository: selected.fullName })}
            formId="repositories.repository.register"
            entityId="repositories:repository"
            fields={fields}
            initialValues={{ fullName: selected.fullName, baseBranch: selected.defaultBranch }}
            submitLabel={t('repositories.actions.register')}
            cancelHref="/backend/repositories"
            disableOptimisticLock
            onSubmit={async (values) => {
              await apiCallOrThrow('/api/repositories', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ connectionId: result.connectionId, githubRepositoryId: selected.id, baseBranch: values.baseBranch }),
              })
              setRegistered((current) => new Set([...current, selected.id]))
              setSelected(null)
              flash(t('repositories.connect.registered'), 'success')
            }}
          />
        ) : null}
      </PageBody>
    </Page>
  )
}
