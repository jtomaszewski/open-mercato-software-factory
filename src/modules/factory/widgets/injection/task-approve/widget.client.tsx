'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { APP_EVENT_DOM_NAME, useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import type { TaskReview } from '../../../lib/review'

type ReviewFile = TaskReview['files'][number]

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'text-muted-foreground'
  if (line.startsWith('+')) return 'bg-status-success-bg text-status-success-text'
  if (line.startsWith('-')) return 'bg-status-error-bg text-status-error-text'
  return ''
}

function FilePatch({ file }: { file: ReviewFile }) {
  const t = useT()
  return <details className="rounded-md border border-border" data-testid="factory-review-file">
    <summary className="flex cursor-pointer items-center justify-between gap-2 px-2 py-1 text-xs">
      <span className="truncate font-mono">{file.filename}</span>
      <span className="shrink-0 font-mono">
        <span className="text-status-success-text">+{file.additions}</span>{' '}
        <span className="text-status-error-text">-{file.deletions}</span>
      </span>
    </summary>
    {file.patch
      ? <pre className="max-h-96 overflow-auto border-t border-border text-xs leading-5">
        {file.patch.split('\n').map((line, index) => <div key={index} className={`px-2 font-mono ${lineClass(line)}`}>{line || ' '}</div>)}
      </pre>
      : <p className="border-t border-border px-2 py-1 text-xs text-muted-foreground">{t('factory.review.noPatch')}</p>}
  </details>
}

/**
 * The website change of a delegated task (execution spec EX-P0): the Developer agent's preview,
 * its checks and „Zatwierdź i opublikuj”. The server re-checks everything before merging, so this
 * only decides what to show.
 *
 * It renders in the drawer header, right under `task_delegation`'s run-status bar: the bar says the
 * change is ready, this is where the owner looks at it and publishes it. The pull request and the
 * per-file diff stay folded away, because the business owner this drawer is for reads a preview,
 * not a patch — under their own heading rather than a second „Szczegóły techniczne”, which would
 * put two identically named collapsibles in one drawer.
 */
export default function TaskApprove({ context }: { context?: { taskId?: string } }) {
  const t = useT()
  const { payload } = useBackendChrome()
  const taskId = context?.taskId
  const [review, setReview] = React.useState<TaskReview | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const refresh = React.useCallback(() => setRevision((value) => value + 1), [])
  useAppEvent('task_delegation.task.*', refresh)

  React.useEffect(() => {
    if (!taskId) { setLoading(false); return }
    let current = true
    setLoading(true)
    setLoadError(false)
    void readApiResultOrThrow<{ review: TaskReview | null }>(`/api/factory/tasks/${taskId}/review`)
      .then((value) => { if (current) setReview(value.review) }, () => { if (current) setLoadError(true) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [taskId, revision])

  if (!taskId) return null
  if (loading && !review) return <LoadingMessage label={t('factory.review.loading')} />
  if (loadError && !review) return <ErrorMessage label={t('factory.review.errors.load')} />
  if (!review) return null

  async function approve() {
    if (!review || saving) return
    setSaving(true)
    setError(null)
    try {
      await apiCallOrThrow(`/api/factory/tasks/${review.taskId}/approve`, { method: 'POST' })
      refresh()
      // The staff board refetches on its status-changed app event.
      window.dispatchEvent(new CustomEvent<AppEventPayload>(APP_EVENT_DOM_NAME, { detail: {
        id: 'staff.timesheets.time_task.status_changed',
        payload: { taskId: review.taskId },
        timestamp: Date.now(),
        organizationId: payload?.currentOrganization?.id ?? '',
      } }))
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : t('factory.approve.errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  const failing = review.checks.filter((check) => check.conclusion && !['success', 'neutral', 'skipped'].includes(check.conclusion))
  const pending = review.checks.filter((check) => check.status !== 'completed')
  const checksLabel = failing.length ? t('factory.review.checks.failing') : pending.length ? t('factory.review.checks.pending') : review.checks.length ? t('factory.review.checks.passing') : t('factory.review.checks.none')
  const checksVariant = failing.length ? 'error' : pending.length || !review.checks.length ? 'neutral' : 'success'
  const additions = review.files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = review.files.reduce((sum, file) => sum + file.deletions, 0)

  return <section className="space-y-2" aria-label={t('factory.approve.title')} data-testid="factory-task-approve">
    <h3 className="text-sm font-medium">{t('factory.approve.title')}</h3>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {review.previewUrl ? <a className="text-primary underline" href={review.previewUrl} target="_blank" rel="noopener noreferrer" data-testid="factory-review-preview">{t('factory.review.preview')}</a> : null}
      <StatusBadge variant={checksVariant}>{checksLabel}</StatusBadge>
      {review.pr.merged ? <StatusBadge variant="success">{t('factory.review.merged')}</StatusBadge> : null}
    </div>
    <p className="text-xs text-muted-foreground">
      {t('factory.review.summary', 'Changed files: {files} · +{additions} −{deletions}')
        .replace('{files}', String(review.files.length)).replace('{additions}', String(additions)).replace('{deletions}', String(deletions))}
    </p>
    {review.delegationActive && !review.pr.merged && review.pr.state === 'open' ? <>
      <p className="text-sm text-muted-foreground">{t('factory.approve.hint')}</p>
      <Button size="sm" disabled={saving} onClick={() => void approve()}>{saving ? t('factory.approve.working') : t('factory.approve.action')}</Button>
    </> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <details className="rounded-md border border-border px-3 py-2" data-testid="factory-review-technical">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t('factory.review.technicalDetails', 'Pull request and changed files')}</summary>
      <div className="mt-2 space-y-1">
        <a className="text-sm text-primary underline" href={review.pr.url} target="_blank" rel="noopener noreferrer">{t('factory.review.pr', 'PR #{number}').replace('{number}', String(review.pr.number))}</a>
        {review.files.map((file) => <FilePatch key={file.filename} file={file} />)}
      </div>
    </details>
  </section>
}
