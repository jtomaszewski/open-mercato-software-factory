/** @jest-environment jsdom */
import * as React from 'react'
import { expect, it, jest } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import TaskDelegateBadge from '../injection/task-delegate-badge/widget.client'

type Delegation = {
  releasedAt: string | null
  outcome: 'done' | 'rejected' | 'failed' | null
  runState: string
  closeReason: null
  processInstanceId?: string | null
  startedAt?: string
}
let mockDelegation: Delegation | null = null
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')})` : key,
}))
jest.mock('../use-task-delegation', () => ({
  useTaskDelegation: () => ({ item: { taskId: 'task', delegation: mockDelegation }, loading: false, error: false, refresh: () => {} }),
}))

it('says a failed run failed, whichever half of it failed', () => {
  mockDelegation = { releasedAt: null, outcome: null, runState: 'failed', closeReason: null }
  render(<TaskDelegateBadge context={{ taskId: 'task' }} />)
  expect(screen.getByText('task_delegation.runState.failed')).toBeTruthy()
})

it('says a published change is published, not merely complete', () => {
  mockDelegation = { releasedAt: '2026-09-19T10:00:00.000Z', outcome: 'done', runState: 'complete', closeReason: null }
  render(<TaskDelegateBadge context={{ taskId: 'task' }} />)
  expect(screen.getByText('task_delegation.runState.published')).toBeTruthy()
})

it('says a change waiting for approval is waiting for approval', () => {
  mockDelegation = { releasedAt: null, outcome: null, runState: 'complete', closeReason: null }
  render(<TaskDelegateBadge context={{ taskId: 'task' }} />)
  expect(screen.getByText('task_delegation.runState.complete')).toBeTruthy()
})

it('counts the minutes of a running task into one phrase', () => {
  mockDelegation = {
    releasedAt: null, outcome: null, runState: 'running', closeReason: null,
    processInstanceId: 'process', startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  }
  render(<TaskDelegateBadge context={{ taskId: 'task' }} />)
  expect(screen.getByText('task_delegation.runState.runningWithMinutes(minutes=12)')).toBeTruthy()
})

it('shows no badge after the task was undelegated', () => {
  mockDelegation = { releasedAt: '2026-09-19T10:00:00.000Z', outcome: null, runState: 'failed', closeReason: null }
  const { container } = render(<TaskDelegateBadge context={{ taskId: 'task' }} />)
  expect(container.textContent).toBe('')
})

it('marks a rejected delegation back in Backlog as rejected, not complete', () => {
  mockDelegation = { releasedAt: '2026-09-19T10:00:00.000Z', outcome: 'rejected', runState: 'rejected', closeReason: null }
  render(<TaskDelegateBadge context={{ taskId: 'task' }} />)
  expect(screen.getByText('task_delegation.runState.rejected')).toBeTruthy()
})
