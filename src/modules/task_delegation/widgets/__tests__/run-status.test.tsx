/** @jest-environment jsdom */
import * as React from 'react'
import { beforeEach, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TaskDelegationDto, TaskDelegationReadItem } from '../../lib/delegationService'
import { injectionTable } from '../injection-table'
import TaskRunStatus from '../injection/task-run-status/widget.client'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const apiCall = jest.fn<(path: string, init?: RequestInit) => Promise<unknown>>()
const readApi = jest.fn<(path: string) => Promise<unknown>>()
const refresh = jest.fn()
const guardedPayloads: Record<string, unknown>[] = []
let grantedFeatures: string[] = ['task_delegation.view', 'task_delegation.delegate']
let current: TaskDelegationReadItem | null = null

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallbackOrParams?: unknown, params?: Record<string, string | number>) => {
    const resolved = (typeof fallbackOrParams === 'object' && fallbackOrParams !== null ? fallbackOrParams : params) as Record<string, string | number> | undefined
    if (!resolved) return key
    return `${key}(${Object.entries(resolved).map(([name, value]) => `${name}=${value}`).join(',')})`
  },
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures, currentOrganization: { id: 'org' } } }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation, mutationPayload }: { operation: () => Promise<unknown>; mutationPayload: Record<string, unknown> }) => {
      guardedPayloads.push(mutationPayload)
      return operation()
    },
    retryLastMutation: jest.fn(),
  }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (path: string, init?: RequestInit) => apiCall(path, init),
  readApiResultOrThrow: (path: string) => readApi(path),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: () => ({}) }))
jest.mock('../use-task-delegation', () => ({
  useTaskDelegation: () => ({ item: current, loading: false, error: false, refresh }),
}))

function delegation(overrides: Partial<TaskDelegationDto> = {}): TaskDelegationDto {
  return {
    id: 'delegation', delegateUserId: 'agent-user', delegateName: 'Software Engineer',
    releasedAt: null, updatedAt: 'version', startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    processInstanceId: 'process', links: [], outcome: null, closeReason: null, runState: 'running',
    ...overrides,
  }
}

function show(delegationOverrides: Partial<TaskDelegationDto> | null) {
  current = {
    taskId: TASK_ID, projectId: 'project', taskUpdatedAt: 'version', assigneeStaffMemberId: 'member', assigneeName: 'Jan Kowalski',
    delegation: delegationOverrides ? delegation(delegationOverrides) : null,
  }
  return render(<TaskRunStatus context={{ taskId: TASK_ID }} />)
}

beforeEach(() => {
  apiCall.mockReset().mockResolvedValue({})
  readApi.mockReset().mockResolvedValue({ items: [{ userId: 'agent-user', agentId: 'developer', name: 'Software Engineer', label: 'Software Engineer', description: '' }] })
  refresh.mockReset()
  guardedPayloads.length = 0
  grantedFeatures = ['task_delegation.view', 'task_delegation.delegate']
})

it('sits in the drawer header under the assignment picker', () => {
  const header = injectionTable['detail:staff:staff_time_task:header']
  expect(header).toEqual([
    { widgetId: 'task_delegation.injection.task-assigned-to', priority: 30 },
    { widgetId: 'task_delegation.injection.task-run-status', priority: 20 },
  ])
})

it('does not imply a human-owned task is idle or offer another delegation action', () => {
  const { container } = show(null)
  expect(container).toBeEmptyDOMElement()
  expect(screen.queryByTestId('task-run-status-delegate')).not.toBeInTheDocument()
})

it('hides the no-run panel after an agent was removed without an outcome', () => {
  const { container } = show({ releasedAt: '2026-09-19T12:00:00.000Z', outcome: null })
  expect(container).toBeEmptyDOMElement()
})

it('does not show a permission warning for an ordinary human-owned task', () => {
  grantedFeatures = ['task_delegation.view']
  const { container } = show(null)
  expect(container).toBeEmptyDOMElement()
})

it('counts the minutes a run has been going', () => {
  show({ runState: 'running' })
  expect(screen.getByText('task_delegation.runBar.running.head(minutes=12)')).toBeInTheDocument()
  expect(screen.getByTestId('task-run-status-takeOver')).toBeInTheDocument()
})

