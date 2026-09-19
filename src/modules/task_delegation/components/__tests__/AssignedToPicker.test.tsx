/** @jest-environment jsdom */
import * as React from 'react'
import { beforeEach, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockApi = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const mockHeaders = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const mockReadApi = jest.fn<(path: string) => Promise<unknown>>()
const mockRefresh = jest.fn()
let mockFeatures = ['task_delegation.view', 'task_delegation.delegate']
let mockDelegation: Record<string, unknown> | null = null
let mockAssignee: { id: string | null; name: string | null } = { id: null, name: null }
let mockLoading = false
let mockError = false

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const AGENT_USER = '22222222-2222-4222-8222-222222222222'

/**
 * Radix's popover — portal, focus scope and floating-ui's measurement loop — costs ~13 seconds per
 * open under jsdom, which would put the whole unit gate at minutes for one component. What this
 * suite is about is the picker's own behaviour, so the popover is stood in for by an open/closed
 * container. The real popover, its focus contract and `Esc` are exercised in a browser by
 * `.ai/qa/tests/task_delegation/TC-TASK-DELEGATION-003.spec.ts`.
 */
jest.mock('@open-mercato/ui/primitives/popover', () => {
  const react: typeof React = require('react')
  const OpenContext = react.createContext<{ open: boolean; onOpenChange: (next: boolean) => void }>({ open: false, onOpenChange: () => {} })
  return {
    Popover: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (next: boolean) => void; children: React.ReactNode }) =>
      react.createElement(OpenContext.Provider, { value: { open, onOpenChange } }, children),
    PopoverTrigger: ({ children }: { children: React.ReactElement<{ onClick?: () => void }> }) => {
      const ctx = react.useContext(OpenContext)
      return react.cloneElement(react.Children.only(children), { onClick: () => ctx.onOpenChange(!ctx.open) })
    },
    PopoverContent: ({ children, align: _align, ...rest }: { children: React.ReactNode; align?: string }) => {
      const ctx = react.useContext(OpenContext)
      return ctx.open ? react.createElement('div', rest, children) : null
    },
  }
})
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string, fallback?: string) => fallback ?? key }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: { grantedFeatures: mockFeatures, currentOrganization: { id: 'org' } } }) }))
jest.mock('../../widgets/use-task-delegation', () => ({
  useTaskDelegation: () => ({
    item: mockLoading ? null : {
      taskId: TASK_ID, taskUpdatedAt: '2026-09-19T10:00:00.000Z',
      assigneeStaffMemberId: mockAssignee.id, assigneeName: mockAssignee.name, delegation: mockDelegation,
    },
    loading: mockLoading, error: mockError, refresh: mockRefresh,
  }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => mockApi(...args),
  readApiResultOrThrow: (path: string) => mockReadApi(path),
  withScopedApiRequestHeaders: (headers: unknown, operation: () => Promise<unknown>) => { mockHeaders(headers); return operation() },
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(), retryLastMutation: async () => true }),
}))

import { AssignedToPicker } from '../AssignedToPicker'

function openPicker(props: { keyboardShortcut?: boolean } = {}) {
  render(<AssignedToPicker taskId={TASK_ID} {...props} />)
  fireEvent.click(screen.getByTestId('assigned-to-trigger'))
}

beforeEach(() => {
  mockFeatures = ['task_delegation.view', 'task_delegation.delegate']
  mockDelegation = null
  mockAssignee = { id: null, name: null }
  mockLoading = false
  mockError = false
  mockRefresh.mockClear()
  mockApi.mockReset().mockResolvedValue({ taskId: TASK_ID })
  mockHeaders.mockReset()
  mockReadApi.mockReset().mockImplementation(async (path: string) => path.includes('assignable-people')
    ? { items: [{ staffMemberId: MEMBER, name: 'Ola Nowak', userId: 'user-1' }] }
    : { items: [{ userId: AGENT_USER, agentId: 'factory', name: 'Factory', label: 'Software Engineer', description: 'Researches, plans and opens a PR' }] })
})

it('names the current value on the trigger and offers both sections when opened', async () => {
  mockAssignee = { id: MEMBER, name: 'Ola Nowak' }
  openPicker()
  expect(screen.getByTestId('assigned-to-trigger')).toHaveAttribute('aria-label', 'Assigned to: Ola Nowak')
  expect(await screen.findByRole('option', { name: /Ola Nowak/ })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: /Software Engineer/ })).toBeInTheDocument()
})

it('assigns a person and an agent through one command', async () => {
  openPicker()
  fireEvent.click(await screen.findByRole('option', { name: /Ola Nowak/ }))
  fireEvent.click(screen.getByRole('option', { name: /Software Engineer/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1))
  expect(mockApi).toHaveBeenCalledWith('/api/task_delegation/assignments', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ taskId: TASK_ID, assigneeStaffMemberId: MEMBER, agentUserId: AGENT_USER }),
  }))
  expect(mockHeaders).toHaveBeenCalledWith(expect.objectContaining({ 'x-om-ext-optimistic-lock-expected-updated-at': '2026-09-19T10:00:00.000Z' }))
  expect(mockRefresh).toHaveBeenCalled()
})

