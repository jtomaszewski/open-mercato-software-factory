import { beforeEach, expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  AgentRun,
  AgentSpan,
  AgentToolCall,
  ProcessInstance,
} from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation } from '../../task_delegation/data/entities'

const findOne = jest.fn<(entity: unknown) => Promise<unknown>>()
const findMany = jest.fn<(entity: unknown) => Promise<unknown[]>>()
const readChangeRequest = jest.fn<() => Promise<unknown>>()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (_em: unknown, entity: unknown) => findOne(entity),
  findWithDecryption: (_em: unknown, entity: unknown) => findMany(entity),
}))
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ warn: jest.fn() }) }),
}))
jest.mock('../lib/changeRequests', () => ({ readChangeRequest: () => readChangeRequest() }))
jest.mock('../../task_delegation/lib/auth', () => ({
  requireTaskScope: async () => ({ tenantId: 'tenant-id', organizationId: 'org-id', userId: 'user-id' }),
}))

// Required after the mock declarations (which jest hoists) so the module binds to them.
const { readChangeRequestActivity } = require('../lib/activity') as typeof import('../lib/activity')

const AT = new Date('2026-09-20T10:21:00Z')
const ctx = { container: { resolve: () => ({}) } } as unknown as CommandRuntimeContext

function delegation(overrides: Partial<TaskDelegation> = {}) {
  return Object.assign(new TaskDelegation(), { id: 'delegation-id', processInstanceId: 'process-id', releasedAt: null }, overrides)
}

function process() {
  return Object.assign(new ProcessInstance(), { id: 'process-id', workflowInstanceId: 'instance-id', lastActivityAt: AT })
}

function run(overrides: Partial<AgentRun> = {}) {
  return Object.assign(new AgentRun(), {
    id: 'run-id', agentId: 'website_publishing.developer', status: 'running',
    createdAt: AT, updatedAt: AT, completedAt: null, errorMessage: null,
  }, overrides)
}

/** One tool call and the span that carries its place in the run. */
function toolCall(id: string, sequence: number, toolName: string, args: unknown) {
  const span = Object.assign(new AgentSpan(), {
    id: `span-${id}`, agentRunId: 'run-id', sequence, name: toolName, startedAt: AT, durationMs: 10,
  })
  const call = Object.assign(new AgentToolCall(), {
    id, agentRunId: 'run-id', spanId: span.id, toolName, requestSummary: args, status: 'ok', createdAt: AT, latencyMs: null,
  })
  return { span, call }
}

beforeEach(() => {
  findOne.mockReset()
  findMany.mockReset()
  readChangeRequest.mockReset()
  readChangeRequest.mockResolvedValue({ delegationId: 'delegation-id' })
})

function wire(options: {
  delegation?: TaskDelegation
  instanceStatus?: string
  runs?: AgentRun[]
  trace?: ReturnType<typeof toolCall>[]
}) {
  const trace = options.trace ?? []
  findOne.mockImplementation(async (entity) => {
    if (entity === TaskDelegation) return options.delegation ?? delegation()
    if (entity === ProcessInstance) return process()
    return null
  })
  findMany.mockImplementation(async (entity) => {
    if (entity === AgentRun) return options.runs ?? [run()]
    if (entity === AgentSpan) return trace.map((entry) => entry.span)
    if (entity === AgentToolCall) return trace.map((entry) => entry.call)
    return []
  })
  const em = {
    findOne: async () => ({ id: 'instance-id', currentStepId: 'develop', status: options.instanceStatus ?? 'RUNNING', updatedAt: AT }),
  }
  return { container: { resolve: () => em } } as unknown as CommandRuntimeContext
}

it('reports the stage and the agent runs of a change still being made', async () => {
  const activity = await readChangeRequestActivity(wire({}), 'change-request-id')
  expect(activity).toMatchObject({
    active: true,
    stage: 'develop',
    runs: [{ id: 'run-id', agentId: 'website_publishing.developer', status: 'running', steps: [] }],
  })
})

it('orders the trace by its span sequence, not by when the rows were written', async () => {
  // Every row of an OpenCode trace is written in ONE ingest when the session ends, so they share
  // a created_at to the millisecond; only the sequence preserves the order the agent worked in.
  const trace = [
    toolCall('call-c', 2, 'bash', { command: 'npm run build' }),
    toolCall('call-a', 0, 'read', { filePath: 'app/page.tsx' }),
    toolCall('call-b', 1, 'open-mercato_agent_orchestrator_submit_outcome', {}),
  ]
  const activity = await readChangeRequestActivity(
    wire({ runs: [run({ status: 'ok', completedAt: AT })], instanceStatus: 'COMPLETED', trace }),
    'change-request-id',
  )
  expect(activity.runs[0].steps.map((step) => [step.kind, step.detail])).toEqual([
    ['reading', 'app/page.tsx'],
    ['reporting', null],
    ['building', 'npm run build'],
  ])
  expect(activity.active).toBe(false)
})

it('is never live once the delegation has been released', async () => {
  // The run closed its own task; a workflow row still saying RUNNING must not keep the page
  // polling and claiming an agent is at work.
  const activity = await readChangeRequestActivity(
    wire({ delegation: delegation({ releasedAt: AT }), instanceStatus: 'RUNNING' }),
    'change-request-id',
  )
  expect(activity.active).toBe(false)
  expect(activity.runs).toHaveLength(1)
})

it('degrades to no activity rather than failing the decision page', async () => {
  findOne.mockImplementation(async () => { throw new Error('orchestrator tables unavailable') })
  await expect(readChangeRequestActivity(ctx, 'change-request-id')).resolves.toMatchObject({ active: false, runs: [] })
})

it('has nothing to show for a change request that was never delegated', async () => {
  readChangeRequest.mockResolvedValue({ delegationId: null })
  await expect(readChangeRequestActivity(ctx, 'change-request-id')).resolves.toMatchObject({ active: false, stage: null, runs: [] })
  expect(findOne).not.toHaveBeenCalled()
})
