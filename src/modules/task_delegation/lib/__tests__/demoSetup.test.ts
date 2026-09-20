import { beforeEach, expect, it, jest } from '@jest/globals'

const findWithDecryption = jest.fn<(...args: unknown[]) => Promise<unknown[]>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: (...args: unknown[]) => findWithDecryption(...args) }))

import { seedTaskDelegationDemo } from '../demoSetup'

const scope = { tenantId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002' }
const execute = jest.fn<(id: string, args: { input: Record<string, unknown> }) => Promise<{ result: Record<string, string> }>>()
const provision = jest.fn<(...args: unknown[]) => Promise<{ userId: string }>>()
const resolvePrincipal = jest.fn<(...args: unknown[]) => Promise<{ userId: string } | null>>()
let rows: Record<string, Array<Record<string, unknown>>>

function container(withOrchestrator: boolean) {
  const services: Record<string, unknown> = {
    em: { fork: () => ({}) },
    queryEngine: { query: async (entity: string) => ({ items: rows[entity] ?? [] }) },
    commandBus: { execute },
    agentPrincipalService: { resolve: resolvePrincipal, provision },
  }
  return {
    resolve: (name: string) => services[name],
    hasRegistration: (name: string) => name !== 'agentPrincipalService' || withOrchestrator,
  } as never
}

beforeEach(() => {
  rows = {}
  findWithDecryption.mockReset().mockResolvedValue([
    { id: 'agent-user', kind: 'agent', email: 'agent@x' },
    { id: 'admin-user', kind: 'human', email: 'admin@x', name: 'Norbert' },
  ])
  execute.mockReset().mockImplementation(async (id) => ({
    result: { entityId: 'customer-1', memberId: 'member-1', timeProjectId: 'project-1', taskStatusId: `status-${id}` },
  }))
  provision.mockReset().mockResolvedValue({ userId: 'agent-user-id' })
  resolvePrincipal.mockReset().mockResolvedValue(null)
})

it('creates the Internal customer, admin staff member, DEMO project and agent', async () => {
  const result = await seedTaskDelegationDemo(container(true), scope)

  expect(execute.mock.calls.map(([id]) => id)).toEqual([
    'customers.companies.create',
    'staff.team-members.create',
    'staff.timesheets.time_projects.create',
    'staff.timesheets.time_project_members.assign',
  ])
  expect(execute.mock.calls[1]![1].input).toMatchObject({ ...scope, userId: 'admin-user', displayName: 'Norbert' })
  expect(execute.mock.calls[2]![1].input).toMatchObject({ ...scope, code: 'WWW', customerId: 'customer-1', ownerUserId: 'admin-user' })
  // SPEC-008: the agent reads as a job title; the identifier is the roster's `developer`.
  expect(provision).toHaveBeenCalledWith(scope, expect.objectContaining({
    agentDefinitionId: 'developer',
    displayName: 'Software Engineer',
    roleFeatures: ['task_delegation.view', 'task_delegation.process'],
  }))
  expect(result).toEqual({
    customerId: 'customer-1', staffMemberId: 'member-1', projectId: 'project-1', agentUserId: 'agent-user-id',
  })
})

it('changes nothing when every record already exists', async () => {
  rows = {
    'customers:customer_entity': [{ id: 'other', display_name: 'Acme' }, { id: 'customer-1', display_name: 'Internal' }],
    'staff:staff_team_member': [{ id: 'member-1' }],
    'staff:staff_time_project': [{ id: 'project-1' }],
  }

  const result = await seedTaskDelegationDemo(container(false), scope)

  expect(execute).not.toHaveBeenCalled()
  expect(provision).not.toHaveBeenCalled()
  expect(result).toMatchObject({ customerId: 'customer-1', projectId: 'project-1', agentUserId: null })
})
