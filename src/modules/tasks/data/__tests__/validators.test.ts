import { describe, expect, it } from '@jest/globals'
import { delegateSchema, delegationQuerySchema } from '../validators'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const AGENT_ID = '22222222-2222-4222-8222-222222222222'

describe('tasks validators', () => {
  it('accepts the delegated command contract', () => {
    expect(delegateSchema.parse({ taskId: TASK_ID, agentUserId: AGENT_ID })).toEqual({ taskId: TASK_ID, agentUserId: AGENT_ID })
  })

  it('normalizes and deduplicates at most 100 scoped task ids', () => {
    expect(delegationQuerySchema.parse({ taskIds: `${TASK_ID},${TASK_ID}` }).taskIds).toEqual([TASK_ID])
    const tooMany = Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`).join(',')
    expect(delegationQuerySchema.safeParse({ taskIds: tooMany }).success).toBe(false)
  })

  it('fails closed on malformed ids', () => {
    expect(delegationQuerySchema.safeParse({ taskIds: 'not-a-uuid' }).success).toBe(false)
  })
})
