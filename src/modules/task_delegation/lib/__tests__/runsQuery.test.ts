import { describe, expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AgentRun, ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const DELEGATION_ID = '33333333-3333-4333-8333-333333333333'
/** The process ROW id, which is what the delegation stores. */
const PROCESS_ID = 'e6250809-f9f5-43a4-816e-cbc1b6ee16bc'
/** The WORKFLOW instance id, which is what an agent run carries. A different uuid, deliberately. */
const WORKFLOW_INSTANCE_ID = '4d3180e5-79be-496d-8497-9ffa8d6b1d29'

type Rows = { processes: Record<string, unknown>[]; agentRuns: Record<string, unknown>[] }
const rows: Rows = { processes: [], agentRuns: [] }
const agentRunWhere = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async () => ({
    id: DELEGATION_ID,
    taskId: TASK_ID,
    projectId: PROJECT_ID,
    delegateUserId: 'user-1',
    processInstanceId: PROCESS_ID,
    links: [],
    outcome: null,
    closeReason: null,
    releasedAt: null,
    createdAt: new Date('2026-09-20T08:21:00.000Z'),
    updatedAt: new Date('2026-09-20T08:25:00.000Z'),
  }),
  findWithDecryption: async (_em: unknown, entity: unknown, where: unknown) => {
    if (entity === ProcessInstance) return rows.processes
    if (entity === AgentRun) { agentRunWhere(where); return rows.agentRuns }
    if (entity === User) return [{ id: 'user-1', name: 'Software Engineer', email: 'se@example.com' }]
    return []
  },
}))

import { readTaskRun } from '../runsQuery'

function ctx(): CommandRuntimeContext {
  const query = async (entity: string) => {
    if (entity === 'staff:staff_time_task') return { items: [{ id: TASK_ID, title: 'Update the tank', description: null, time_project_id: PROJECT_ID }] }
    if (entity === 'staff:staff_time_project') return { items: [{ id: PROJECT_ID, name: 'www' }] }
    throw new Error(`unexpected entity ${entity}`)
  }
  return {
    container: {
      hasRegistration: () => true,
      resolve: (name: string) => {
        if (name === 'em') return {}
        if (name === 'queryEngine') return { query }
        if (name === 'rbacService') return { userHasAllFeatures: async () => true }
        if (name === 'timeTrackingAccessResolver') return { resolveProjectAccess: async () => ({ canManageAll: true, projectIds: [PROJECT_ID] }) }
        if (name === 'moduleConfigService') return { getRecord: async () => null }
        throw new Error(`unexpected ${name}`)
      },
    },
    auth: { sub: 'user-id', tenantId: 'tenant-id', orgId: 'org-id' },
    selectedOrganizationId: 'org-id',
    organizationIds: ['org-id'],
    organizationScope: null,
  } as unknown as CommandRuntimeContext
}

describe('readTaskRun agent runs', () => {
  it('finds the agent runs by the workflow instance the process carries, not by the process row id', async () => {
    rows.processes = [{ id: PROCESS_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, status: 'completed', milestonesReached: [] }]
    rows.agentRuns = [
      { id: 'run-research', agentId: 'website_publishing.researcher', status: 'ok', stepId: 'research', latencyMs: 13552, errorMessage: null, createdAt: new Date('2026-09-20T08:21:35.238Z'), completedAt: new Date('2026-09-20T08:21:48.923Z') },
      { id: 'run-develop', agentId: 'website_publishing.developer', status: 'ok', stepId: 'develop', latencyMs: 177593, errorMessage: null, createdAt: new Date('2026-09-20T08:21:50.090Z'), completedAt: new Date('2026-09-20T08:24:47.812Z') },
    ]
    agentRunWhere.mockClear()

    const run = await readTaskRun(ctx(), DELEGATION_ID)

    expect(agentRunWhere).toHaveBeenCalledWith(expect.objectContaining({ workflowInstanceId: WORKFLOW_INSTANCE_ID, deletedAt: null }))
    expect(run.agentRuns.map((agentRun) => agentRun.id)).toEqual(['run-research', 'run-develop'])
    expect(run.agentRuns[1]).toEqual({
      id: 'run-develop',
      agentId: 'website_publishing.developer',
      status: 'ok',
      stepId: 'develop',
      startedAt: '2026-09-20T08:21:50.090Z',
      completedAt: '2026-09-20T08:24:47.812Z',
      latencyMs: 177593,
      errorMessage: null,
    })
  })

  it('asks for nothing when the process never reached a workflow instance', async () => {
    rows.processes = [{ id: PROCESS_ID, workflowInstanceId: null, status: 'running', milestonesReached: [] }]
    rows.agentRuns = []
    agentRunWhere.mockClear()

    const run = await readTaskRun(ctx(), DELEGATION_ID)

    expect(agentRunWhere).not.toHaveBeenCalled()
    expect(run.agentRuns).toEqual([])
  })
})
