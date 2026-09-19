import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandInterceptor, CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitWebsitePublishingEvent } from '../events'
import { FULFILLED_STATUS, loadOrderStatus } from '../lib/orderRecord'
import type { Scope } from '../lib/catalogRecord'

const logger = createLogger('website_publishing').child({ interceptor: 'order-fulfilled' })

/** Scope from the caller's auth, never from the command input. */
function callerScope(context: CommandInterceptorContext): Scope | null {
  const tenantId = context.auth?.tenantId ?? null
  const organizationId = context.selectedOrganizationId ?? context.auth?.orgId ?? null
  return tenantId && organizationId ? { tenantId, organizationId } : null
}

function orderIdOf(input: unknown): string | null {
  const id = (input as { id?: unknown } | null)?.id
  return typeof id === 'string' && id ? id : null
}

function forkEm(context: CommandInterceptorContext): EntityManager {
  return (context.container.resolve('em') as EntityManager).fork()
}

/**
 * Scene 3b trigger (SPEC-006). In 0.8.0 `sales.orders.update` emits no `sales.order.updated`
 * (only `sales.order.confirmed`/`cancelled`), so the switch to `fulfilled` is observed here:
 * the status before the command is compared with the committed one after it, and only that
 * transition emits `website_publishing.order.fulfilled`. The intake itself runs in a persistent subscriber,
 * so the salesperson's save never waits on or fails with the website intake.
 */
const orderFulfilled: CommandInterceptor = {
  id: 'website_publishing.order-fulfilled',
  targetCommand: 'sales.orders.update',
  priority: 90,
  async beforeExecute(input, context) {
    const scope = callerScope(context)
    const orderId = orderIdOf(input)
    if (!scope || !orderId) return { ok: true }
    const previousStatus = await loadOrderStatus(forkEm(context), scope, orderId)
    return { ok: true, metadata: { previousStatus } }
  },
  async afterExecute(input, _result, context) {
    const scope = callerScope(context)
    const orderId = orderIdOf(input)
    if (!scope || !orderId || context.metadata?.previousStatus === FULFILLED_STATUS) return
    try {
      const status = await loadOrderStatus(forkEm(context), scope, orderId)
      if (status !== FULFILLED_STATUS) return
      await emitWebsitePublishingEvent('website_publishing.order.fulfilled', { id: orderId, ...scope }, { persistent: true, ...scope })
    } catch (error) {
      // The order is saved; a lost reference request must not turn the save into an error.
      logger.error('could not request the website reference', { orderId, error: error instanceof Error ? error.message : String(error) })
    }
  },
}

export const interceptors: CommandInterceptor[] = [orderFulfilled]
