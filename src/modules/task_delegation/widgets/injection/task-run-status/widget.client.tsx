'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { APP_EVENT_DOM_NAME } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import type { TaskDelegationAgentDto } from '../../../lib/delegationService'
import {
  availableRunBarActions,
  resolveRunBarState,
  runElapsedMinutes,
  type RunBarAction,
  type RunBarState,
} from '../../../lib/runPresentation'
import { useTaskDelegation } from '../../use-task-delegation'

/** How the bar's tone follows its state. */
const STATUS: Record<RunBarState, 'information' | 'warning' | 'success' | 'error'> = {
  none: 'information',
  starting: 'information',
  stalled: 'warning',
  running: 'information',
  awaiting_decision: 'warning',
  complete: 'information',
  published: 'success',
  failedConfig: 'warning',
  failedAgent: 'error',
  rejected: 'information',
}

/** i18n key stems, so the copy for a state lives in one place instead of a switch per string. */
const COPY: Record<RunBarState, string> = {
  none: 'task_delegation.runBar.none',
  starting: 'task_delegation.runBar.starting',
  stalled: 'task_delegation.runBar.stalled',
  running: 'task_delegation.runBar.running',
  awaiting_decision: 'task_delegation.runBar.awaiting_decision',
  complete: 'task_delegation.runBar.complete',
  published: 'task_delegation.runBar.published',
  failedConfig: 'task_delegation.runBar.failedConfig',
  failedAgent: 'task_delegation.runBar.failedAgent',
  rejected: 'task_delegation.runBar.rejected',
}

const ACTION_LABEL: Record<RunBarAction, string> = {
  delegate: 'task_delegation.runBar.actions.delegate',
  retry: 'task_delegation.runBar.actions.retry',
  takeOver: 'task_delegation.runBar.actions.takeOver',
  caseload: 'task_delegation.runBar.actions.caseload',
  changeDetail: 'task_delegation.runBar.actions.changeDetail',
}

/** A link we render is either an in-app backend path or an http(s) URL — nothing else. */
function safeLink(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (value.startsWith('/backend/')) return value
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined } catch { return undefined }
}