it('states who becomes the accountable owner before an agent is assigned alone', async () => {
  openPicker()
  fireEvent.click(await screen.findByRole('option', { name: /Software Engineer/ }))
  expect(screen.getByTestId('assigned-to-accountable')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('option', { name: /Ola Nowak/ }))
  expect(screen.queryByTestId('assigned-to-accountable')).not.toBeInTheDocument()
})

it('hides the Agents section from a caller without the delegate permission', async () => {
  mockFeatures = ['task_delegation.view']
  openPicker()
  expect(await screen.findByRole('option', { name: /Ola Nowak/ })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /Software Engineer/ })).not.toBeInTheDocument()
  expect(screen.getByText('Delegating to an agent needs the delegate permission.')).toBeInTheDocument()
})

it('locks the agent half to Remove delegate while a run is live', async () => {
  mockDelegation = { id: 'delegation', delegateUserId: AGENT_USER, delegateName: 'Software Engineer', releasedAt: null, updatedAt: 'v', processInstanceId: 'process', links: [], outcome: null, closeReason: null, runState: 'running' }
  openPicker()
  const locked = await screen.findByTestId('assigned-to-agent-locked')
  expect(locked).toHaveTextContent('The run is in progress; the agent can only be removed.')
  fireEvent.click(screen.getByRole('button', { name: 'task_delegation.delegate.remove' }))
  await waitFor(() => expect(mockApi).toHaveBeenCalledWith(`/api/task_delegation/delegations/${TASK_ID}`, { method: 'DELETE' }))
})

it('points at the Caseload once the sizing decision is pending', async () => {
  mockDelegation = { id: 'delegation', delegateUserId: AGENT_USER, delegateName: 'Software Engineer', releasedAt: null, updatedAt: 'v', processInstanceId: 'process', links: [{ kind: 'caseload', ref: 'case-1', url: '/backend/caseload/case-1', addedAt: 'now' }], outcome: null, closeReason: null, runState: 'awaiting_decision' }
  openPicker()
  expect(await screen.findByTestId('assigned-to-agent-locked')).toHaveTextContent('waiting on the sizing decision')
  expect(screen.getByRole('link', { name: 'Open the Caseload' })).toHaveAttribute('href', '/backend/caseload/case-1')
})

it('offers a reload when the task changed underneath the picker', async () => {
  mockApi.mockRejectedValueOnce(new Error('409 conflict'))
  openPicker()
  fireEvent.click(await screen.findByRole('option', { name: /Ola Nowak/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('409 conflict')
  expect(screen.getByRole('button', { name: 'Reload the task' })).toBeInTheDocument()
})

it('reports a failed agent read instead of claiming there is no agent', async () => {
  mockReadApi.mockImplementation(async (path: string) => {
    if (path.includes('assignable-people')) return { items: [{ staffMemberId: MEMBER, name: 'Ola Nowak', userId: 'user-1' }] }
    throw new Error('agents unavailable')
  })
  openPicker()
  expect(await screen.findByText(/errors\s*agents/i)).toBeInTheDocument()
  expect(screen.queryByText('task_delegation.delegate.noAgents')).not.toBeInTheDocument()
})

it('lets the search field keep its own spaces', async () => {
  openPicker()
  const search = await screen.findByLabelText('Search people and agents')
  fireEvent.keyDown(search, { key: ' ' })
  expect(screen.getByRole('option', { name: /Ola Nowak/ })).toHaveAttribute('aria-selected', 'false')
})

it('says when nothing matches the search instead of showing an empty list', async () => {
  openPicker()
  await screen.findByRole('option', { name: /Ola Nowak/ })
  fireEvent.change(screen.getByLabelText('Search people and agents'), { target: { value: 'zzz' } })
  expect(screen.getByText('Nothing matches that search.')).toBeInTheDocument()
})

it('moves with the arrows, selects with Space and assigns with Enter', async () => {
  openPicker()
  const list = await screen.findByRole('listbox')
  fireEvent.keyDown(list, { key: 'ArrowDown' })
  fireEvent.keyDown(list, { key: ' ' })
  fireEvent.keyDown(list, { key: 'Enter' })
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1))
  expect(mockApi).toHaveBeenCalledWith('/api/task_delegation/assignments', expect.objectContaining({
    body: JSON.stringify({ taskId: TASK_ID, agentUserId: AGENT_USER }),
  }))
})

it('opens on A when the host surface owns a single task', async () => {
  render(<AssignedToPicker taskId={TASK_ID} keyboardShortcut />)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'a' })
  expect(await screen.findByRole('listbox')).toBeInTheDocument()
})

it('reports a failed load instead of an empty picker', () => {
  mockError = true
  render(<AssignedToPicker taskId={TASK_ID} />)
  expect(screen.getByText(/errors\s*load/i)).toBeInTheDocument()
  expect(screen.queryByTestId('assigned-to-trigger')).not.toBeInTheDocument()
})
