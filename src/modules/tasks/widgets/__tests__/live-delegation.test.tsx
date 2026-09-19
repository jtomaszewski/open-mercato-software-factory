/** @jest-environment jsdom */
import { beforeEach, expect, it, jest } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { useTaskDelegation } from '../use-task-delegation'
import { loadTaskDelegation } from '../delegation-loader'
import type { TasksDelegationReadItem } from '../../lib/delegationService'
jest.mock('../delegation-loader', () => ({ loadTaskDelegation: jest.fn() }))
const load = jest.mocked(loadTaskDelegation)

function item(runState: 'starting' | 'running'): TasksDelegationReadItem {
  return { taskId: 'task', taskUpdatedAt: 'version', delegation: { id: 'delegation', delegateUserId: 'agent', delegateName: 'Developer', releasedAt: null, updatedAt: 'version', processInstanceId: null, links: [], outcome: null, closeReason: null, runState } }
}
beforeEach(() => { load.mockReset() })

it('changes starting to running after a link broadcast without remounting', async () => {
  load.mockResolvedValueOnce(item('starting')).mockResolvedValueOnce(item('running'))
  const { result } = renderHook(() => useTaskDelegation('task'))
  await waitFor(() => expect(result.current.item?.delegation?.runState).toBe('starting'))
  act(() => { window.dispatchEvent(new CustomEvent('om:event', { detail: { id: 'tasks.task.linked', payload: { taskId: 'task' }, organizationId: 'org', timestamp: Date.now() } })) })
  await waitFor(() => expect(result.current.item?.delegation?.runState).toBe('running'))
  expect(load).toHaveBeenCalledTimes(2)
})

it('ignores a response captured before an organization change', async () => {
  let resolveOld!: (value: TasksDelegationReadItem | null) => void
  load.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve })).mockResolvedValueOnce(null)
  const { result } = renderHook(() => useTaskDelegation('task'))
  act(() => { emitOrganizationScopeChanged({ tenantId: 'other-tenant', organizationId: 'other-org' }) })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { resolveOld(item('running')); await Promise.resolve() })
  expect(result.current.item).toBeNull()
})
