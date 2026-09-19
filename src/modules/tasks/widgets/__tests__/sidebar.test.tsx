/** @jest-environment jsdom */
import * as React from 'react'
import { beforeEach, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TaskDelegateSidebar from '../injection/task-delegate-sidebar/widget.client'

const mockApi = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const mockHeaders = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const mockRefresh = jest.fn()
const mockRead = jest.fn<() => Promise<{ items: unknown[] }>>()
let mockActive = true
let mockFeatures = ['tasks.*']
const mockItem = {
  taskId: '11111111-1111-4111-8111-111111111111', taskUpdatedAt: '2026-09-19T10:00:00.000Z',
  delegation: { id: 'delegation', delegateUserId: 'agent', delegateName: 'Developer', releasedAt: null, updatedAt: 'version', processInstanceId: null, outcome: null, closeReason: null, runState: 'starting', links: [] },
}
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string) => key }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: { grantedFeatures: mockFeatures } }) }))
jest.mock('../use-task-delegation', () => ({ useTaskDelegation: () => ({ item: { ...mockItem, delegation: mockActive ? mockItem.delegation : null }, loading: false, error: false, refresh: mockRefresh }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => mockApi(...args),
  readApiResultOrThrow: () => mockRead(),
  withScopedApiRequestHeaders: (headers: unknown, operation: () => Promise<unknown>) => { mockHeaders(headers); return operation() },
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({ useGuardedMutation: () => ({ runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(), retryLastMutation: async () => true }) }))

beforeEach(() => {
  mockFeatures = ['tasks.*']
  mockActive = true
  mockRead.mockReset().mockResolvedValue({ items: [] })
  mockApi.mockReset().mockResolvedValue({ ok: true })
  mockHeaders.mockReset()
  mockRefresh.mockClear()
})

it('shows delegation without controls to a read-only user', () => {
  mockFeatures = ['tasks.view']
  render(<TaskDelegateSidebar context={{ taskId: mockItem.taskId }} />)
  expect(screen.getByText('Developer')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'tasks.delegate.remove' })).not.toBeInTheDocument()
})

it('sends the task version on un-delegation and refreshes after success', async () => {
  render(<TaskDelegateSidebar context={{ taskId: mockItem.taskId }} />)
  fireEvent.click(screen.getByRole('button', { name: 'tasks.delegate.remove' }))
  await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
  expect(mockApi).toHaveBeenCalledWith(`/api/tasks/delegations/${mockItem.taskId}`, { method: 'DELETE' })
  expect(mockHeaders).toHaveBeenCalledWith(expect.objectContaining({ 'x-om-ext-optimistic-lock-expected-updated-at': mockItem.taskUpdatedAt }))
})

it('keeps the delegate visible and shows a refused operation', async () => {
  mockApi.mockRejectedValueOnce(new Error('Decision already pending'))
  render(<TaskDelegateSidebar context={{ taskId: mockItem.taskId }} />)
  fireEvent.click(screen.getByRole('button', { name: 'tasks.delegate.remove' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Decision already pending')
  expect(screen.getByText('Developer')).toBeInTheDocument()
  expect(mockRefresh).not.toHaveBeenCalled()
})

it('shows loading while agent choices are pending instead of an empty picker', () => {
  mockActive = false
  mockRead.mockReturnValue(new Promise(() => {}))
  render(<TaskDelegateSidebar context={{ taskId: mockItem.taskId }} />)
  expect(screen.getByText('tasks.loading')).toBeInTheDocument()
  expect(screen.queryByText('tasks.delegate.noAgents')).not.toBeInTheDocument()
})
