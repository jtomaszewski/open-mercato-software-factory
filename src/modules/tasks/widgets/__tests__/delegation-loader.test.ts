import { beforeEach, expect, it, jest } from '@jest/globals'
import { loadTaskDelegation } from '../delegation-loader'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))
const request = jest.mocked(readApiResultOrThrow)

beforeEach(() => { request.mockReset() })

it('batches and deduplicates card and drawer reads in one request', async () => {
  const first = { taskId: 'first', taskUpdatedAt: 'version', delegation: null }
  const second = { taskId: 'second', taskUpdatedAt: 'version', delegation: null }
  request.mockResolvedValue({ items: [first, second] })
  const results = await Promise.all([loadTaskDelegation('first'), loadTaskDelegation('second'), loadTaskDelegation('first')])
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][0]).toBe('/api/tasks/delegations?taskIds=first%2Csecond')
  expect(results).toEqual([first, second, first])
})

it('does not retain responses across refreshes or organization changes', async () => {
  request.mockResolvedValueOnce({ items: [{ taskId: 'first', taskUpdatedAt: 'one', delegation: null }] })
  request.mockResolvedValueOnce({ items: [] })
  expect((await loadTaskDelegation('first'))?.taskUpdatedAt).toBe('one')
  expect(await loadTaskDelegation('first')).toBeNull()
  expect(request).toHaveBeenCalledTimes(2)
})

it('rejects every listener on a failed batch and permits a fresh retry', async () => {
  request.mockRejectedValueOnce(new Error('unavailable'))
  const results = await Promise.allSettled([loadTaskDelegation('first'), loadTaskDelegation('second')])
  expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
  request.mockResolvedValueOnce({ items: [] })
  expect(await loadTaskDelegation('first')).toBeNull()
})

it('splits a large board into requests of at most 100 tasks', async () => {
  request.mockResolvedValue({ items: [] })
  await Promise.all(Array.from({ length: 201 }, (_, index) => loadTaskDelegation(String(index))))
  expect(request).toHaveBeenCalledTimes(3)
  expect(request.mock.calls.every(([url]) => new URL(String(url), 'http://localhost').searchParams.get('taskIds')!.split(',').length <= 100)).toBe(true)
})
