"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type RepositoryDetail = {
  id: string
  fullName: string
  baseBranch: string
  status: 'active' | 'disabled'
  updatedAt: string
}

type RepositoryFormValues = { id: string; fullName: string; baseBranch: string; updatedAt: string }

export function RepositoryForm({ id }: { id: string }) {
  const t = useT()
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
  ], [t])

  if (loading) return <LoadingMessage label={t('repositories.detail.loading')} />
  if (notFound) return <RecordNotFoundState label={t('repositories.detail.notFound')} />
  if (error || !repository) return <ErrorMessage label={error ?? t('repositories.detail.loadError')} />

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
          initialValues={{ id: repository.id, fullName: repository.fullName, baseBranch: repository.baseBranch, updatedAt: repository.updatedAt }}
          backHref="/backend/repositories"
          cancelHref="/backend/repositories"
          submitLabel={t('repositories.actions.save')}
          deleteVisible={repository.status === 'disabled'}
          onSubmit={async (values) => {
            const saved = await apiCallOrThrow<{ updatedAt: string }>(`/api/repositories/${encodeURIComponent(repository.id)}`, {
              method: 'PUT', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ baseBranch: values.baseBranch, updatedAt: repository.updatedAt }),
            })
            if (saved.result) setRepository({ ...repository, baseBranch: values.baseBranch, updatedAt: saved.result.updatedAt })
            flash(t('repositories.detail.saved'), 'success')
          }}
          onDelete={async () => {
            await apiCallOrThrow(`/api/repositories/${encodeURIComponent(repository.id)}`, {
              method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updatedAt: repository.updatedAt }),
            })
          }}
          deleteRedirect="/backend/repositories"
        />
      </PageBody>
    </Page>
  )
}
