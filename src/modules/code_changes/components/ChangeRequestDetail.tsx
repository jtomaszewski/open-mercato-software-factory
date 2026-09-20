"use client"
import * as React from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card } from '@open-mercato/ui/primitives/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import type { TaskRunDetail } from '../../task_delegation/lib/runsQuery'
import { boardHref } from '../../task_tools/lib/staff-api'
import { CodeSectionTabs } from '@/components/CodeSectionTabs'
import type { ChangeRequestDto } from '../lib/changeRequests'
import { changeRequestChip } from '../lib/changeRequestPresentation'
import type { TaskReview } from '../lib/review'
import { buildRunTimeline, traceHref } from '../lib/runTimeline'

type Loaded = { changeRequest: ChangeRequestDto; run: TaskRunDetail | null }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 break-words text-sm">{children}</dd>
  </div>
}

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'text-muted-foreground'
  if (line.startsWith('+')) return 'bg-status-success-bg text-status-success-text'
  if (line.startsWith('-')) return 'bg-status-error-bg text-status-error-text'
  return ''
}

function FilePatch({ file }: { file: TaskReview['files'][number] }) {
  const t = useT()
  return <details className="rounded-md border border-border">
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
      : <p className="border-t border-border px-2 py-1 text-xs text-muted-foreground">{t('code_changes.review.noPatch')}</p>}
  </details>
}

/**
 * One change request, with the decision on it.
 *
 * Three things a decision needs, in the order a person needs them: what was asked for and what
 * came back (summary, checks), the decision itself, and only then the evidence — the diff and how
 * the agent got there, both folded away.
 *
 * The preview is a header button rather than a metadata field: looking at the change is the step
 * that earns the decision, so it sits with the buttons that make it, not among the facts about it.
 * The pull request link is demoted to ghost so it does not compete with the preview.
 *
 * Approve and reject are the only writes here and both re-check everything server-side; this page
 * decides what to *offer*, never what is allowed. A change request that is not `open` offers
 * neither, because a decision already happened and the page's job is then to show which one.
 */
