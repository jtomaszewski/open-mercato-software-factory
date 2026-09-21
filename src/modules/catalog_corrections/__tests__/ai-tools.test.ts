import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { AiPendingAction } from '@open-mercato/ai-assistant/modules/ai_assistant/data/entities'
import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'

const PRODUCT_ID = '20f9c160-fc1c-4d5d-8d71-5fd1e6e4652e'
const version = new Date('2026-09-19T15:41:15.422Z')
const original = {
  id: PRODUCT_ID, tenantId: 'tenant-1', organizationId: 'org-1',
  title: 'Zbiornik dwupłaszczowy na olej napędowy 5000 l',
  description: 'Pojemność 5000 l. Stal S235JR. Dane fikcyjne.',
  metadata: { capacityLiters: 5000, material: 'S235JR', inStock: true },
  dimensions: null, updatedAt: version,
}
let product: typeof original | null = { ...original }
const findProduct = jest.fn<(...args: unknown[]) => Promise<typeof original | null>>(async () => product)
const run = jest.fn<(...args: unknown[]) => Promise<unknown>>()
let pending: AiPendingAction

// The approval helpers use the supplied definition; provider bootstrapping is outside this contract test.
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({ getAgent: () => undefined }))

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/data/repositories/AiPendingActionRepository', () => ({
  AiPendingActionRepository: class {
    async create(data: Record<string, unknown>, scope: Record<string, unknown>) {
      pending = { ...data, ...scope, id: 'pending-1', status: 'pending', expiresAt: new Date(Date.now() + 60000) } as unknown as AiPendingAction
      return pending
    }
    async setStatus(_id: string, status: string, _scope: unknown, extra: Record<string, unknown>) {
      Object.assign(pending, extra, { status })
      return pending
    }
  },
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findProduct(...args),
}))
jest.mock('@open-mercato/core/modules/catalog/data/entities', () => ({ CatalogProduct: class CatalogProduct {} }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }) }))
jest.mock('../../task_tools/lib/scoped-runner', () => ({ createScopedApiOperationRunner: () => ({ run }) }))
jest.mock('../../task_tools/lib/next-server-resolve-shim', () => ({ installNextServerResolveShim: () => false }))

import { executeTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-executor'
import { registerMcpTool, unregisterMcpTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry'
import aiTools from '../ai-tools'
import { aiAgentExtensions } from '../ai-agents'
import { prepareMutation } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/prepare-mutation'
import { runPendingActionRechecks } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/pending-action-recheck'
import { executePendingActionConfirm } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/pending-action-executor'
import { executePendingActionCancel } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/pending-action-cancel'

const ctx = {
  approvedPendingActionId: 'pending-1',
  tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1',
  userFeatures: ['catalog.products.view', 'catalog.products.manage'], isSuperAdmin: false,
  container: { resolve: () => ({ fork: () => ({}) }) },
} as unknown as McpToolContext

function tool(): AiToolDefinition {
  const found = aiTools.find((entry) => entry.name === 'catalog_corrections.correct_capacity')
  expect(found).toBeDefined()
  return found!
}

beforeEach(() => { product = { ...original, metadata: { ...original.metadata } }; jest.clearAllMocks() })

describe('capacity approval', () => {
  it('rejects direct shared-tool execution without a trusted approval', async () => {
    registerMcpTool(tool())
    run.mockResolvedValue({ success: true, statusCode: 200 })
    try {
      const result = await executeTool(tool().name, { productId: PRODUCT_ID, capacityLiters: 5200 }, { ...ctx, approvedPendingActionId: undefined })
      expect(result).toMatchObject({ success: false, error: 'Human approval is required before correcting capacity.' })
      expect(findProduct).not.toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
    } finally {
      unregisterMcpTool(tool().name)
    }
  })

  it('previews the stored capacity and matching copy without writing', async () => {
    expect(tool().isMutation).toBe(true)
    const preview = await tool().loadBeforeRecord!({ productId: PRODUCT_ID, capacityLiters: 5200 }, ctx)
    expect(preview).toMatchObject({
      recordId: PRODUCT_ID,
      recordVersion: version.toISOString(),
      before: { capacityLiters: 5000, title: original.title, description: original.description },
      after: {
        capacityLiters: 5200,
        title: 'Zbiornik dwupłaszczowy na olej napędowy 5200 l',
        description: 'Pojemność 5200 l. Stal S235JR. Dane fikcyjne.',
      },
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('writes capacity and copy together while preserving metadata and unrelated fields', async () => {
    run.mockImplementation(async () => {
      product = {
        ...original, title: original.title.replace('5000 l', '5200 l'),
        description: original.description.replace('5000 l', '5200 l'),
        metadata: { ...original.metadata, capacityLiters: 5200 },
      }
      return { success: true, statusCode: 200, data: { id: PRODUCT_ID } }
    })
    const result = await tool().handler({ productId: PRODUCT_ID, capacityLiters: 5200 }, ctx)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith({
      method: 'PUT', path: '/catalog/products', body: {
        id: PRODUCT_ID, tenantId: 'tenant-1', organizationId: 'org-1',
        title: original.title.replace('5000 l', '5200 l'),
        description: original.description.replace('5000 l', '5200 l'),
        metadata: { ...original.metadata, capacityLiters: 5200 },
      },
    })
    expect(result).toMatchObject({ recordId: PRODUCT_ID, before: { capacityLiters: 5000 }, after: { capacityLiters: 5200 } })
  })

  it.each(['tenantId', 'organizationId', 'userId'] as const)('refuses missing %s before reading or writing', async (key) => {
    await expect(tool().handler({ productId: PRODUCT_ID, capacityLiters: 5200 }, { ...ctx, [key]: null })).rejects.toThrow('required')
    expect(findProduct).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses insufficient permissions, but accepts the catalog wildcard', async () => {
    await expect(tool().loadBeforeRecord!({ productId: PRODUCT_ID, capacityLiters: 5200 }, { ...ctx, userFeatures: ['catalog.products.view'] })).rejects.toThrow('required')
    await expect(tool().loadBeforeRecord!({ productId: PRODUCT_ID, capacityLiters: 5200 }, { ...ctx, userFeatures: ['catalog.*'] })).resolves.toBeDefined()
  })

  it('reads only the product in the authenticated tenant and organization', async () => {
    product = null
    await expect(tool().handler({ productId: PRODUCT_ID, capacityLiters: 5200 }, ctx)).rejects.toThrow('not available')
    expect(findProduct).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      id: PRODUCT_ID, tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null,
    }, {}, { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(run).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])('rejects invalid capacity %s', async (capacityLiters) => {
    await expect(tool().handler({ productId: PRODUCT_ID, capacityLiters }, ctx)).rejects.toThrow()
    expect(findProduct).not.toHaveBeenCalled()
  })

  it('rejects model-supplied metadata and scope fields', async () => {
    await expect(tool().handler({ productId: PRODUCT_ID, capacityLiters: 5200, metadata: {}, organizationId: 'other' }, ctx)).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('changes litre quantities with grouping spaces without changing a SKU or another quantity', async () => {
    product = { ...original, title: 'ZDP-5000 5 000 l', description: '5\u00a0000 l; 5000 kg; 100 l; ZDP-5000' }
    const preview = await tool().loadBeforeRecord!({ productId: PRODUCT_ID, capacityLiters: 5200 }, ctx)
    expect(preview?.after).toMatchObject({ title: 'ZDP-5000 5200 l', description: '5200 l; 5000 kg; 100 l; ZDP-5000' })
  })

  it('surfaces a catalog failure without a successful result', async () => {
    run.mockResolvedValue({ success: false, error: 'Record changed', statusCode: 409 })
    await expect(tool().handler({ productId: PRODUCT_ID, capacityLiters: 5200 }, ctx)).rejects.toThrow('Record changed')
  })
})

describe('installed approval contract with the app tool', () => {
  const agent: AiAgentDefinition = {
    id: 'catalog.merchandising_assistant', moduleId: 'catalog', label: 'Catalog assistant', description: 'Test assistant',
    systemPrompt: '', executionMode: 'chat', readOnly: false, mutationPolicy: 'confirm-required',
    allowedTools: aiAgentExtensions[0].appendAllowedTools!,
  }
  const executionCtx = { ...ctx, tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }
  async function prepare() {
    return prepareMutation({ agent, tool: tool(), toolCallArgs: { productId: PRODUCT_ID, capacityLiters: 5200 } }, {
      ...executionCtx, features: ctx.userFeatures,
    })
  }
  const emitEvent = async () => {}

  it('creates the native preview with all three changes and does not execute the handler', async () => {
    const result = await prepare()
    expect(result.uiPart.componentId).toContain('mutation-preview-card')
    expect(result.pendingAction.fieldDiff).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'capacityLiters', before: 5000, after: 5200 }),
      expect.objectContaining({ field: 'title', before: original.title, after: original.title.replace('5000 l', '5200 l') }),
      expect.objectContaining({ field: 'description', before: original.description, after: original.description.replace('5000 l', '5200 l') }),
    ]))
    expect(run).not.toHaveBeenCalled()
    expect(aiAgentExtensions[0].targetAgentId).toBe(agent.id)
    expect(aiAgentExtensions[0].replaceAllowedTools).toBeUndefined()
  })

  it('refuses a stale proposal without calling the catalog writer', async () => {
    const { pendingAction: action } = await prepare()
    product = { ...original, updatedAt: new Date('2026-09-20T00:00:00Z') }
    expect(await runPendingActionRechecks({ action, agent, tool: tool(), ctx: executionCtx })).toMatchObject({ ok: false, code: 'stale_version' })
    expect(run).not.toHaveBeenCalled()
  })

  it('cancels the proposal without writing a product', async () => {
    const { pendingAction: action } = await prepare()
    expect(await executePendingActionCancel({ action, ctx: executionCtx, emitEvent })).toMatchObject({ status: 'cancelled' })
    expect(run).not.toHaveBeenCalled()
    expect(await runPendingActionRechecks({ action, agent, tool: tool(), ctx: executionCtx })).toMatchObject({ ok: false, code: 'invalid_status' })
  })

  it('executes the approved tool once and reports the persisted capacity', async () => {
    const { pendingAction: action } = await prepare()
    expect(await runPendingActionRechecks({ action, agent, tool: tool(), ctx: executionCtx })).toEqual({ ok: true })
    run.mockImplementation(async () => {
      product = { ...original, metadata: { ...original.metadata, capacityLiters: 5200 }, title: original.title.replace('5000 l', '5200 l'), description: original.description.replace('5000 l', '5200 l') }
      return { success: true, data: { id: PRODUCT_ID }, statusCode: 200 }
    })
    expect(await executePendingActionConfirm({ action, agent, tool: tool(), ctx: executionCtx, emitEvent })).toMatchObject({ ok: true, executionResult: { commandName: 'catalog.products.update', recordId: PRODUCT_ID } })
    expect(product?.metadata.capacityLiters).toBe(5200)
    await executePendingActionConfirm({ action, agent, tool: tool(), ctx: executionCtx, emitEvent })
    expect(run).toHaveBeenCalledTimes(1)
  })
})
