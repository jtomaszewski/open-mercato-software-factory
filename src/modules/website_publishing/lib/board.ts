import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentPrincipal } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DEMO_PROJECT_CODE } from '../../task_delegation/lib/demoSetup'
import { DEVELOPER_AGENT_IDS } from '../../task_delegation/lib/agentIdentity'
import { actingContext } from '../../code_changes/lib/run'
import type { Scope } from './catalogRecord'

export type BoardProduct = { id: string; sku: string | null; title: string }

export type BoardTaskResult =
  | { status: 'delegated' | 'already_delegated'; taskId: string; created: boolean; delegationId: string | null }
  | { status: 'skipped'; reason: 'no_demo_project' | 'no_project_owner' | 'no_agent' | 'not_in_backlog'; taskId: string | null }

const PRODUCT_LINK = /\/backend\/catalog\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

export function productTaskTitle(product: BoardProduct): string {
  return `Opublikuj stronę produktu ${product.sku ?? product.title}`
}

/**
 * The task body carries the catalog link. It is the only product reference the website run
 * reads back (`readProductIdFromTask`), so a task a person creates by hand with the same link
 * works too (SPEC-004 fallback: „Norbert tworzy zadanie ręcznie z linkiem do produktu”).
 */
export function productTaskDescription(product: BoardProduct, appUrl?: string | null): string {
  const base = appUrl ? appUrl.replace(/\/$/, '') : ''
  return [
    `Nowy produkt w katalogu: ${product.title}${product.sku ? ` (${product.sku})` : ''}.`,
    '',
    `Produkt: ${base}/backend/catalog/products/${product.id}`,
    '',
    'Fabryka dodaje stronę produktu na stronie www jako PR z preview.',
  ].join('\n')
}

export function readProductIdFromTask(description: string | null | undefined): string | null {
  const match = description ? PRODUCT_LINK.exec(description) : null
  return match ? match[1]!.toLowerCase() : null
}

type ProjectRow = { id: string; owner_user_id: string | null }
type TaskRow = { id: string; description: string | null }

async function findSoftwareEngineerUserId(container: AwilixContainer, scope: Scope): Promise<string | null> {
  const hasRegistration = (container as { hasRegistration?: (name: string) => boolean }).hasRegistration
  if (typeof hasRegistration !== 'function' || !hasRegistration.call(container, 'AgentPrincipal')) return null
  const em = container.resolve<EntityManager>('em').fork()
  // The current id first, then the ids this agent was provisioned under before the rename.
  for (const agentDefinitionId of DEVELOPER_AGENT_IDS) {
    const principal = await findOneWithDecryption(em, AgentPrincipal, {
      ...scope, agentDefinitionId, enabled: true, deletedAt: null,
    }, {}, scope)
    if (principal?.userId) return principal.userId
  }
  return null
}

type BoardTask = {
  title: string
  description: string
  /** Whether an existing task on the board is already about this record. */
  matches: (description: string | null) => boolean
}

/**
 * Puts a task on the WWW board and delegates it to the Software Engineer, which starts
 * `website_publishing.website_change` (task_delegation's start-delegated-run subscriber). Acts as the DEMO project owner,
 * who becomes the accountable assignee. Idempotent per record: an existing task linking the
 * record is reused, and an active delegation is left alone.
 */
