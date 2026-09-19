import { beforeEach, expect, it, jest } from '@jest/globals'

const findOneWithDecryption = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args) }))
const createAttachmentFromBuffer = jest.fn<(input: Record<string, unknown>) => Promise<{ url: string }>>()
jest.mock('@open-mercato/core/modules/attachments/lib/createFromBuffer', () => ({ createAttachmentFromBuffer: (input: Record<string, unknown>) => createAttachmentFromBuffer(input) }))
jest.mock('../stalZbiorniki', () => ({
  ...jest.requireActual<object>('../stalZbiorniki'),
  resolveOrderStatusEntry: async (_em: unknown, _scope: unknown, value: string) => ({ id: `status-${value}` }),
}))

import { seedStalZbiornikiCompany } from '../company'
import { DEMO_COMPANY_NAME, DEMO_CUSTOMERS, DEMO_PEOPLE, DEMO_PROJECTS, DEMO_TASKS, DEMO_TEAMS, DEMO_WATER_ORDER } from '../companyStory'

const scope = { tenantId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002' }
const execute = jest.fn<(id: string, args: { input: Record<string, unknown> }) => Promise<{ result: Record<string, string> }>>()
let rows: Record<string, Array<Record<string, unknown>>>

const container = {
  resolve: (name: string) => ({
    em: { fork: () => ({}) },
    queryEngine: { query: async (entity: string) => ({ items: rows[entity] ?? [] }) },
    commandBus: { execute },
    dataEngine: {},
  })[name],
} as never

const statuses = ['backlog', 'in-progress', 'in-review', 'done'].map((slug) => ({ id: `status-${slug}`, slug }))
const products = [{ id: 'product-zppoz', handle: 'zppoz-20' }, { id: 'product-zch', handle: 'zch-3000' }]

beforeEach(() => {
  rows = { 'staff:staff_time_task_status': statuses, 'catalog:catalog_product': products }
  findOneWithDecryption.mockReset().mockResolvedValue({ id: scope.organizationId, name: 'Acme Corp', logoUrl: null, parentId: null, childIds: [] })
  createAttachmentFromBuffer.mockReset().mockResolvedValue({ url: '/api/attachments/file/logo-1' })
  execute.mockReset().mockImplementation(async (id) => ({
    result: { entityId: `customer-${id}`, teamId: 'team', memberId: 'member', timeProjectId: 'project', timeProjectMemberId: 'membership', taskId: 'task', orderId: 'order' },
  }))
})

it('brands the organization and seeds the company around the catalog', async () => {
  const result = await seedStalZbiornikiCompany(container, scope)

  const calls = execute.mock.calls.map(([id]) => id)
  expect(calls[0]).toBe('directory.organizations.update')
  expect(execute.mock.calls[0]![1].input).toMatchObject({
    id: scope.organizationId, name: DEMO_COMPANY_NAME, logoUrl: '/api/attachments/file/logo-1', parentId: null, childIds: [],
  })
  expect(calls.filter((id) => id === 'customers.companies.create')).toHaveLength(DEMO_CUSTOMERS.length)
  expect(calls.filter((id) => id === 'staff.teams.create')).toHaveLength(DEMO_TEAMS.length)
  expect(calls.filter((id) => id === 'staff.team-members.create')).toHaveLength(DEMO_PEOPLE.length)
  expect(calls.filter((id) => id === 'staff.timesheets.time_projects.create')).toHaveLength(DEMO_PROJECTS.length)
  expect(calls.filter((id) => id === 'staff.timesheets.tasks.create')).toHaveLength(DEMO_TASKS.length)
  // The DEMO board is task_delegation's; the company seed never creates it.
  expect(execute.mock.calls.some(([, args]) => args.input.code === 'DEMO')).toBe(false)
  const order = execute.mock.calls.find(([id]) => id === 'sales.orders.create')![1].input
  expect(createAttachmentFromBuffer).toHaveBeenCalledWith(expect.objectContaining({ ...scope, entityId: 'directory.organization', recordId: scope.organizationId }))
  expect(order).toMatchObject({ ...scope, orderNumber: DEMO_WATER_ORDER.orderNumber, statusEntryId: 'status-in_fulfillment' })
  expect((order.lines as Array<{ productId: string }>).map((line) => line.productId)).toEqual(['product-zppoz', 'product-zch'])
  expect(result).toEqual({ created: execute.mock.calls.length - 1, branded: true })
})

it('changes nothing when every record already exists', async () => {
  findOneWithDecryption.mockResolvedValue({ id: scope.organizationId, name: DEMO_COMPANY_NAME, logoUrl: 'https://x/logo.png' })
  rows = {
    ...rows,
    'customers:customer_entity': DEMO_CUSTOMERS.map((customer) => ({ id: customer.key, display_name: customer.displayName })),
    'staff:staff_team': DEMO_TEAMS.map((team) => ({ id: team.key, name: team.name })),
    'staff:staff_team_member': DEMO_PEOPLE.map((person) => ({ id: person.key, display_name: person.name })),
    'staff:staff_time_project': [{ id: 'project' }],
    'staff:staff_time_task': DEMO_TASKS.map((task) => ({ id: task.title, title: task.title })),
    'sales:sales_order': [{ id: 'order' }],
  }

  expect(await seedStalZbiornikiCompany(container, scope)).toEqual({ created: 0, branded: false })
  expect(execute).not.toHaveBeenCalled()
  expect(createAttachmentFromBuffer).not.toHaveBeenCalled()
})
