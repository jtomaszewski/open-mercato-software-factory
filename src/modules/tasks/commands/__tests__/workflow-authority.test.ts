import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const requireAuthority = jest.fn<() => Promise<never>>()
jest.mock('../../lib/processAuthority', () => ({
  requireProcessAuthority: () => requireAuthority(),
}))

import { createFollowupCommand, linkTaskCommand, setStatusCommand } from '../tasks'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const DELEGATION_ID = '22222222-2222-4222-8222-222222222222'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  requireAuthority.mockReset().mockRejectedValue(Object.assign(new Error('workflow principal required'), { status: 403 }))
})

describe('workflow-safe task commands', () => {
  const ctx = { transactionalEm: {}, container: {} } as unknown as CommandRuntimeContext

  it.each([
    [setStatusCommand, { taskId: TASK_ID, delegationId: DELEGATION_ID, processInstanceId: PROCESS_ID, stepId: 'status', status: 'in_progress' }],
    [linkTaskCommand, { taskId: TASK_ID, delegationId: DELEGATION_ID, processInstanceId: PROCESS_ID, stepId: 'link', kind: 'pr', ref: '123' }],
    [createFollowupCommand, { parentId: TASK_ID, delegationId: DELEGATION_ID, processInstanceId: PROCESS_ID, stepId: 'followup', title: 'Next', body: 'Body' }],
  ])('rejects a caller that is not the stored execution principal', async (command, input) => {
    const execute = command.execute as unknown as (value: unknown, context: CommandRuntimeContext) => Promise<unknown>
    await expect(execute(input, ctx)).rejects.toMatchObject({ status: 403 })
    expect(requireAuthority).toHaveBeenCalledTimes(1)
  })
})