export function ChangeRequestDetail({ id }: { id: string }) {
  const t = useT()
  const { payload } = useBackendChrome()
  const canViewTrace = hasFeature(payload?.grantedFeatures, 'agent_orchestrator.trace.view')
  const canViewProcess = hasFeature(payload?.grantedFeatures, 'agent_orchestrator.processes.view')
  const [data, setData] = React.useState<Loaded | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'notFound' | 'error'>('loading')
  const [review, setReview] = React.useState<TaskReview | null>(null)
  const [revision, setRevision] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      const call = await apiCall<Loaded>(`/api/code_changes/change-requests/${encodeURIComponent(id)}`)
      if (cancelled) return
      if (call.ok && call.result) { setData(call.result); setState('ready') }
      else setState(call.status === 404 ? 'notFound' : 'error')
    }
    void load()
    return () => { cancelled = true }
  }, [id, revision])

  // The review hits GitHub, so it loads on its own and its absence degrades to "no diff shown"
  // rather than taking the page down with it.
  React.useEffect(() => {
    const taskId = data?.changeRequest.taskId
    if (!taskId) return
    let cancelled = false
    void apiCall<{ review: TaskReview | null }>(`/api/code_changes/tasks/${encodeURIComponent(taskId)}/review`)
      .then((call) => { if (!cancelled && call.ok && call.result) setReview(call.result.review) })
    return () => { cancelled = true }
  }, [data?.changeRequest.taskId, revision])

  const timeline = React.useMemo(
    () => buildRunTimeline(data?.run, t, { canViewTrace }),
    [data?.run, t, canViewTrace],
  )

  const decide = React.useCallback(async (action: 'approve' | 'reject', body?: unknown) => {
    setSaving(true)
    try {
      await apiCallOrThrow(`/api/code_changes/change-requests/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
      flash(t(`code_changes.changeRequests.flash.${action}`), 'success')
      setRejectOpen(false)
      setReason('')
      setRevision((value) => value + 1)
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t(`code_changes.changeRequests.errors.${action}`), 'error')
    } finally {
      setSaving(false)
    }
  }, [id, t])

  if (state === 'loading') return <LoadingMessage label={t('code_changes.changeRequests.detail.loading')} />
  if (state === 'notFound') {
    return <RecordNotFoundState
      label={t('code_changes.changeRequests.detail.notFound')}
      backHref="/backend/code/changes"
      backLabel={t('code_changes.changeRequests.detail.backToList')}
    />
  }
  if (state === 'error' || !data) return <ErrorMessage label={t('code_changes.changeRequests.list.loadError')} />

  const { changeRequest, run } = data
  const chip = changeRequestChip(changeRequest.status)
  const decidable = changeRequest.status === 'open'
  const failing = (review?.checks ?? []).filter((check) => check.conclusion && !['success', 'neutral', 'skipped'].includes(check.conclusion))
  const pending = (review?.checks ?? []).filter((check) => check.status !== 'completed')
  const checksLabel = failing.length
    ? t('code_changes.review.checks.failing')
    : pending.length ? t('code_changes.review.checks.pending')
      : review?.checks.length ? t('code_changes.review.checks.passing') : t('code_changes.review.checks.none')
  const checksVariant = failing.length ? 'error' : pending.length || !review?.checks.length ? 'neutral' : 'success'
  const additions = review?.files.reduce((sum, file) => sum + file.additions, 0) ?? 0
  const deletions = review?.files.reduce((sum, file) => sum + file.deletions, 0) ?? 0
  // The newest invocation is the one a reader is asking about — what the agent is doing now, or
  // what it last did. Older ones stay reachable from their own timeline rows.
  const lastAgentRun = run?.agentRuns?.length ? run.agentRuns[run.agentRuns.length - 1] : null
  const timelineActions = [
    lastAgentRun && canViewTrace
      ? <Button key="trace" asChild size="sm" variant="ghost">
        <Link href={traceHref(lastAgentRun.id)} data-testid="change-request-open-trace">{t('code_changes.runs.detail.openTrace')}</Link>
      </Button>
      : null,
    run?.process && canViewProcess
      ? <Button key="process" asChild size="sm" variant="ghost">
        <Link href={`/backend/processes/${run.process.id}`}>{t('code_changes.runs.detail.openProcess')}</Link>
      </Button>
      : null,
  ].filter(Boolean)

  return (
    <Page>
      <CodeSectionTabs active="changes" />
      <PageHeader
        title={changeRequest.title}
        description={changeRequest.projectName ?? undefined}
        titleAction={<StatusBadge variant={chip.variant}>{t(chip.labelKey)}</StatusBadge>}
        actions={<div className="flex flex-wrap gap-2">
          {review?.previewUrl ? <Button asChild variant="secondary" data-testid="change-request-preview">
            <a href={review.previewUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              {t('code_changes.review.openPreview')}
            </a>
          </Button> : null}
          {decidable ? <>
            <Button disabled={saving} onClick={() => { void decide('approve') }}>
              {saving ? t('code_changes.changeRequests.actions.working') : t('code_changes.changeRequests.actions.approve')}
            </Button>
            <Button variant="outline" disabled={saving} onClick={() => setRejectOpen(true)}>
              {t('code_changes.changeRequests.actions.reject')}
            </Button>
          </> : null}
          {changeRequest.url ? <Button asChild variant="ghost">
            <a href={changeRequest.url} target="_blank" rel="noopener noreferrer">{t('code_changes.changeRequests.actions.openProvider')}</a>
          </Button> : null}
          <Button asChild variant="ghost">
            <Link href={boardHref(changeRequest.projectId, changeRequest.taskId)}>{t('code_changes.runs.detail.openBoard')}</Link>
          </Button>
        </div>}
      />
      <PageBody>
        {changeRequest.statusReason
          ? <Alert status={changeRequest.status === 'failed' ? 'error' : 'information'}>
            <AlertDescription>{changeRequest.statusReason}</AlertDescription>
          </Alert>
          : null}

        <Card className="gap-4 py-4">
          <div className="px-6"><SectionHeader title={t('code_changes.changeRequests.detail.summary')} /></div>
          {changeRequest.summary
            ? <p className="whitespace-pre-wrap px-6 text-sm">{changeRequest.summary}</p>
            : <p className="px-6 text-sm text-muted-foreground">{t('code_changes.changeRequests.detail.noSummary')}</p>}
          <dl className="grid grid-cols-1 gap-4 px-6 sm:grid-cols-3">
            <Field label={t('code_changes.changeRequests.list.columns.repository')}>
              <span className="font-mono text-xs">{changeRequest.repoFullName}</span>
              <span className="text-muted-foreground"> · {changeRequest.baseBranch}</span>
            </Field>
            <Field label={t('code_changes.changeRequests.detail.checks')}>
              <StatusBadge variant={checksVariant}>{checksLabel}</StatusBadge>
            </Field>
            <Field label={t('code_changes.runs.detail.changedFiles')}>
              {review
                ? <span>{review.files.length} · <span className="text-status-success-text">+{additions}</span> <span className="text-status-error-text">−{deletions}</span></span>
                : <span className="text-muted-foreground">—</span>}
            </Field>
            <Field label={t('code_changes.changeRequests.list.columns.createdAt')}>{formatDisplayDateTime(changeRequest.createdAt) ?? '—'}</Field>
            <Field label={t('code_changes.changeRequests.detail.decision')}>
              {changeRequest.decidedAt
                ? <span>{formatDisplayDateTime(changeRequest.decidedAt) ?? '—'}{changeRequest.decidedByName ? ` · ${changeRequest.decidedByName}` : ''}</span>
                : <span className="text-muted-foreground">{t('code_changes.changeRequests.detail.noDecision')}</span>}
            </Field>
          </dl>
        </Card>

        {review?.files.length ? (
          <Card className="gap-3 py-4">
            <div className="px-6"><SectionHeader title={t('code_changes.changeRequests.detail.diff')} count={review.files.length} /></div>
            <div className="space-y-1 px-6">
              {review.files.map((file) => <FilePatch key={file.filename} file={file} />)}
            </div>
          </Card>
        ) : null}

        {timeline.length ? (
          <Card className="gap-4 py-4">
            <div className="px-6">
              <SectionHeader
                title={t('code_changes.runs.detail.timeline')}
                count={timeline.length}
                action={timelineActions.length ? <div className="flex flex-wrap items-center gap-1">{timelineActions}</div> : undefined}
              />
            </div>
            <ol className="space-y-2 px-6" data-testid="change-request-timeline">
              {timeline.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border pb-2 last:border-b-0 last:pb-0">
                  <span className="w-40 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDisplayDateTime(entry.at) ?? entry.at}</span>
                  <span className="text-sm">{entry.label}</span>
                  {entry.detail ? <span className="min-w-0 break-words text-xs text-muted-foreground">{entry.detail}</span> : null}
                  {entry.href ? <Link className="text-xs text-primary underline" href={entry.href}>{entry.hrefLabel}</Link> : null}
                </li>
              ))}
            </ol>
          </Card>
        ) : null}
      </PageBody>

      <Dialog open={rejectOpen} onOpenChange={(open) => { if (!saving) setRejectOpen(open) }}>
        <DialogContent
          className="sm:max-w-md"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && reason.trim()) void decide('reject', { reason: reason.trim() })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('code_changes.changeRequests.reject.title')}</DialogTitle>
          </DialogHeader>
          <Textarea
            aria-label={t('code_changes.changeRequests.reject.label')}
            placeholder={t('code_changes.changeRequests.reject.placeholder')}
            value={reason}
            rows={4}
            onChange={(event) => setReason(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setRejectOpen(false)}>{t('code_changes.changeRequests.reject.cancel')}</Button>
            <Button
              variant="destructive"
              disabled={saving || !reason.trim()}
              onClick={() => { void decide('reject', { reason: reason.trim() }) }}
            >{saving ? t('code_changes.changeRequests.actions.working') : t('code_changes.changeRequests.actions.reject')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
