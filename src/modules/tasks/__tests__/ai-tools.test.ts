import { describe, expect, it, jest } from '@jest/globals'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { aiTools } from '../ai-tools'

const taskId = '20000000-0000-4000-8000-000000000002'
const delegation = { id: 'delegation', delegateUserId: 'agent', links: [] }
function fixture(visible = true) {
  const getDelegations = jest.fn(async (_ctx: CommandRuntimeContext, _ids: readonly string[]) =>
    visible ? [{ taskId, taskUpdatedAt: '2026-09-19T00:00:00.000Z', delegation }] : [])
  const context = {
    tenantId: 'tenant', organizationId: 'org', userId: 'user', userFeatures: ['tasks.view'], isSuperAdmin: false,
    container: { resolve: (name: string) => {
      if (name === 'tasksDelegationService') return { getDelegations }
      throw new Error(name)
    } },
  } as unknown as McpToolContext
  return { context, getDelegations }
}
const tool = () => aiTools.find((item) => item.name === 'tasks.get_delegation')!

describe('tasks AI tools', () => {
  it('registers only the delegation read; task reads live in task_tools', () => {
    expect(aiTools.map((item) => item.name)).toEqual(['tasks.get_delegation'])
    expect(tool()).toMatchObject({ isMutation: false, requiredFeatures: ['tasks.view'] })
  })
  it('passes the trusted context scope to the delegation service, which checks access', async () => {
    const { context, getDelegations } = fixture()
    await expect(tool().handler({ taskId }, context)).resolves.toEqual({ found: true, taskId, delegation })
    expect(getDelegations).toHaveBeenCalledWith(expect.objectContaining({
      auth: { sub: 'user', tenantId: 'tenant', orgId: 'org' }, selectedOrganizationId: 'org', organizationIds: ['org'],
    }), [taskId])
  })
  it('answers found:false for a missing or inaccessible task', async () => {
    const { context } = fixture(false)
    await expect(tool().handler({ taskId }, context)).resolves.toEqual({ found: false })
  })
  it('rejects a non-uuid task id before reading', async () => {
    const { context, getDelegations } = fixture()
    await expect(tool().handler({ taskId: 'WEB-1' }, context)).rejects.toThrow()
    expect(getDelegations).not.toHaveBeenCalled()
  })
})
