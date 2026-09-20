import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { createFakeStaff, taskRow } from '../../task_tools/__fixtures__/fake-staff'

const DEMO_PROJECT = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'WWW',
  name: 'Demo',
  status: 'active',
}
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const AGENT_USER_ID = '77777777-7777-4777-8777-777777777777'
const DELEGATION_ID = '88888888-8888-4888-8888-888888888888'
const PRODUCT_ID = '99999999-9999-4999-8999-999999999999'

let fake = toolFake()

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner', () => ({
  createAiApiOperationRunner: jest.fn(() => fake.runner),
}))

jest.mock('../../task_tools/lib/next-server-resolve-shim', () => ({
  installNextServerResolveShim: jest.fn(() => false),
}))

import aiTools, {
  REQUEST_CHANGE_FEATURES,
  REQUEST_CHANGE_TOOL,
  requestChangeInputSchema,
} from '../ai-tools'

function toolFake(options: { includeAgent?: boolean } = {}) {
  return createFakeStaff({
    projects: [DEMO_PROJECT],
    tasks: [taskRow({ id: TASK_ID, reference: 'WWW-1', time_project_id: DEMO_PROJECT.id })],
    handler: (request) => {
      if (request.method === 'GET' && request.path === '/task_delegation/agents') {
        return {
          success: true,
          statusCode: 200,
          data: {
            items: options.includeAgent === false
              ? []
              : [{ userId: AGENT_USER_ID, agentId: 'developer', name: 'Developer', label: 'Developer', description: 'Opens a PR' }],
          },
        }
      }
      if (request.method === 'POST' && request.path === '/task_delegation/delegations') {
        return { success: true, statusCode: 201, data: { taskId: TASK_ID, delegationId: DELEGATION_ID } }
      }
      return undefined
    },
  })
}

function tool(): AiToolDefinition {
  const found = aiTools.find((entry) => entry.name === REQUEST_CHANGE_TOOL)
  if (!found) throw new Error('website_publishing.request_change tool missing')
  return found
}

function context(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: {} as McpToolContext['container'],
    userFeatures: [...REQUEST_CHANGE_FEATURES],
    isSuperAdmin: false,
    ...overrides,
  }
}

beforeEach(() => {
  fake = toolFake()
  delete process.env.APP_URL
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe('website_publishing.request_change registry contract', () => {
  it('is one approval-aware mutation with the complete route feature union', async () => {
    expect(aiTools).toHaveLength(1)
    expect(tool()).toMatchObject({
      name: REQUEST_CHANGE_TOOL,
      isMutation: true,
      isDestructive: false,
      requiredFeatures: [...REQUEST_CHANGE_FEATURES],
    })
    expect(tool().loadBeforeRecord).toBeDefined()
    await expect(tool().loadBeforeRecord?.(
      { title: 'Zmień stronę', instructions: 'Zmień pojemność.' },
      context(),
    )).resolves.toMatchObject({
      recordId: 'new:WWW',
      entityType: 'staff:staff_time_task',
      after: { project: 'WWW', delegate: 'Developer' },
    })
  })

  it('does not expose scope, runtime, agent, repository or command selectors', () => {
    const shape = (requestChangeInputSchema as unknown as { shape: Record<string, unknown> }).shape
    expect(Object.keys(shape).sort()).toEqual(['instructions', 'productId', 'title'])
  })
})

describe('website_publishing.request_change execution', () => {
  it('creates a WWW task, adds product context, and delegates through the guarded API', async () => {
    process.env.APP_URL = 'http://localhost:55110/'
    const result = await tool().handler({
      title: 'Zmień zbiornik na stronie',
      instructions: 'Zmień 5000 l na 5200 l we wszystkich miejscach.',
      productId: PRODUCT_ID,
    }, context())

    expect(fake.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /staff/timesheets/time-projects',
      'GET /task_delegation/agents',
      'POST /staff/timesheets/tasks',
      'POST /task_delegation/delegations',
      'GET /staff/timesheets/tasks',
    ])
    expect(fake.requests[2]?.body).toEqual({
      timeProjectId: DEMO_PROJECT.id,
      title: 'Zmień zbiornik na stronie',
      description: `Zmień 5000 l na 5200 l we wszystkich miejscach.\n\nProdukt: /backend/catalog/products/${PRODUCT_ID}`,
    })
    expect(fake.requests[3]?.body).toEqual({ taskId: TASK_ID, agentUserId: AGENT_USER_ID })
    expect(result).toEqual({
      taskId: TASK_ID,
      reference: 'WWW-1',
      projectId: DEMO_PROJECT.id,
      projectCode: 'WWW',
      delegationId: DELEGATION_ID,
      state: 'queued',
      href: `http://localhost:55110/backend/staff/time-tracking/projects/${DEMO_PROJECT.id}/board?task=${TASK_ID}`,
    })
  })

  it('supports a generic change without catalog context', async () => {
    await tool().handler({ title: 'Popraw stopkę', instructions: 'Dodaj aktualny rok.' }, context())
    expect(fake.requests[0]?.query).not.toHaveProperty('ids')
    expect(fake.requests[2]?.body).toMatchObject({ description: 'Dodaj aktualny rok.' })
  })

  it('always files on WWW, ignoring a model-invented project name', async () => {
    await tool().handler({ project: 'website', title: 'Zmień stronę', instructions: 'Zmień stopkę.' }, context())
    expect(fake.requests[2]?.body).toMatchObject({ timeProjectId: DEMO_PROJECT.id })
  })

  it('refuses missing scope or Developer before creating a task', async () => {
    await expect(tool().handler(
      { title: 'Zmień stronę', instructions: 'Zmień stopkę.' },
      context({ organizationId: null }),
    )).rejects.toThrow('[internal]')

    fake = toolFake({ includeAgent: false })
    await expect(tool().handler(
      { title: 'Zmień stronę', instructions: 'Zmień stopkę.' },
      context(),
    )).rejects.toThrow('developer_unavailable')
    expect(fake.requests.some(({ method }) => method === 'POST')).toBe(false)
  })

  it('rejects malformed product context', async () => {
    await expect(tool().handler({
      title: 'Zmień stronę',
      instructions: 'Zmień produkt.',
      productId: 'not-a-uuid',
    }, context())).rejects.toThrow()
    expect(fake.requests).toHaveLength(0)
  })
})
