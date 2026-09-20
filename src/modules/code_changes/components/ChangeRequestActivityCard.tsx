"use client"
import * as React from 'react'
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card } from '@open-mercato/ui/primitives/card'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { agentStepKind } from '../lib/agentSteps'
import type { ChangeRequestActivity } from '../lib/activity'
import { mergeActivityFeed, type FeedRun, type FeedStep, type FeedStepState, type LiveStep } from '../lib/activityFeed'

/** How often the activity is re-read while something is still working on the change. */
const POLL_MS = 4000
/** How often the "last activity" clock re-renders while live. */
const TICK_MS = 5000
/** Silence past which a live run is reported as stalled rather than working. */
const STALL_MS = 180_000
/**
 * How many consecutive "nothing is running" reads to accept while the change request still calls
 * itself unfinished, before giving up on it. Without this an abandoned run — a worker killed
 * mid-flight leaves a record that never settles — would poll an open tab forever.
 */
const MAX_IDLE_READS = 30
/**
 * Upper bound on buffered live lines. The progress broadcast is organization-scoped, so a page
 * left open all day receives every run the organization makes, not only this change request's.
 */
const MAX_LIVE_STEPS = 300

/** The shape of an `agent_orchestrator.run.progress` broadcast. */
type RunProgressPayload = {
  runId?: string
  agentId?: string
  callId?: string
  sequence?: number
  tool?: string
  phase?: 'started' | 'finished'
  status?: 'ok' | 'error'
  label?: string | null
}

const EMPTY: ChangeRequestActivity = { active: false, stage: null, lastActivityAt: null, runs: [] }

/**
 * The activity in a response, or nothing. A body without one is not this endpoint answering, and a
 * live feed is the one thing on this page that must never be able to take the decision down with
 * it — a reader can approve a change without knowing how it was made, but not from a blank page.
 */
function readActivity(result: { activity?: ChangeRequestActivity } | null | undefined): ChangeRequestActivity | null {
  const activity = result?.activity
  return activity && Array.isArray(activity.runs) ? activity : null
}

function formatTime(value: string, locale: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(parsed)
  } catch {
    return formatDisplayDateTime(value) ?? ''
  }
}

function RunIcon({ status }: { status: FeedRun['status'] }) {
  if (status === 'running') return <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-status-info-icon" />
  if (status === 'ok') return <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-status-success-icon" />
  return <XCircle aria-hidden className="size-3.5 shrink-0 text-status-error-icon" />
}

function StepLine({ step, technical, locale }: { step: FeedStep; technical: boolean; locale: string }) {
  const t = useT()
  return (
    <li className="flex items-baseline gap-3 py-0.5">
      {step.state === 'running'
        ? <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin self-center text-status-info-icon" />
        : step.state === 'error'
          ? <XCircle aria-hidden className="size-3.5 shrink-0 self-center text-status-error-icon" />
          : <CheckCircle2 aria-hidden className="size-3.5 shrink-0 self-center text-status-success-icon" />}
      <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{formatTime(step.at, locale)}</span>
      <span className="min-w-0 flex-1 text-sm">
        {t(`code_changes.activity.kind.${step.kind}`)}
        {technical ? (
          <span className="ml-2 break-all font-mono text-xs text-muted-foreground">
            {step.tool}{step.detail ? ` · ${step.detail}` : ''}
          </span>
        ) : null}
      </span>
    </li>
  )
}

/**
 * What the agent is doing, while it does it.
 *
 * Two sources, deliberately merged rather than chosen between. The persisted trace is complete but
 * arrives only when a run ENDS — the OpenCode runtime ingests its spans in one write as the
 * session closes — so on its own this card would stay empty through exactly the minutes someone is
 * watching. `agent_orchestrator.run.progress` is broadcast per tool call as it happens, but
 * reaches only browsers that were already open and carries the tool name without its arguments. A
 * run that has a persisted trace therefore renders that (complete, ordered, with the command or
 * file); a run still in flight renders the live lines received so far, and says that is what they
 * are — claiming the first line seen was the first step taken would misrepresent the agent's work.
 */
