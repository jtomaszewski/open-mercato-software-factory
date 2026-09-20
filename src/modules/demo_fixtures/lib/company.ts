import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { createAttachmentFromBuffer } from '@open-mercato/core/modules/attachments/lib/createFromBuffer'
import { systemContext } from '../../task_delegation/lib/systemContext'
import { resolveOrderStatusEntry, METAL_ZBIORNIKI_PRODUCTS, type DemoSeedScope } from './metalZbiorniki'
import {
  DEMO_COMPANY_LOGO_FILE,
  DEMO_COMPANY_NAME,
  DEMO_CUSTOMERS,
  DEMO_PEOPLE,
  DEMO_PROJECTS,
  DEMO_TASKS,
  DEMO_TEAMS,
  DEMO_OPEN_ORDER,
} from './companyStory'

export type CompanySeedResult = { created: number; branded: boolean }

type Row = { id: string; [field: string]: unknown }

/**
 * Brands the organization and seeds the company story (customers, teams, staff, projects with
 * tasks, one more order). Needs the catalog seeded first. Writes go through the owning modules'
 * commands; every record is find-or-create on its natural key, so a repeat run adds nothing.
 */
export async function seedMetalZbiornikiCompany(container: AwilixContainer, scope: DemoSeedScope): Promise<CompanySeedResult> {
  const em = (container.resolve('em') as EntityManager).fork()
  const qe = container.resolve<QueryEngine>('queryEngine')
  const bus = container.resolve<CommandBus>('commandBus')
  const ctx = { ...systemContext(container, scope), bulkImport: { skipEvents: true, skipNotifications: true } }
  let created = 0

  // Encrypted columns (display names) can't be filtered in SQL, so callers match on decrypted rows.
  async function rows(entity: string, filters: Record<string, unknown>, fields: string[] = []): Promise<Row[]> {
    const result = await qe.query<Row>(entity, { fields: ['id', ...fields], filters, ...scope, page: { page: 1, pageSize: 500 } })
    return result.items
  }
  async function execute(command: string, resultKey: string, input: Record<string, unknown>): Promise<string> {
    const { result } = await bus.execute<Record<string, unknown>, Record<string, unknown>>(command, { input: { ...scope, ...input }, ctx })
    const id = result[resultKey]
    if (typeof id !== 'string' || !id) throw new Error(`${command} returned no ${resultKey}`)
    created += 1
    return id
  }
  async function ensure(existing: string | null | undefined, create: () => Promise<string>): Promise<string> {
    return existing ?? create()
  }

  // Stored as an attachment, the way the Branding page uploads it, so the logo URL is
  // host-relative and survives a change of port or domain.
  async function uploadLogo(): Promise<string> {
    const attachment = await createAttachmentFromBuffer({
      em,
      dataEngine: container.resolve('dataEngine'),
      ...scope,
      entityId: 'directory.organization',
      recordId: scope.organizationId,
      fileName: path.basename(DEMO_COMPANY_LOGO_FILE),
      mimeType: 'image/png',
      buffer: await readFile(path.resolve(process.cwd(), DEMO_COMPANY_LOGO_FILE)),
    })
    return attachment.url
  }

  const organization = await findOneWithDecryption(em, Organization, { id: scope.organizationId, tenant: scope.tenantId, deletedAt: null }, {}, scope)
  if (!organization) throw new Error(`Organization ${scope.organizationId} not found in tenant ${scope.tenantId}`)
  const branded = organization.name !== DEMO_COMPANY_NAME || !organization.logoUrl
  if (branded) {
    await bus.execute('directory.organizations.update', {
      input: {
        id: organization.id,
        tenantId: scope.tenantId,
        name: DEMO_COMPANY_NAME,
        logoUrl: organization.logoUrl || await uploadLogo(),
        logoPreserveAspectRatio: true,
        // The update command rewrites the hierarchy from its input, so pass the current one back.
        parentId: organization.parentId ?? null,
        childIds: organization.childIds ?? [],
      },
      ctx,
    })
  }

  const companies = await rows('customers:customer_entity', { kind: 'company' }, ['display_name'])
  const customers = new Map<string, string>()
  for (const customer of DEMO_CUSTOMERS) {
    customers.set(customer.key, await ensure(
      companies.find((row) => row.display_name === customer.displayName)?.id,
      () => execute('customers.companies.create', 'entityId', {
        displayName: customer.displayName, legalName: customer.displayName, description: customer.description,
        domain: customer.domain, websiteUrl: `https://${customer.domain}/`, primaryEmail: `kontakt@${customer.domain}`,
        industry: customer.industry, lifecycleStage: customer.lifecycleStage,
      }),
    ))
  }

  const existingTeams = await rows('staff:staff_team', {}, ['name'])
  const teams = new Map<string, string>()
  for (const team of DEMO_TEAMS) {
    teams.set(team.key, await ensure(
      existingTeams.find((row) => row.name === team.name)?.id,
      () => execute('staff.teams.create', 'teamId', { name: team.name, description: team.description }),
    ))
  }

  const members = await rows('staff:staff_team_member', {}, ['display_name'])
  const people = new Map<string, string>()
  for (const person of DEMO_PEOPLE) {
    people.set(person.key, await ensure(
      members.find((row) => row.display_name === person.name)?.id,
      () => execute('staff.team-members.create', 'memberId', {
        displayName: person.name, teamId: teams.get(person.team), description: person.role,
      }),
    ))
  }

  for (const project of DEMO_PROJECTS) {
    let projectId = (await rows('staff:staff_time_project', { code: project.code }))[0]?.id
    if (!projectId) {
      projectId = await execute('staff.timesheets.time_projects.create', 'timeProjectId', {
        name: project.name, code: project.code, description: project.description,
        customerId: customers.get(project.customer), currencyCode: 'PLN', billableByDefault: false,
      })
      for (const person of project.people) {
        await execute('staff.timesheets.time_project_members.assign', 'timeProjectMemberId', {
          timeProjectId: projectId, staffMemberId: people.get(person), assignedStartDate: '2026-01-01',
        })
      }
    }
    const tasks = await rows('staff:staff_time_task', { time_project_id: projectId }, ['title'])
    const statuses = await rows('staff:staff_time_task_status', { time_project_id: projectId }, ['slug'])
    for (const task of DEMO_TASKS.filter((item) => item.project === project.key)) {
      if (tasks.some((row) => row.title === task.title)) continue
      const taskStatusId = statuses.find((row) => row.slug === task.status)?.id
      if (!taskStatusId) throw new Error(`Project ${project.code} has no "${task.status}" column`)
      await execute('staff.timesheets.tasks.create', 'taskId', {
        timeProjectId: projectId, title: task.title, description: task.description,
        taskStatusId, assigneeStaffMemberId: people.get(task.person),
      })
    }
  }

  if (!(await rows('sales:sales_order', { order_number: DEMO_OPEN_ORDER.orderNumber }))[0]) {
    const catalog = await rows('catalog:catalog_product', { handle: { $in: DEMO_OPEN_ORDER.lines.map((line) => line.handle) } }, ['handle'])
    const status = await resolveOrderStatusEntry(em, scope, DEMO_OPEN_ORDER.status)
    await execute('sales.orders.create', 'orderId', {
      orderNumber: DEMO_OPEN_ORDER.orderNumber, statusEntryId: status?.id, customerEntityId: customers.get(DEMO_OPEN_ORDER.customer), currencyCode: 'PLN',
      placedAt: DEMO_OPEN_ORDER.placedAt, expectedDeliveryAt: DEMO_OPEN_ORDER.expectedDeliveryAt, comments: DEMO_OPEN_ORDER.comments,
      lines: DEMO_OPEN_ORDER.lines.map((line) => {
        const product = METAL_ZBIORNIKI_PRODUCTS.find((item) => item.handle === line.handle)!
        const productId = catalog.find((row) => row.handle === line.handle)?.id
        if (!productId) throw new Error(`Cannot seed order ${DEMO_OPEN_ORDER.orderNumber}: missing product ${line.handle}`)
        return {
          productId, name: product.title, kind: 'product', quantity: line.quantity, quantityUnit: 'pc',
          currencyCode: 'PLN', unitPriceNet: product.netPricePln, taxRate: 23,
        }
      }),
    })
  }

  return { created, branded }
}
