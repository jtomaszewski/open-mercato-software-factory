import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { openProductTask } from '../lib/board'
import { IN_STOCK_CATEGORY, loadCategorySlugs } from '../lib/catalogRecord'

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
 * Scene 3 intake (SPEC-004): a product created in „Od ręki” becomes a DEMO board task delegated
 * to the Software Engineer; the delegation starts `website_publishing.website_change`. Scope comes only from the event-bus
 * options the emitter attached. The seeder writes through the entity manager and never emits
 * this event. Failures rethrow so the persistent event retries; the intake is idempotent.
 */
export default async function handle(payload: ProductCreatedPayload, ctx: SubscriberContext): Promise<void> {
  const productId = typeof payload?.id === 'string' ? payload.id : null
  const tenantId = typeof ctx.tenantId === 'string' && ctx.tenantId ? ctx.tenantId : null
  const organizationId = typeof ctx.organizationId === 'string' && ctx.organizationId ? ctx.organizationId : null
  if (!productId || !tenantId || !organizationId) return
  const scope = { tenantId, organizationId }

  const em = (ctx.resolve('em') as EntityManager).fork()
  const slugs = await loadCategorySlugs(em, scope, productId)
  if (!slugs.includes(IN_STOCK_CATEGORY)) return
  const product = await em.findOne(CatalogProduct, { id: productId, ...scope, deletedAt: null })
  if (!product) return

  const container = await createRequestContainer()
  const result = await openProductTask(container, scope, { id: product.id, sku: product.sku ?? null, title: product.title }, {
    appUrl: process.env.APP_URL ?? null,
  })
  if (result.status === 'skipped') logger.warn('product intake skipped', { productId, ...result })
  else logger.info('product intake on the board', { productId, sku: product.sku, ...result })
}
