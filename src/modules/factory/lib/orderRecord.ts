import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { CustomerCompanyProfile, CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SalesOrder, SalesOrderLine } from '@open-mercato/core/modules/sales/data/entities'
import type { Scope } from './catalogRecord'

/** The `sales.order_status` value that turns an order into a website reference (SPEC-006). */
export const FULFILLED_STATUS = 'fulfilled'

/** The order record the factory gets as the source of truth for a realization (SPEC-006). */
export type OrderRecordView = {
  id: string
  orderNumber: string
  status: string | null
  /** `YYYY-MM` of the order's last change, i.e. of the switch to fulfilled. */
  fulfilledMonth: string
  customer: {
    name: string
    legalName: string | null
    brandName: string | null
    websiteUrl: string | null
  }
  /** Product lines only, in line order; `sku` comes from the catalog product. */
  lines: { sku: string | null; name: string | null; quantity: number }[]
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Normalized order status; the column is free text next to the dictionary entry. */
export async function loadOrderStatus(em: EntityManager, scope: Scope, orderId: string): Promise<string | null> {
  const order = await findOneWithDecryption(em, SalesOrder, { id: orderId, ...scope, deletedAt: null }, {}, scope)
  return order ? text(order.status)?.toLowerCase() ?? null : null
}

/**
 * The ORM-free view of an order the agents work on. Customer fields are encrypted at rest, so
 * they are read with decryption; the order's customer snapshot fills gaps (e.g. a deleted
 * customer). Null when the order is not in scope.
 */
export async function loadOrderRecordView(em: EntityManager, scope: Scope, orderId: string): Promise<OrderRecordView | null> {
  const order = await findOneWithDecryption(em, SalesOrder, { id: orderId, ...scope, deletedAt: null }, {}, scope)
  if (!order) return null

  const [lines, company, profiles] = await Promise.all([
    findWithDecryption(em, SalesOrderLine, { order: order.id, ...scope, deletedAt: null }, { orderBy: { lineNumber: 'asc' } }, scope),
    order.customerEntityId
      ? findOneWithDecryption(em, CustomerEntity, { id: order.customerEntityId, ...scope, deletedAt: null }, {}, scope)
      : Promise.resolve(null),
    order.customerEntityId
      ? findWithDecryption(em, CustomerCompanyProfile, { entity: order.customerEntityId, ...scope }, {}, scope)
      : Promise.resolve([]),
  ])
  const productLines = lines.filter((line) => line.kind === 'product')
  const productIds = [...new Set(productLines.map((line) => line.productId).filter((id): id is string => !!id))]
  const products = productIds.length
    ? await em.find(CatalogProduct, { id: { $in: productIds }, ...scope })
    : []
  const skuByProduct = new Map(products.map((product) => [product.id, product.sku ?? null]))

  const snapshot = record(record(order.customerSnapshot)?.customer)
  const snapshotProfile = record(snapshot?.companyProfile)
  const profile = profiles[0] ?? null
  const changedAt = order.updatedAt ?? new Date()

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: text(order.status)?.toLowerCase() ?? null,
    fulfilledMonth: changedAt.toISOString().slice(0, 7),
    customer: {
      name: text(company?.displayName) ?? text(snapshot?.displayName) ?? order.orderNumber,
      legalName: text(profile?.legalName) ?? text(snapshotProfile?.legalName),
      brandName: text(profile?.brandName) ?? text(snapshotProfile?.brandName),
      websiteUrl: text(profile?.websiteUrl) ?? text(snapshotProfile?.websiteUrl),
    },
    lines: productLines.map((line) => ({
      sku: (line.productId ? skuByProduct.get(line.productId) : null) ?? text(record(line.catalogSnapshot)?.sku),
      name: text(line.name),
      quantity: Number(line.quantity),
    })),
  }
}