/** Re-renders while a run is going so "Pracuje · 12 min" keeps counting without a refetch. */
function useMinuteTick(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/**
 * One bar under the "Assigned to" picker that says what is happening with the task and offers the
 * one thing to do about it, for every run state — the business owner's whole read of a delegated
 * task (discovery prototype `.ai/prototypes/discovery/task-drawer/revision-001`, D-3).
 *
 * What it deliberately does not do: approve or reject the agent's plan inline (that stays a link to
 * the orchestrator's Caseload), and approve or preview the website change — the `code_changes` module
 * owns those and renders its own panel directly below this one. It also shows no run internals:
 * the pull request, the process and the agent run live on the change's own page, which is where
 * the bar sends an owner who wants to look.
 */
export default function TaskRunStatus({ context }: { context?: { taskId?: string } }) {
  const t = useT()
  const { payload } = useBackendChrome()
  const taskId = context?.taskId
  const canDelegate = hasFeature(payload?.grantedFeatures, 'task_delegation.delegate')
  const { item, loading, error, refresh } = useTaskDelegation(taskId)
  const [saving, setSaving] = React.useState(false)
  const [mutationError, setMutationError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'task_delegation.runBar',
    blockedMessage: t('task_delegation.errors.blocked'),
  })

  const delegation = item?.delegation ?? null
  const state = resolveRunBarState(delegation)
  const now = useMinuteTick(state === 'running')

  if (!taskId) return null
  if (loading && !item) return <Skeleton shape="text" className="h-12 w-full" aria-label={t('task_delegation.loading')} />
  if (error) return <ErrorMessage label={t('task_delegation.errors.load')} />
  if (state === 'none') return null

  const hasActiveDelegation = Boolean(delegation && !delegation.releasedAt)
  const caseloadUrl = safeLink(delegation?.links.find((link) => link.kind === 'caseload')?.url)
  const changeUrl = safeLink(delegation?.links.find((link) => link.kind === 'change')?.url)
  const actions = availableRunBarActions({ state, hasActiveDelegation, canDelegate, hasChangeLink: Boolean(changeUrl) })

  function announceTaskMoved() {
    // Assigning and removing an agent moves the card between columns server-side; staff's board
    // refetches on its own status-changed app event.
    window.dispatchEvent(new CustomEvent<AppEventPayload>(APP_EVENT_DOM_NAME, {
      detail: { id: 'staff.timesheets.time_task.status_changed', payload: { taskId }, timestamp: Date.now(), organizationId: payload?.currentOrganization?.id ?? '' },
    }))
  }

  /**
   * One write path for both actions. The guarded mutation hands `mutationPayload` to the UMES
   * mutation guards, so it has to be what is actually sent — which is why the agent is resolved
   * before the mutation runs, not inside its operation.
   */
  async function runWrite(prepare: () => Promise<{ payload: Record<string, unknown>; operation: () => Promise<unknown> }>) {
    if (!item || saving) return
    setSaving(true)
    setMutationError(null)
    try {
      const { payload, operation } = await prepare()
      await runMutation({ context: { taskId, retryLastMutation }, mutationPayload: payload, operation })
      refresh()
      announceTaskMoved()
    } catch (failure) {
      setMutationError(failure instanceof Error && failure.message ? failure.message : t('task_delegation.errors.mutation'))
    } finally { setSaving(false) }
  }

  /**
   * Handing the task over and retrying are the same write — the existing assign command with an
   * agent — because a failed or rejected run has already released its delegation. A retry reuses
   * the agent that ran; a first delegation asks the agents endpoint which agent is on offer.
   */
  async function delegateToAgent() {
    await runWrite(async () => {
      let agentUserId = delegation?.delegateUserId
      if (!agentUserId) {
        const agents = await readApiResultOrThrow<{ items: TaskDelegationAgentDto[] }>('/api/task_delegation/agents')
        agentUserId = agents.items[0]?.userId
      }
      if (!agentUserId) throw new Error(t('task_delegation.errors.noAgentAvailable', 'No agent is ready to take the task.'))
      const payload = { taskId, agentUserId }
      return {
        payload,
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(item!.taskUpdatedAt), () => apiCallOrThrow('/api/task_delegation/assignments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })),
      }
    })
  }

  async function takeOver() {
    await runWrite(async () => ({
      payload: { taskId },
      operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(item!.taskUpdatedAt),
        () => apiCallOrThrow(`/api/task_delegation/delegations/${taskId}`, { method: 'DELETE' })),
    }))
  }

  const reason = delegation?.closeReason?.trim() || null
  const head = t(`${COPY[state]}.head`, undefined, state === 'running' && delegation
    ? { minutes: runElapsedMinutes(delegation, now) }
    : undefined)
  let body: string
  if ((state === 'failedAgent' || state === 'rejected') && !reason) body = t(`${COPY[state]}.noReason`)
  else body = t(`${COPY[state]}.text`, undefined, reason ? { reason } : undefined)

  return <section className="space-y-2" data-testid="task-run-status" data-run-state={state}>
    <Alert
      status={STATUS[state]}
      size="default"
      aria-label={t('task_delegation.runBar.title', 'Task state')}
      footer={actions.length || mutationError ? <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((action, index) => {
            const label = saving ? t('task_delegation.runBar.actions.working') : t(ACTION_LABEL[action])
            if (action === 'caseload') {
              return caseloadUrl
                ? <a key={action} className="text-sm text-primary underline" href={caseloadUrl} data-testid="task-run-status-caseload">{t(ACTION_LABEL[action])}</a>
                : null
            }
            if (action === 'changeDetail') {
              return changeUrl
                ? <Button key={action} asChild size="sm" variant={index === 0 ? 'default' : 'outline'} data-testid="task-run-status-changeDetail">
                  <a href={changeUrl}>{t(ACTION_LABEL[action])}</a>
                </Button>
                : null
            }
            return <Button
              key={action}
              size="sm"
              variant={index === 0 ? 'default' : 'outline'}
              disabled={saving}
              data-testid={`task-run-status-${action}`}
              onClick={() => { void (action === 'takeOver' ? takeOver() : delegateToAgent()) }}
            >{label}</Button>
          })}
        </div>
        {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError}</p> : null}
      </div> : null}
    >
      <AlertTitle>{head}</AlertTitle>
      <AlertDescription>{body}</AlertDescription>
    </Alert>

  </section>
}
