/** @jest-environment jsdom */
import * as React from 'react'
import { beforeEach, expect, it, jest } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import TaskDelegateSidebar from '../injection/task-delegate-sidebar/widget.client'

const mockRefresh = jest.fn()
let mockActive = true
let mockLoading = false
let mockError = false
const mockItem = {
  taskId: '11111111-1111-4111-8111-111111111111', taskUpdatedAt: '2026-09-19T10:00:00.000Z',
  assigneeStaffMemberId: null, assigneeName: null,
  delegation: { id: 'delegation', delegateUserId: 'agent', delegateName: 'Software Engineer', releasedAt: null, updatedAt: 'version', processInstanceId: null, outcome: null, closeReason: null, runState: 'running', links: [{ kind: 'pr', ref: '#7', url: 'https://example.test/pr/7', addedAt: '2026-09-19T10:00:00.000Z' }] },
}
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string) => key }))
jest.mock('../use-task-delegation', () => ({
  useTaskDelegation: () => ({
    item: mockLoading ? null : { ...mockItem, delegation: mockActive ? mockItem.delegation : null },
    loading: mockLoading, error: mockError, refresh: mockRefresh,
  }),
}))

beforeEach(() => {
  mockActive = true
  mockLoading = false
  mockError = false
  mockRefresh.mockClear()
})

it('reports what the run produced without offering a second assignment control', () => {
  render(<TaskDelegateSidebar context={{ taskId: mockItem.taskId }} />)
  expect(screen.getByText('Software Engineer')).toBeInTheDocument()
  expect(screen.getByText('task_delegation.runState.running')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'task_delegation.links.pr' })).toHaveAttribute('href', 'https://example.test/pr/7')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
})

it('says the task has no delegate rather than rendering an empty section', () => {
  mockActive = false
  render(<TaskDelegateSidebar context={{ taskId: mockItem.taskId }} />)
  expect(screen.getByText('task_delegation.delegate.none')).toBeInTheDocument()
})

it('shows loading before the first read and an error when it fails', () => {
  mockLoading = true
  const { unmount } = render(<TaskDelegateSidebar context={{ taskId: mockItem.taskId }} />)
  expect(screen.getByText('task_delegation.loading')).toBeInTheDocument()
  unmount()
  mockLoading = false
  mockError = true
  render(<TaskDelegateSidebar context={{ taskId: mockItem.taskId }} />)
  // `ErrorMessage` humanizes the label it is given, so match the rendered wording, not the key.
  expect(screen.getByText(/errors\s*load/i)).toBeInTheDocument()
})