async function openDelegatedTask(container: AwilixContainer, scope: Scope, boardTask: BoardTask): Promise<BoardTaskResult> {
  const qe = container.resolve<QueryEngine>('queryEngine')
  const bus = container.resolve<CommandBus>('commandBus')

  const projects = await qe.query<ProjectRow>('staff:staff_time_project', {
    fields: ['id', 'owner_user_id'], filters: { code: DEMO_PROJECT_CODE }, page: { page: 1, pageSize: 1 },
    tenantId: scope.tenantId, organizationId: scope.organizationId,
  })
  const project = projects.items[0]
  if (!project) return { status: 'skipped', reason: 'no_demo_project', taskId: null }
  if (!project.owner_user_id) return { status: 'skipped', reason: 'no_project_owner', taskId: null }
  const agentUserId = await findSoftwareEngineerUserId(container, scope)
  if (!agentUserId) return { status: 'skipped', reason: 'no_agent', taskId: null }
  const ctx = actingContext(container, scope, project.owner_user_id)

  const tasks = await qe.query<TaskRow>('staff:staff_time_task', {
    fields: ['id', 'description'], filters: { time_project_id: project.id }, page: { page: 1, pageSize: 500 },
    tenantId: scope.tenantId, organizationId: scope.organizationId,
  })
  let taskId = tasks.items.find((task) => boardTask.matches(task.description))?.id ?? null
  const created = !taskId
  if (!taskId) {
    const { result } = await bus.execute<Record<string, unknown>, { taskId: string }>('staff.timesheets.tasks.create', {
      input: {
        ...scope,
        timeProjectId: project.id,
        title: boardTask.title,
        description: boardTask.description,
      },
      ctx,
    })
    taskId = result.taskId
  }

  try {
    const { result } = await bus.execute<Record<string, unknown>, { taskId: string; delegationId: string }>('task_delegation.task.delegate', {
      input: { taskId, agentUserId },
      ctx: actingContext(container, scope, project.owner_user_id),
    })
    return { status: 'delegated', taskId, created, delegationId: result.delegationId }
  } catch (error) {
    const code = isCrudHttpError(error) ? (error.body as { code?: string } | undefined)?.code : undefined
    if (code === 'already_delegated') return { status: 'already_delegated', taskId, created, delegationId: null }
    if (code === 'invalid_transition') return { status: 'skipped', reason: 'not_in_backlog', taskId }
    throw error
  }
}

/** Scene 3 intake (SPEC-004): a product for the website, one task per product. */
export function openProductTask(
  container: AwilixContainer,
  scope: Scope,
  product: BoardProduct,
  options: { appUrl?: string | null } = {},
): Promise<BoardTaskResult> {
  return openDelegatedTask(container, scope, {
    title: productTaskTitle(product),
    description: productTaskDescription(product, options.appUrl),
    matches: (description) => readProductIdFromTask(description) === product.id.toLowerCase(),
  })
}

export type BoardOrder = { id: string; orderNumber: string; customerName: string }

const ORDER_LINK = /\/backend\/sales\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

export function orderTaskTitle(order: BoardOrder): string {
  return `Realizacja: ${order.customerName} — ${order.orderNumber}`
}

/** Like the product task, the order link is the only order reference the run reads back. */
export function orderTaskDescription(order: BoardOrder, appUrl?: string | null): string {
  const base = appUrl ? appUrl.replace(/\/$/, '') : ''
  return [
    `Zamówienie ${order.orderNumber} dla ${order.customerName} zostało zrealizowane.`,
    '',
    `Zamówienie: ${base}/backend/sales/orders/${order.id}`,
    '',
    'Fabryka dodaje realizację na stronie www (logo klienta w „Zaufali nam” i karta w „Realizacje”) jako PR z preview.',
  ].join('\n')
}

export function readOrderIdFromTask(description: string | null | undefined): string | null {
  const match = description ? ORDER_LINK.exec(description) : null
  return match ? match[1]!.toLowerCase() : null
}

/** Scene 3b intake (SPEC-006): a fulfilled order becomes a website reference, one task per order. */
export function openOrderTask(
  container: AwilixContainer,
  scope: Scope,
  order: BoardOrder,
  options: { appUrl?: string | null } = {},
): Promise<BoardTaskResult> {
  return openDelegatedTask(container, scope, {
    title: orderTaskTitle(order),
    description: orderTaskDescription(order, options.appUrl),
    matches: (description) => readOrderIdFromTask(description) === order.id.toLowerCase(),
  })
}
