import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { openProductTask } from '../lib/board'

const logger = createLogger('website_publishing').child({ subscriber: 'product-created' })

export const metadata = {
  event: 'catalog.product.created',
  persistent: true,
  id: 'website_publishing:product-created',
}

type ProductCreatedPayload = { id?: string }

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

/**
 * Scene 3 intake (SPEC-004): a new product becomes a WWW board task delegated to the Software
 * Engineer; the delegation starts `website_publishing.website_change`.
 *
 * Every new product, not only one filed under „Od ręki”. That category used to be the trigger,
 * which made the rule invisible: a product added through the catalog chat carried no category,
 * so the intake returned in silence and the website simply never changed. Adding a product is
 * the intent; the website following is the point.
 *
 * An inactive product is still skipped — a draft is the one case where "added to the catalog"
 * does not mean "show it to the public" — and says so, because a silent skip is what made the
 * old rule so hard to see.
 *
 * Scope comes only from the event-bus options the emitter attached. The seeder writes through
 * the entity manager and never emits this event, so a reset does not start seven runs. Failures
 * rethrow so the persistent event retries; the intake is idempotent per product.
 */
export default async function handle(payload: ProductCreatedPayload, ctx: SubscriberContext): Promise<void> {
  const productId = typeof payload?.id === 'string' ? payload.id : null
  const tenantId = typeof ctx.tenantId === 'string' && ctx.tenantId ? ctx.tenantId : null
  const organizationId = typeof ctx.organizationId === 'string' && ctx.organizationId ? ctx.organizationId : null
  if (!productId || !tenantId || !organizationId) return
  const scope = { tenantId, organizationId }

  const em = (ctx.resolve('em') as EntityManager).fork()
  const product = await em.findOne(CatalogProduct, { id: productId, ...scope, deletedAt: null })
  if (!product) return
  if (!product.isActive) {
    logger.info('product intake skipped: the product is not active', { productId, sku: product.sku })
    return
  }

  const container = await createRequestContainer()
  const result = await openProductTask(container, scope, { id: product.id, sku: product.sku ?? null, title: product.title }, {
    appUrl: process.env.APP_URL ?? null,
  })
  if (result.status === 'skipped') logger.warn('product intake skipped', { productId, ...result })
  else logger.info('product intake on the board', { productId, sku: product.sku, ...result })
}
