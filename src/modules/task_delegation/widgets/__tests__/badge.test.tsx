/** @jest-environment jsdom */
import * as React from 'react'
import { expect, it, jest } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import TaskDelegateBadge from '../injection/task-delegate-badge/widget.client'

type Delegation = { releasedAt: string | null; outcome: 'done' | 'rejected' | 'failed' | null; runState: string; closeReason: null }
let mockDelegation: Delegation | null = null
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string) => key }))
jest.mock('../use-task-delegation', () => ({
  useTaskDelegation: () => ({ item: { taskId: 'task', delegation: mockDelegation }, loading: false, error: false, refresh: () => {} }),
}))

it('shows the run state of an active delegation', () => {
  mockDelegation = { releasedAt: null, outcome: null, runState: 'failed', closeReason: null }
  render(<TaskDelegateBadge context={{ taskId: 'task' }} />)
  expect(screen.getByText('task_delegation.runState.failed')).toBeTruthy()
})

it('keeps the outcome badge of a delegation the process closed', () => {
  mockDelegation = { releasedAt: '2026-09-19T10:00:00.000Z', outcome: 'done', runState: 'complete', closeReason: null }
  render(<TaskDelegateBadge context={{ taskId: 'task' }} />)
  expect(screen.getByText('task_delegation.runState.complete')).toBeTruthy()
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