it('announces a run that has not started and one that is starting', () => {
  const { unmount } = show({ runState: 'starting' })
  expect(screen.getByTestId('task-run-status')).toHaveAttribute('data-run-state', 'starting')
  unmount()
  show({ runState: 'stalled' })
  expect(screen.getByTestId('task-run-status')).toHaveAttribute('data-run-state', 'stalled')
})

it('sends a decision to the Caseload rather than deciding the plan in the drawer', () => {
  show({
    runState: 'awaiting_decision',
    links: [{ kind: 'caseload', ref: 'proposal-1', url: '/backend/agents/caseload', addedAt: '2026-09-19T11:55:00.000Z' }],
  })
  expect(screen.getByTestId('task-run-status-caseload')).toHaveAttribute('href', '/backend/agents/caseload')
  expect(screen.queryByTestId('task-run-status-retry')).not.toBeInTheDocument()
})

it('leaves preview and approval to the factory panel when the change is ready', () => {
  show({ runState: 'complete' })
  expect(screen.getByTestId('task-run-status')).toHaveAttribute('data-run-state', 'complete')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('reads a published change as published', () => {
  show({ runState: 'complete', outcome: 'done', releasedAt: '2026-09-19T12:00:00.000Z' })
  expect(screen.getByText('task_delegation.runBar.published.head')).toBeInTheDocument()
})

it('separates a factory that is not ready from an agent that failed', () => {
  const { unmount } = show({
    runState: 'failed', outcome: 'failed', releasedAt: '2026-09-19T12:00:00.000Z',
    processInstanceId: null, closeReason: 'FACTORY_GITHUB_TOKEN is not set; the factory cannot open pull requests.',
  })
  expect(screen.getByText('task_delegation.runBar.failedConfig.head')).toBeInTheDocument()
  // A setup problem is not the owner's to retry, and the task is already back in the backlog.
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  unmount()

  show({
    runState: 'failed', outcome: 'failed', releasedAt: '2026-09-19T12:00:00.000Z',
    closeReason: 'Nie znalazłem pliku hero-2026.jpg w katalogu zdjęć.',
  })
  expect(screen.getByText('task_delegation.runBar.failedAgent.head')).toBeInTheDocument()
  expect(screen.getByText('task_delegation.runBar.failedAgent.text(reason=Nie znalazłem pliku hero-2026.jpg w katalogu zdjęć.)')).toBeInTheDocument()
  expect(screen.getByTestId('task-run-status-retry')).toBeInTheDocument()
})

it('retries with the agent that already ran, without asking which agent to use', async () => {
  show({
    runState: 'rejected', outcome: 'rejected', releasedAt: '2026-09-19T12:00:00.000Z',
    closeReason: 'Za drogo.',
  })
  fireEvent.click(screen.getByTestId('task-run-status-retry'))
  await waitFor(() => expect(apiCall).toHaveBeenCalled())
  expect(readApi).not.toHaveBeenCalled()
  expect(JSON.parse(String((apiCall.mock.calls[0]![1] as RequestInit).body))).toEqual({ taskId: TASK_ID, agentUserId: 'agent-user' })
})

it('takes the task over by removing the agent', async () => {
  show({ runState: 'running' })
  fireEvent.click(screen.getByTestId('task-run-status-takeOver'))
  await waitFor(() => expect(apiCall).toHaveBeenCalledWith(`/api/task_delegation/delegations/${TASK_ID}`, { method: 'DELETE' }))
})

it('keeps the run’s pull request and process under collapsed technical details', () => {
  show({
    runState: 'complete',
    links: [
      { kind: 'pr', ref: '#8', url: 'https://github.test/o/r/pull/8', addedAt: '2026-09-19T11:58:00.000Z' },
      { kind: 'run', ref: 'run-11aa', url: '/backend/agents/runs/run-11aa', addedAt: '2026-09-19T11:58:00.000Z' },
    ],
  })
  const technical = screen.getByTestId('task-run-status-technical')
  expect(technical.tagName).toBe('DETAILS')
  expect(technical).not.toHaveAttribute('open')
  expect(screen.getByRole('link', { name: '#8' })).toHaveAttribute('href', 'https://github.test/o/r/pull/8')
  expect(screen.getByRole('link', { name: 'run-11aa' })).toHaveAttribute('href', '/backend/agents/runs/run-11aa')
})

it('renders nothing without a task in context', () => {
  current = null
  const { container } = render(<TaskRunStatus context={{}} />)
  expect(container).toBeEmptyDOMElement()
})
