import { describe, expect, it, jest } from '@jest/globals'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { aiTools } from '../ai-tools'

const projectId = '20000000-0000-4000-8000-000000000001'
const taskId = '20000000-0000-4000-8000-000000000002'
function fixture(allowed = true, canView = true) {
  const access = jest.fn(async (_options: unknown) => ({ canManageAll: false, projectIds: allowed ? [projectId] : [] }))
  const query = jest.fn(async (_entity: string, _options: unknown) => ({ items: [{ id: taskId, time_project_id: projectId, title: 'Scoped task' }], total: 1 }))
  const context = {
    tenantId: 'tenant', organizationId: 'org', userId: 'user', userFeatures: ['tasks.view'], isSuperAdmin: false,
    container: { resolve: (name: string) => {
      if (name === 'queryEngine') return { query }
      if (name === 'rbacService') return { userHasAllFeatures: async (_user: string, features: string[]) => canView && features[0] === 'tasks.view' }
      if (name === 'timeTrackingAccessResolver') return { resolveProjectAccess: access }
      if (name === 'moduleConfigService') return { getRecord: async (_module: string, key: string) => key === 'access.assignmentGraceDays' ? { value: 0 } : null }
      if (name === 'tasksDelegationService') return { getDelegations: async () => [{ taskId, delegation: null }] }
      if (name === 'em') return {}
      throw new Error(name)
    } },
  } as unknown as McpToolContext
  return { context, query, access }
}
const get = () => aiTools.find((tool) => tool.name === 'tasks_get')!
const search = () => aiTools.find((tool) => tool.name === 'tasks_search')!

describe('tasks read-only tools', () => {
  it('rejects absent organization scope before any query', async () => {
    const { context, query } = fixture()
    await expect(get().handler({ taskId }, { ...context, organizationId: null })).rejects.toMatchObject({ status: 403 })
    expect(query).not.toHaveBeenCalled()
  })
  it('refuses a project the caller cannot access before search', async () => {
    const { context, query } = fixture(false)
    await expect(search().handler({ projectId }, context)).resolves.toEqual({ items: [], total: 0 })
    expect(query).not.toHaveBeenCalled()
  })
  it('returns no task detail or comments from an inaccessible project', async () => {
    const { context, query } = fixture(false)
    await expect(get().handler({ taskId }, context)).resolves.toBeNull()
    expect(query).toHaveBeenCalledTimes(1)
  })
  it('rechecks permissions even when invoked directly with claimed features', async () => {
    const { context, query } = fixture(true, false)
    await expect(get().handler({ taskId }, context)).rejects.toMatchObject({ status: 403 })
    expect(query).not.toHaveBeenCalled()
  })
  it('rejects ambiguous task identity before reading any records', async () => {
    const { context, query } = fixture()
    await expect(get().handler({ taskId, reference: 'DEMO-1' }, context)).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })
  it('loads comments only after project authorization and bounds their count', async () => {
    const { context, query } = fixture()
    const result = await get().handler({ taskId }, context)
    expect(result).toMatchObject({ task: { id: taskId }, delegation: null })
    expect(query).toHaveBeenLastCalledWith('staff:staff_time_task_comment', expect.objectContaining({
      tenantId: 'tenant', organizationId: 'org', filters: { task_id: taskId, deleted_at: null }, page: { page: 1, pageSize: 100 },
    }))
  })
  it('passes the configured zero-day assignment grace to the staff access resolver', async () => {
    const { context, access } = fixture()
    await search().handler({ projectId }, context)
    expect(access).toHaveBeenCalledWith(expect.objectContaining({ assignmentGraceDays: 0 }))
  })
  it('bounds searches and passes trusted tenant and organization scope', async () => {
    const { context, query } = fixture()
    await search().handler({ projectId, query: 'pricing' }, context)
    expect(query).toHaveBeenCalledWith('staff:staff_time_task', expect.objectContaining({
      tenantId: 'tenant', organizationId: 'org', page: { page: 1, pageSize: 50 },
      filters: expect.objectContaining({ time_project_id: projectId, deleted_at: null }),
    }))
    expect(aiTools.every((tool) => tool.isMutation === false)).toBe(true)
  })
})
