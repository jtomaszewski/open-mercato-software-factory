import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import { hasRequiredFeatures } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/auth'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { createScopedApiOperationRunner } from '../task_tools/lib/scoped-runner'
import { installNextServerResolveShim } from '../task_tools/lib/next-server-resolve-shim'

export const CAPACITY_TOOL = 'catalog_corrections.correct_capacity'
const FEATURES = ['catalog.products.view', 'catalog.products.manage']
export const capacityInputSchema = z.object({
  productId: z.string().uuid(),
  capacityLiters: z.number().int().positive().describe('Correct capacity in whole litres, explicitly supplied by the user.'),
}).strict()

async function loadProduct(context: McpToolContext, productId: string) {
  const { tenantId, organizationId, userId } = context
  const { translate } = await resolveTranslations()
  if (!tenantId || !organizationId || !userId || !hasRequiredFeatures(FEATURES, context.userFeatures, context.isSuperAdmin)) {
    throw new Error(translate('catalog_corrections.errors.forbidden', 'Product view and manage permissions in a selected organization are required.'))
  }
  const em = context.container.resolve<EntityManager>('em').fork()
  const product = await findOneWithDecryption(em, CatalogProduct, {
    id: productId, tenantId, organizationId, deletedAt: null,
  }, {}, { tenantId, organizationId })
  if (!product) throw new Error(translate('catalog_corrections.errors.notFound', 'Product is not available in the selected organization.'))
  const capacity = product.metadata?.capacityLiters
  if (typeof capacity !== 'number' || !Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new Error(translate('catalog_corrections.errors.missingCapacity', 'The product has no valid capacity in litres to correct.'))
  }
  return { product, capacity }
}

function correctCopy(text: string, before: number, after: number): string {
  // Match litre quantities, not model numbers, prices or other technical values.
  return text.replace(/\b(\d+(?:[ \u00a0]\d{3})*)(\s*l\b)/g, (match, digits: string, unit: string) =>
    Number(digits.replace(/[ \u00a0]/g, '')) === before ? `${after}${unit}` : match)
}

function previewValues(product: CatalogProduct, beforeCapacity: number, afterCapacity: number) {
  return {
    before: { capacityLiters: beforeCapacity, title: product.title, description: product.description ?? null },
    after: {
      capacityLiters: afterCapacity,
      title: correctCopy(product.title, beforeCapacity, afterCapacity),
      description: product.description == null ? null : correctCopy(product.description, beforeCapacity, afterCapacity),
    },
  }
}

const capacityTool: AiToolDefinition = defineAiTool<unknown, unknown>({
  name: CAPACITY_TOOL,
  displayName: 'Correct product capacity',
  description: 'Propose a correction to an existing product capacity in litres. Updates metadata.capacityLiters and matching litre quantities in the title and description together. Preserves SKU, dimensions, prices and other metadata. Requires human approval; never infer the new capacity.',
  inputSchema: capacityInputSchema,
  requiredFeatures: FEATURES,
  isMutation: true,
  isBulk: false,
  isDestructive: false,
  async loadBeforeRecord(rawInput, context) {
    const input = capacityInputSchema.parse(rawInput)
    const { product, capacity } = await loadProduct(context, input.productId)
    const { translate } = await resolveTranslations()
    return {
      recordId: product.id,
      entityType: 'catalog.product',
      recordVersion: product.updatedAt.toISOString(),
      ...previewValues(product, capacity, input.capacityLiters),
      display: { fieldLabels: {
        capacityLiters: translate('catalog_corrections.fields.capacity', 'Capacity (l)'),
        title: translate('catalog_corrections.fields.title', 'Title'),
        description: translate('catalog_corrections.fields.description', 'Description'),
      } },
    }
  },
  async handler(rawInput, context) {
    const { translate } = await resolveTranslations()
    if (!context.approvedPendingActionId) {
      throw new Error(translate('catalog_corrections.errors.approvalRequired', 'Human approval is required before correcting capacity.'))
    }
    const input = capacityInputSchema.parse(rawInput)
    const { product, capacity } = await loadProduct(context, input.productId)
    const values = previewValues(product, capacity, input.capacityLiters)
    installNextServerResolveShim()
    const runner = createScopedApiOperationRunner({ ...context, tool: capacityTool })
    const response = await runner.run({
      method: 'PUT', path: '/catalog/products',
      body: {
        id: product.id, tenantId: context.tenantId, organizationId: context.organizationId,
        title: values.after.title, description: values.after.description,
        metadata: { ...product.metadata, capacityLiters: input.capacityLiters },
      },
    })
    if (!response.success) throw new Error(response.error ?? translate('catalog_corrections.errors.updateFailed', 'Catalog capacity update failed.'))
    const saved = await loadProduct(context, product.id)
    return {
      recordId: product.id, commandName: 'catalog.products.update',
      before: values.before,
      after: previewValues(saved.product, saved.capacity, saved.capacity).before,
    }
  },
})

export const aiTools: AiToolDefinition[] = [capacityTool]
export default aiTools