export function ChangeRequestActivityCard({
  changeRequestId,
  expectActive,
  onSettled,
}: {
  changeRequestId: string
  /** The change request itself still calls itself unfinished — poll even before the first read. */
  expectActive: boolean
  /** Called once the run stops, so the page can re-read the record, the diff and the timeline. */
  onSettled: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const [activity, setActivity] = React.useState<ChangeRequestActivity>(EMPTY)
  const [loaded, setLoaded] = React.useState(false)
  const [live, setLive] = React.useState<LiveStep[]>([])
  const [technical, setTechnical] = React.useState(false)
  const [idleReads, setIdleReads] = React.useState(0)
  const [, tick] = React.useReducer((value: number) => value + 1, 0)
  const wasActive = React.useRef(false)
  const onSettledRef = React.useRef(onSettled)
  onSettledRef.current = onSettled

  const polling = !loaded || activity.active || (expectActive && idleReads < MAX_IDLE_READS)
  // Read through a ref rather than a dependency: whether to schedule the NEXT read is a decision
  // the loop makes when it finishes one, and making it a dependency restarts the effect — and so
  // fires an extra request — every time the answer changes.
  const pollingRef = React.useRef(polling)
  pollingRef.current = polling

  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    async function read() {
      const call = await apiCall<{ activity: ChangeRequestActivity }>(
        `/api/code_changes/change-requests/${encodeURIComponent(changeRequestId)}/activity`,
      )
      if (cancelled) return
      const next = call.ok ? readActivity(call.result) : null
      if (next) {
        setActivity(next)
        setIdleReads((previous) => (next.active ? 0 : previous + 1))
        // The run just stopped: the record, its diff and its timeline all changed with it, and
        // only the page that owns them can re-read them.
        if (wasActive.current && !next.active) onSettledRef.current()
        wasActive.current = next.active
      }
      setLoaded(true)
      if (!cancelled && pollingRef.current) timer = setTimeout(() => { void read() }, POLL_MS)
    }
    void read()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
    // `expectActive` restarts the loop when the record's own state changes under it — a run that
    // settles is worth one confirming read even after polling has stopped.
  }, [changeRequestId, expectActive])

  // Keeps the "last activity" clock honest between polls: it only re-renders.
  React.useEffect(() => {
    if (!polling) return
    const timer = setInterval(tick, TICK_MS)
    return () => clearInterval(timer)
  }, [polling])

  // Live per-tool-call progress. Org-scoped by the event bridge, so this reaches the reader even
  // though the run is driven by a workflow worker in another process.
  useAppEvent('agent_orchestrator.run.progress', (event) => {
    const payload = event.payload as RunProgressPayload | undefined
    const callId = payload?.callId
    const runId = payload?.runId
    const tool = payload?.tool
    if (!callId || !runId || !tool) return
    const state: FeedStepState = payload?.phase === 'finished'
      ? (payload.status === 'error' ? 'error' : 'done')
      : 'running'
    setLive((previous) => {
      const index = previous.findIndex((step) => step.key === callId)
      const next: LiveStep = {
        key: callId,
        runId,
        agentId: payload?.agentId ?? '',
        sequence: payload?.sequence ?? previous.length,
        kind: agentStepKind(tool),
        tool,
        detail: payload?.label ?? null,
        state,
        at: index === -1 ? new Date().toISOString() : previous[index].at,
      }
      if (index === -1) return [...previous, next].slice(-MAX_LIVE_STEPS)
      const copy = previous.slice()
      copy[index] = next
      return copy
    })
  })

  const runs = React.useMemo<FeedRun[]>(() => mergeActivityFeed(activity.runs, live), [activity.runs, live])

  const stalled = activity.active
    && activity.lastActivityAt != null
    && Date.now() - new Date(activity.lastActivityAt).getTime() > STALL_MS
    && !live.some((step) => step.state === 'running')

  // Nothing is happening and nothing ever did: the decision page is better off without an empty
  // card explaining that.
  if (!activity.active && !runs.length) return null

  return (
    <Card className="gap-3 py-4" data-testid="change-request-activity">
      <div className="px-6">
        <SectionHeader
          className="flex-wrap gap-2"
          title={t('code_changes.activity.title')}
          action={<div className="flex flex-wrap items-center justify-end gap-2">
            {activity.active
              ? <StatusBadge variant={stalled ? 'warning' : 'info'} dot>
                {stalled ? t('code_changes.activity.stalled') : t('code_changes.activity.live')}
              </StatusBadge>
              : <StatusBadge variant="neutral">{t('code_changes.activity.finished')}</StatusBadge>}
            {/*
              No link to the process or the trace here: „Jak powstawała” already offers both, and
              offers them ACL-gated. A second, ungated copy would hand a reader without
              `agent_orchestrator.*` a link to a page they cannot open.
            */}
            <Button size="sm" variant="ghost" onClick={() => setTechnical((value) => !value)}>
              {technical ? t('code_changes.activity.hideTechnical') : t('code_changes.activity.showTechnical')}
            </Button>
          </div>}
        />
      </div>

      {activity.stage || activity.lastActivityAt ? (
        <p className="px-6 text-sm text-muted-foreground">
          {activity.stage ? <span className="text-foreground">{t(`code_changes.activity.stage.${activity.stage}`, activity.stage)}</span> : null}
          {activity.lastActivityAt ? <span>
            {activity.stage ? ' · ' : ''}
            {t('code_changes.activity.lastActivity')} {formatRelativeTime(activity.lastActivityAt, { locale, translate: t })}
          </span> : null}
        </p>
      ) : null}

      {runs.length ? (
        <div className="space-y-4 px-6">
          {runs.map((run) => (
            <div key={run.id}>
              <div className="flex flex-wrap items-center gap-2 border-b border-border pb-1">
                <RunIcon status={run.status} />
                <span className="text-sm font-medium">{t(`code_changes.activity.agent.${run.agentId}`, run.agentId)}</span>
                <span className="text-xs text-muted-foreground">{formatDisplayDateTime(run.startedAt) ?? ''}</span>
              </div>
              {run.errorMessage ? <p className="pt-1 text-xs text-status-error-text">{run.errorMessage}</p> : null}
              {run.steps.length ? (
                <>
                  <ol className="pt-1">
                    {run.steps.map((step) => <StepLine key={step.key} step={step} technical={technical} locale={locale} />)}
                  </ol>
                  {run.partial ? <p className="pt-1 text-xs text-muted-foreground">{t('code_changes.activity.partial')}</p> : null}
                </>
              ) : (
                <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                  <CircleDashed aria-hidden className="size-3.5" />
                  {t('code_changes.activity.noStepsYet')}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="px-6 text-sm text-muted-foreground">{t('code_changes.activity.waiting')}</p>
      )}
    </Card>
  )
}
