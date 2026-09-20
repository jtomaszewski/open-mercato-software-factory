import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { openOrderTask } from '../lib/board'
import { FULFILLED_STATUS, loadOrderRecordView } from '../lib/orderRecord'

const logger = createLogger('website_publishing').child({ subscriber: 'order-fulfilled' })

export const metadata = {
  event: 'website_publishing.order.fulfilled',
  persistent: true,
  id: 'website_publishing:order-fulfilled',
}

type OrderFulfilledPayload = { id?: string }

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

/**
 * Scene 3b intake (SPEC-006): a fulfilled order becomes a WWW board task delegated to the
 * Software Engineer, whose run adds the customer as a reference on the website. Scope comes from
 * the event-bus options; the order is re-read, so an order reopened meanwhile is left alone.
 * Failures rethrow so the persistent event retries; the intake is idempotent per order.
 */
export default async function handle(payload: OrderFulfilledPayload, ctx: SubscriberContext): Promise<void> {
  const orderId = typeof payload?.id === 'string' ? payload.id : null
  const tenantId = typeof ctx.tenantId === 'string' && ctx.tenantId ? ctx.tenantId : null
  const organizationId = typeof ctx.organizationId === 'string' && ctx.organizationId ? ctx.organizationId : null
  if (!orderId || !tenantId || !organizationId) return
  const scope = { tenantId, organizationId }

  const em = (ctx.resolve('em') as EntityManager).fork()
  const order = await loadOrderRecordView(em, scope, orderId)
  if (!order || order.status !== FULFILLED_STATUS) return

  const container = await createRequestContainer()
  const result = await openOrderTask(container, scope, { id: order.id, orderNumber: order.orderNumber, customerName: order.customer.name }, {
    appUrl: process.env.APP_URL ?? null,
  })
  if (result.status === 'skipped') logger.warn('realization intake skipped', { orderId, ...result })
  else logger.info('realization intake on the board', { orderId, orderNumber: order.orderNumber, ...result })
}
