'use client'
import * as React from 'react'
import { Check } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { APP_EVENT_DOM_NAME } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import type { TaskAssignablePersonDto, TaskDelegationAgentDto } from '../lib/delegationService'
import { useTaskDelegation } from '../widgets/use-task-delegation'

export type AssignedToPickerProps = {
  taskId: string
  /** The drawer's labelled row, or the board card's compact chip. */
  variant?: 'drawer' | 'card'
  /** Opens on `A` when the surface hosting the picker owns a single task. */
  keyboardShortcut?: boolean
}

type Draft = { assigneeStaffMemberId: string | null; agentUserId: string | null }
type Option = { kind: 'person' | 'agent'; id: string; label: string; description?: string }

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.closest !== 'function') return false
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}

/**
 * One "Assigned to" control for the human owner and the agent delegate.
 *
 * Its value is the pair `{ assigneeStaffMemberId, agentUserId }`: Space (or a click) takes an
 * option into the draft, `Enter` assigns whatever the draft holds through one
 * `task_delegation.task.assign` command, and `Esc` closes without writing. A section the caller
 * may not use is hidden rather than disabled, and an agent picked without a human states who will
 * be recorded as the accountable owner before the write, not after it.
 */
export function AssignedToPicker({ taskId, variant = 'drawer', keyboardShortcut = false }: AssignedToPickerProps) {
  const t = useT()
  const { payload } = useBackendChrome()
  const canDelegate = hasFeature(payload?.grantedFeatures, 'task_delegation.delegate')
  const { item, loading, error, refresh } = useTaskDelegation(taskId)
  const delegation = item?.delegation ?? null
  const activeDelegation = delegation && !delegation.releasedAt ? delegation : null
  const decisionPending = activeDelegation?.runState === 'awaiting_decision'
  const caseloadLink = activeDelegation?.links.find((link) => link.kind === 'caseload') ?? null

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [people, setPeople] = React.useState<TaskAssignablePersonDto[] | null>(null)
  const [agents, setAgents] = React.useState<TaskDelegationAgentDto[] | null>(null)
  const [optionsError, setOptionsError] = React.useState(false)
  const [agentsError, setAgentsError] = React.useState(false)
  const [draft, setDraft] = React.useState<Draft>({ assigneeStaffMemberId: null, agentUserId: null })
  const [highlighted, setHighlighted] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [mutationError, setMutationError] = React.useState<string | null>(null)
  const [conflict, setConflict] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'task_delegation.assign',
    blockedMessage: t('task_delegation.errors.blocked'),
  })

  React.useEffect(() => {
    if (!open) return
    setDraft({ assigneeStaffMemberId: item?.assigneeStaffMemberId ?? null, agentUserId: activeDelegation?.delegateUserId ?? null })
    setQuery('')
    setHighlighted(0)
    setMutationError(null)
    setConflict(false)
  }, [open, item?.assigneeStaffMemberId, activeDelegation?.delegateUserId])

  React.useEffect(() => {
    if (!open) return
    let current = true
    setOptionsError(false)
    setAgentsError(false)
    void readApiResultOrThrow<{ items: TaskAssignablePersonDto[] }>(`/api/task_delegation/assignable-people?taskId=${encodeURIComponent(taskId)}`)
      .then((value) => { if (current) setPeople(value.items) }, () => { if (current) setOptionsError(true) })
    if (canDelegate && !activeDelegation) {
      void readApiResultOrThrow<{ items: TaskDelegationAgentDto[] }>('/api/task_delegation/agents')
        .then((value) => { if (current) setAgents(value.items) }, () => { if (current) { setAgents([]); setAgentsError(true) } })
    }
    return () => { current = false }
  }, [open, taskId, canDelegate, activeDelegation, payload?.currentOrganization?.id])

  React.useEffect(() => {
    if (!keyboardShortcut) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'a' && event.key !== 'A') return
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboardShortcut])

  const needle = query.trim().toLowerCase()
  const matches = React.useCallback((value: string) => !needle || value.toLowerCase().includes(needle), [needle])
  const peopleOptions: Option[] = (people ?? []).filter((person) => matches(person.name))
    .map((person) => ({ kind: 'person' as const, id: person.staffMemberId, label: person.name }))
  const agentOptions: Option[] = canDelegate && !activeDelegation
    ? (agents ?? []).filter((agent) => matches(agent.label) || matches(agent.name))
      .map((agent) => ({ kind: 'agent' as const, id: agent.userId, label: agent.label, description: agent.description }))
    : []
  const options = [...peopleOptions, ...agentOptions]
  const optionsLoading = people === null || (canDelegate && !activeDelegation && agents === null)

  const currentAgentLabel = activeDelegation?.delegateName ?? null
  const triggerLabel = [item?.assigneeName, currentAgentLabel].filter(Boolean).join(' · ')
    || t('task_delegation.assign.unassigned', 'Unassigned')

  function toggle(option: Option) {
    setDraft((previous) => option.kind === 'person'
      ? { ...previous, assigneeStaffMemberId: previous.assigneeStaffMemberId === option.id ? null : option.id }
      : { ...previous, agentUserId: previous.agentUserId === option.id ? null : option.id })
  }

  const draftAgentWithoutHuman = Boolean(draft.agentUserId) && !draft.assigneeStaffMemberId

  function announceTaskMoved() {
    // Assignment moves the card between columns server-side; the staff board refetches on its own
    // status-changed app event, so announce the move locally instead of waiting for the SSE echo.
    window.dispatchEvent(new CustomEvent<AppEventPayload>(APP_EVENT_DOM_NAME, {
      detail: { id: 'staff.timesheets.time_task.status_changed', payload: { taskId }, timestamp: Date.now(), organizationId: payload?.currentOrganization?.id ?? '' },
    }))
  }

  async function apply() {
    if (!item || saving) return
    const body: Record<string, unknown> = { taskId }
    if (draft.assigneeStaffMemberId !== (item.assigneeStaffMemberId ?? null)) body.assigneeStaffMemberId = draft.assigneeStaffMemberId
    if (draft.agentUserId && draft.agentUserId !== (activeDelegation?.delegateUserId ?? null)) body.agentUserId = draft.agentUserId
    if (Object.keys(body).length === 1) { setOpen(false); return }
    setSaving(true)
    setMutationError(null)
    setConflict(false)
    try {
      await runMutation({
        context: { taskId, retryLastMutation },
        mutationPayload: body,
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(item.taskUpdatedAt), () => apiCallOrThrow('/api/task_delegation/assignments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })),
      })
      refresh()
      announceTaskMoved()
      setOpen(false)
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : t('task_delegation.errors.mutation')
      setConflict(/409|conflict|stale/i.test(message))
      setMutationError(message)
    } finally { setSaving(false) }
  }

  async function removeDelegate() {
    if (!item || saving) return
    setSaving(true)
    setMutationError(null)
    try {
      await runMutation({
        context: { taskId, retryLastMutation },
        mutationPayload: { taskId },
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(item.taskUpdatedAt), () => apiCallOrThrow(`/api/task_delegation/delegations/${taskId}`, { method: 'DELETE' })),
      })
      refresh()
      announceTaskMoved()
      setOpen(false)
    } catch (failure) {
      setMutationError(failure instanceof Error ? failure.message : t('task_delegation.errors.mutation'))
    } finally { setSaving(false) }
  }

  function onListKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!options.length) return
      setHighlighted((index) => (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
      return
    }
    // The search field owns its own spaces; selecting with Space only applies to the list.
    if (event.key === ' ' && !isTypingTarget(event.target) && options[highlighted]) {
      event.preventDefault()
      toggle(options[highlighted])
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[highlighted]
      if (option && !(option.kind === 'person' ? draft.assigneeStaffMemberId === option.id : draft.agentUserId === option.id)) {
        toggle(option)
        return
      }
      void apply()
    }
  }

  if (error) return <ErrorMessage label={t('task_delegation.errors.load')} />

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button
        variant={variant === 'card' ? 'ghost' : 'outline'}
        size="sm"
        data-card-action="true"
        data-testid="assigned-to-trigger"
        disabled={loading && !item}
        aria-label={`${t('task_delegation.assign.title', 'Assigned to')}: ${triggerLabel}`}
        className="justify-start gap-2"
      >
        <Avatar label={item?.assigneeName ?? t('task_delegation.assign.unassigned', 'Unassigned')} size="xs" />
        <span className="truncate">{triggerLabel}</span>
        {/* The board card already carries the run badge through its own injected widget. */}
        {variant === 'drawer' && currentAgentLabel && activeDelegation?.runState
          ? <StatusBadge variant={activeDelegation.runState === 'failed' ? 'error' : activeDelegation.runState === 'complete' ? 'success' : 'neutral'}>
            {t(`task_delegation.runState.${activeDelegation.runState}`)}
          </StatusBadge>
          : null}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-80 p-0" onKeyDown={onListKeyDown}>
      <div className="border-b p-2">
        <SearchInput
          value={query}
          onChange={(next) => { setQuery(next); setHighlighted(0) }}
          autoFocus
          aria-label={t('task_delegation.assign.search', 'Search people and agents')}
          placeholder={t('task_delegation.assign.search', 'Search people and agents')}
        />
      </div>
      <div className="max-h-72 overflow-y-auto p-1" role="listbox" aria-multiselectable="true" aria-label={t('task_delegation.assign.title', 'Assigned to')}>
        {optionsLoading ? <div className="space-y-2 p-2">
          <Skeleton shape="text" className="h-4 w-32" />
          <Skeleton shape="text" className="h-4 w-24" />
        </div> : null}
        {optionsError ? <ErrorMessage label={t('task_delegation.errors.people', 'Could not load people.')} /> : null}
        {!optionsLoading && !optionsError ? <>
          <h4 className="px-2 py-1 text-xs font-medium text-muted-foreground">{t('task_delegation.assign.people', 'Responsible person')}</h4>
          {peopleOptions.length === 0 ? <p className="px-2 py-1 text-sm text-muted-foreground">{t('task_delegation.assign.noMatch', 'Nothing matches that search.')}</p> : null}
          {peopleOptions.map((option) => {
            const index = options.indexOf(option)
            return <OptionRow
              key={option.id}
              option={option}
              selected={draft.assigneeStaffMemberId === option.id}
              highlighted={index === highlighted}
              onSelect={() => { setHighlighted(index); toggle(option) }}
            />
          })}
          {!canDelegate
            ? <p className="px-2 py-2 text-sm text-muted-foreground">{t('task_delegation.assign.noDelegateFeature', 'Delegating to an agent needs the delegate permission.')}</p>
            : <>
              <h4 className="px-2 py-1 text-xs font-medium text-muted-foreground">{t('task_delegation.assign.agents', 'Executing agent')}</h4>
              {activeDelegation ? <div className="space-y-2 px-2 py-1" data-testid="assigned-to-agent-locked">
                <p className="text-sm">{activeDelegation.delegateName}</p>
                <p className="text-xs text-muted-foreground">
                  {decisionPending
                    ? t('task_delegation.assign.lockedDecision', 'The task is waiting on the sizing decision in the Caseload.')
                    : t('task_delegation.assign.locked', 'The run is in progress; the agent can only be removed.')}
                </p>
                {decisionPending && caseloadLink?.url
                  ? <a className="text-sm text-primary underline" href={caseloadLink.url}>{t('task_delegation.assign.caseload', 'Open the Caseload')}</a>
                  : null}
                <Button variant="outline" size="sm" disabled={saving} onClick={() => void removeDelegate()}>
                  {t('task_delegation.delegate.remove')}
                </Button>
              </div> : agentsError
                ? <ErrorMessage label={t('task_delegation.errors.agents')} />
                : agentOptions.length === 0
                ? <p className="px-2 py-1 text-sm text-muted-foreground">{t('task_delegation.delegate.noAgents')}</p>
                : agentOptions.map((option) => {
                  const index = options.indexOf(option)
                  return <OptionRow
                    key={option.id}
                    option={option}
                    selected={draft.agentUserId === option.id}
                    highlighted={index === highlighted}
                    onSelect={() => { setHighlighted(index); toggle(option) }}
                  />
                })}
            </>}
        </> : null}
      </div>
      <div className="space-y-2 border-t p-2">
        {draft.agentUserId && !activeDelegation ? <p className="text-xs text-muted-foreground">
          {t('task_delegation.assign.startsAgent', 'Saving this assignment starts the selected agent.')}
        </p> : null}
        {draftAgentWithoutHuman
          ? <p className="text-xs text-muted-foreground" data-testid="assigned-to-accountable">
            {t('task_delegation.assign.accountable', 'You will be recorded as the accountable owner.')}
          </p>
          : null}
        {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError}</p> : null}
        {conflict
          ? <Button variant="outline" size="sm" onClick={() => { refresh(); setConflict(false); setMutationError(null) }}>
            {t('task_delegation.assign.reload', 'Reload the task')}
          </Button>
          : null}
        <div className="flex flex-col items-start gap-2">
          <span className="text-xs text-muted-foreground">{t('task_delegation.assign.hint', 'Enter selects; on a selected option it saves. Esc closes.')}</span>
          <Button size="sm" className="self-end" disabled={saving || loading} onClick={() => void apply()}>
            {draft.agentUserId && !activeDelegation
              ? t('task_delegation.assign.applyAgent', 'Assign and start agent')
              : t('task_delegation.assign.apply', 'Assign')}
          </Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
}

function OptionRow({ option, selected, highlighted, onSelect }: { option: Option; selected: boolean; highlighted: boolean; onSelect: () => void }) {
  return <button
    type="button"
    role="option"
    aria-selected={selected}
    data-highlighted={highlighted || undefined}
    onClick={onSelect}
    className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${highlighted ? 'bg-accent' : ''} ${selected ? 'font-medium' : ''}`}
  >
    <Avatar label={option.label} size="xs" />
    <span className="flex flex-col">
      <span>{option.label}</span>
      {option.description ? <span className="text-xs text-muted-foreground">{option.description}</span> : null}
    </span>
    {selected ? <Check className="ml-auto size-4 shrink-0" aria-hidden="true" data-testid="assigned-to-selected" /> : null}
  </button>
}

export default AssignedToPicker
