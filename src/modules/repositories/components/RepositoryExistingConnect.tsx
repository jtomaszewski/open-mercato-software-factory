"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

type ExistingConnectionValues = { installationId: string }

export function RepositoryExistingConnect() {
  const t = useT()
  const { runMutation } = useGuardedMutation({ contextId: 'repositories:connect-existing' })
  const fields = React.useMemo<CrudField[]>(() => [{
    id: 'installationId',
    label: t('repositories.form.installationId'),
    type: 'text',
    required: true,
    maxLength: 32,
    description: (
      <>
        {t('repositories.connect.existingInstallationHelp')}{' '}
        <a className="text-primary underline" href="https://github.com/settings/installations" target="_blank" rel="noopener noreferrer">
          {t('repositories.connect.installationSettings')}
        </a>
      </>
    ),
  }], [t])

  return (
    <Page>
      <PageBody className="max-w-4xl">
        <CrudForm<ExistingConnectionValues>
          title={t('repositories.connect.existingTitle')}
          titleHeadingLevel={1}
          formId="repositories.connection.connect-existing"
          entityId="repositories:connection"
          fields={fields}
          initialValues={{ installationId: '' }}
          submitLabel={t('repositories.actions.connectExisting')}
          cancelHref="/backend/repositories"
          disableOptimisticLock
          hideFooterActions
          onSubmit={async (values) => {
            const call = await runMutation({
              context: { entityId: 'repositories:connection', operation: 'create' },
              mutationPayload: { installationId: values.installationId },
              operation: () => apiCallOrThrow<{ redirectUrl: string }>('/api/repositories/connections/start', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ installationId: values.installationId }),
              }),
            })
            if (call.result?.redirectUrl) window.location.assign(call.result.redirectUrl)
          }}
        />
      </PageBody>
    </Page>
  )
}
