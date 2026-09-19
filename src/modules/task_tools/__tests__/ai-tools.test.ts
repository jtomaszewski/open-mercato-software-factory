import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { createFakeStaff, PROJECT_WEB, STATUS_DONE, taskRow } from '../__fixtures__/fake-staff'

let fake = createFakeStaff()

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner', () => ({
  createAiApiOperationRunner: jest.fn(() => fake.runner),
}))

jest.mock('../lib/next-server-resolve-shim', () => ({
  installNextServerResolveShim: jest.fn(() => false),
}))

import aiTools, { PROJECTS_VIEW_FEATURE, TASKS_MANAGE_FEATURE, TASKS_VIEW_FEATURE } from '../ai-tools'
import { createAiApiOperationRunner } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'

function tool(name: string): AiToolDefinition {
  const found = aiTools.find((entry) => entry.name === `task_tools.${name}`)
  if (!found) throw new Error(`tool ${name} missing`)
  return found
}

function context(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: {} as McpToolContext['container'],
    userFeatures: [],
    isSuperAdmin: false,
    ...overrides,
  }
}

beforeEach(() => {
  fake = createFakeStaff()
  jest.mocked(createAiApiOperationRunner).mockClear()
  delete process.env.APP_URL
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe('task_tools registry contract', () => {
  it('registers exactly the five tools, writes marked as mutations', () => {
    expect(aiTools.map((entry) => entry.name).sort()).toEqual([
      'task_tools.comment_task',
      'task_tools.create_task',
      'task_tools.get_task',
      'task_tools.list_projects',
      'task_tools.search_tasks',
    ])
    const mutations = aiTools.filter((entry) => entry.isMutation).map((entry) => entry.name).sort()
    expect(mutations).toEqual(['task_tools.comment_task', 'task_tools.create_task'])
  })

  it('declares the features of every staff route each tool calls', () => {
    expect(tool('list_projects').requiredFeatures).toEqual([PROJECTS_VIEW_FEATURE])
    expect(tool('get_task').requiredFeatures).toEqual([TASKS_VIEW_FEATURE])
    expect(tool('search_tasks').requiredFeatures).toEqual([TASKS_VIEW_FEATURE, PROJECTS_VIEW_FEATURE])
    expect(tool('create_task').requiredFeatures).toEqual([TASKS_MANAGE_FEATURE, TASKS_VIEW_FEATURE, PROJECTS_VIEW_FEATURE])
    expect(tool('comment_task').requiredFeatures).toEqual([TASKS_MANAGE_FEATURE, TASKS_VIEW_FEATURE])
  })

  it('carries no scope fields in any input schema', () => {
    for (const entry of aiTools) {
      const shape = (entry.inputSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {}
      expect(Object.keys(shape)).not.toEqual(expect.arrayContaining(['tenantId']))
      expect(Object.keys(shape)).not.toEqual(expect.arrayContaining(['organizationId']))
    }
  })
})

describe('scope guard', () => {
  it.each(['create_task', 'get_task', 'search_tasks', 'list_projects', 'comment_task'])(
    '%s refuses a context without organization before calling staff',
    async (name) => {
      const input =
        name === 'create_task'
          ? { project: 'WEB', title: 'x' }
          : name === 'get_task'
            ? { reference: 'WEB-1' }
            : name === 'comment_task'
              ? { task: 'WEB-1', body: 'x' }
              : {}
      await expect(tool(name).handler(input, context({ organizationId: null }))).rejects.toThrow('[internal]')
      expect(fake.requests).toHaveLength(0)
    },
  )
})

describe('task_tools.create_task', () => {
  it('creates the task in the resolved project and returns reference, status and board link', async () => {
    process.env.APP_URL = 'http://localhost:3000'
    fake = createFakeStaff({
      tasks: [taskRow({ id: '66666666-6666-4666-8666-666666666666', reference: 'WEB-13' })],
    })
    const result = await tool('create_task').handler(
      { project: 'WEB', title: 'ZDP-5000 holds 5 200 l', description: 'Dimensions missing' },
      context(),
    )
    const post = fake.requests.find((request) => request.method === 'POST')
    expect(post).toMatchObject({
      path: '/staff/timesheets/tasks',
      body: { timeProjectId: PROJECT_WEB.id, title: 'ZDP-5000 holds 5 200 l', description: 'Dimensions missing' },
    })
    expect(post?.body).not.toHaveProperty('assigneeStaffMemberId')
    expect(post?.body).not.toHaveProperty('tenantId')
    expect(result).toEqual({
      taskId: '66666666-6666-4666-8666-666666666666',
      reference: 'WEB-13',
      projectId: PROJECT_WEB.id,
      projectCode: 'WEB',
      statusSlug: 'backlog',
      assigneeId: null,
      href: `http://localhost:3000/backend/staff/time-tracking/projects/${PROJECT_WEB.id}/board?task=66666666-6666-4666-8666-666666666666`,
    })
  })

  it('passes assigneeId through as assigneeStaffMemberId and surfaces the staff 422', async () => {
    fake = createFakeStaff({
      handler: (request) =>
        request.method === 'POST'
          ? {
              success: false,
              statusCode: 422,
              error: 'Staff member not found or not accessible.',
              details: { fieldErrors: { assigneeStaffMemberId: 'Staff member not found or not accessible.' } },
            }
          : undefined,
    })
    const assigneeId = '88888888-8888-4888-8888-888888888888'
    await expect(tool('create_task').handler({ project: 'WEB', title: 'x', assigneeId }, context())).rejects.toMatchObject({
      code: 'validation_failed',
      status: 422,
    })
    expect(fake.requests.find((request) => request.method === 'POST')?.body).toMatchObject({
      assigneeStaffMemberId: assigneeId,
    })
  })

  it('fails with project_not_found without writing', async () => {
    await expect(tool('create_task').handler({ project: 'OPS', title: 'x' }, context())).rejects.toMatchObject({
      code: 'project_not_found',
    })
    expect(fake.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('rejects invalid input', async () => {
    await expect(tool('create_task').handler({ project: 'WEB', title: '' }, context())).rejects.toThrow()
    await expect(
      tool('create_task').handler({ project: 'WEB', title: 'x', description: 'a'.repeat(8001) }, context()),
    ).rejects.toThrow()
  })
})

describe('task_tools.get_task', () => {
  it('returns the task with its comments', async () => {
    fake = createFakeStaff({
      comments: [
        { id: 'c1', body: 'Customer confirmed', authorName: null, authorEmail: 'a@b.c', createdAt: '2026-09-19T10:00:00Z' },
      ],
    })
    const result = await tool('get_task').handler({ reference: 'WEB-1' }, context())
    expect(result).toMatchObject({
      found: true,
      task: { reference: 'WEB-1', statusSlug: 'backlog', projectCode: 'WEB', projectId: PROJECT_WEB.id },
      comments: [{ id: 'c1', authorName: 'a@b.c', body: 'Customer confirmed' }],
      commentCount: 1,
    })
  })

  it('answers found:false for a missing or invisible task', async () => {
    fake = createFakeStaff({ tasks: [] })
    await expect(tool('get_task').handler({ reference: 'OPS-1' }, context())).resolves.toEqual({ found: false })
  })

  it('requires reference or taskId', async () => {
    await expect(tool('get_task').handler({}, context())).rejects.toThrow('Provide reference or taskId.')
  })
})

describe('task_tools.search_tasks', () => {
  it('merges title and reference matches without duplicates', async () => {
    fake = createFakeStaff({
      tasks: [
        taskRow({ id: 'a', reference: 'WEB-1', title: 'ZDP-5000 capacity' }),
        taskRow({ id: 'b', reference: 'ZDP-2', title: 'Other', time_project_id: 'zdp' }),
      ],
    })
    const result = await tool('search_tasks').handler({ query: 'zdp' }, context())
    expect(result).toMatchObject({ totalCount: 2 })
    expect((result as { items: Array<{ id: string }> }).items.map((item) => item.id).sort()).toEqual(['a', 'b'])
    const titleQuery = fake.requests.find((request) => request.query?.q === 'zdp')
    expect(titleQuery?.query).toMatchObject({ pageSize: 20, sortField: 'updatedAt', sortDir: 'desc' })
  })

  it('filters by project code and status slug', async () => {
    fake = createFakeStaff({
      tasks: [taskRow({ id: 'a' }), taskRow({ id: 'b', task_status_id: STATUS_DONE.id, reference: 'WEB-2' })],
    })
    const result = await tool('search_tasks').handler({ project: 'WEB', status: 'done', limit: 5 }, context())
    expect(result).toEqual({
      items: [{ id: 'b', reference: 'WEB-2', title: 'ZDP-5000 holds 5 200 l', statusSlug: 'done', projectCode: 'WEB' }],
      totalCount: 1,
    })
  })

  it('returns nothing for an unknown status slug', async () => {
    await expect(tool('search_tasks').handler({ status: 'nope' }, context())).resolves.toEqual({ items: [], totalCount: 0 })
  })
})

describe('task_tools.list_projects', () => {
  it('lists visible projects with membership', async () => {
    fake = createFakeStaff({ memberProjectIds: [PROJECT_WEB.id] })
    await expect(tool('list_projects').handler({}, context())).resolves.toEqual({
      items: [{ id: PROJECT_WEB.id, code: 'WEB', name: 'Website', status: 'active', isMember: true }],
    })
  })
})

describe('task_tools.comment_task', () => {
  it('posts only the body to the task comments route', async () => {
    const result = await tool('comment_task').handler({ task: 'WEB-1', body: 'Customer confirmed 5 200 l' }, context())
    const post = fake.requests.find((request) => request.method === 'POST')
    expect(post).toEqual({
      method: 'POST',
      path: '/staff/timesheets/tasks/55555555-5555-4555-8555-555555555555/comments',
      body: { body: 'Customer confirmed 5 200 l' },
    })
    expect(result).toMatchObject({ commentId: '77777777-7777-4777-8777-777777777777', reference: 'WEB-1' })
  })

  it('fails with task_not_found for an invisible task without writing', async () => {
    fake = createFakeStaff({ tasks: [] })
    await expect(tool('comment_task').handler({ task: 'OPS-1', body: 'x' }, context())).rejects.toMatchObject({
      code: 'task_not_found',
    })
    expect(fake.requests.some((request) => request.method === 'POST')).toBe(false)
  })
})
