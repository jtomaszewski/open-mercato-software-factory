import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { WorkflowDefinition, WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation } from '../../data/entities'
import { requireProcessAuthority } from '../processAuthority'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const DELEGATION_ID = '22222222-2222-4222-8222-222222222222'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'
const WORKFLOW_ID = '44444444-4444-4444-8444-444444444444'
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555'
const ACTOR_ID = '66666666-6666-4666-8666-666666666666'

const findOne = jest.fn<(entity: unknown) => Promise<unknown>>()
const resolvePrincipal = jest.fn<() => Promise<string | null>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (entityManager: unknown, entity: unknown) => findOne(entity),
}))
jest.mock('@open-mercato/core/modules/workflows/lib/definition-grant', () => ({
  resolveWorkflowDefinitionExecutionUserId: () => resolvePrincipal(),
}))

function context() {
  const rbacService = { userHasAllFeatures: jest.fn(async () => true) }
  return {
    auth: { sub: ACTOR_ID, tenantId: 'tenant-id', orgId: 'org-id' },
    selectedOrganizationId: 'org-id',
    organizationIds: ['org-id'],
    organizationScope: null,
    transactionalEm: {},
    container: { resolve: () => rbacService },
  } as unknown as CommandRuntimeContext
}

beforeEach(() => {
  findOne.mockReset().mockImplementation(async (entity) => {
    if (entity === ProcessInstance) return {
      id: PROCESS_ID, workflowInstanceId: WORKFLOW_ID,
      input: { taskId: TASK_ID, delegationId: DELEGATION_ID },
    }
    if (entity === WorkflowInstance) return { id: WORKFLOW_ID, definitionId: DEFINITION_ID, metadata: null }
    if (entity === WorkflowDefinition) return { id: DEFINITION_ID, createdBy: null }
    if (entity === User) return { id: ACTOR_ID, kind: 'service' }
    if (entity === TaskDelegation) return { id: DELEGATION_ID, taskId: TASK_ID, processInstanceId: PROCESS_ID }
    return null
  })
  resolvePrincipal.mockReset().mockResolvedValue(ACTOR_ID)
})

describe('workflow process authority', () => {
  it('accepts only the persisted non-human execution principal and exact correlations', async () => {
    await expect(requireProcessAuthority(context(), {
      taskId: TASK_ID, delegationId: DELEGATION_ID, processInstanceId: PROCESS_ID,
    })).resolves.toMatchObject({ delegation: { id: DELEGATION_ID }, process: { id: PROCESS_ID } })
  })

  it('rejects a wildcard-authorized human even when every supplied id matches', async () => {
    findOne.mockImplementation(async (entity) => {
      if (entity === ProcessInstance) return { id: PROCESS_ID, workflowInstanceId: WORKFLOW_ID, input: { taskId: TASK_ID, delegationId: DELEGATION_ID } }
      if (entity === WorkflowInstance) return { id: WORKFLOW_ID, definitionId: DEFINITION_ID, metadata: null }
      if (entity === WorkflowDefinition) return { id: DEFINITION_ID, createdBy: null }
      if (entity === User) return { id: ACTOR_ID, kind: 'human' }
      return null
    })
    await expect(requireProcessAuthority(context(), {
      taskId: TASK_ID, delegationId: DELEGATION_ID, processInstanceId: PROCESS_ID,
    })).rejects.toMatchObject({ status: 403 })
  })
})
