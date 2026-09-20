import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { openProductTask } from './lib/board'
import { ensureWebsiteChangeProcess, WEBSITE_CHANGE_PROCESS } from './lib/workflow'

const USAGE = [
  'Usage:',
  '  mercato website_publishing publish-product --product <productId> --tenant <tenantId> --org <organizationId>',
  '  mercato website_publishing ensure-process --tenant <tenantId> --org <organizationId>',
  '',
  '  publish-product  puts the product on the WWW board as a task delegated to the Software Engineer (the workers run it).',
  `  ensure-process   creates ${WEBSITE_CHANGE_PROCESS} and its workflow for a tenant seeded before this module existed.`,
].join('\n')

function readFlag(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const [key, inline] = args[i]!.replace(/^--/, '').split('=', 2)
    if (!names.includes(key!)) continue
    return inline ?? args[i + 1]
  }
  return undefined
}

function readScope(rest: string[]): { tenantId: string; organizationId: string } | null {
  const tenantId = readFlag(rest, 'tenant', 'tenantId')
  const organizationId = readFlag(rest, 'org', 'organizationId')
  if (!tenantId || !organizationId) {
    console.error(USAGE)
    return null
  }
  return { tenantId, organizationId }
}

const publishProduct: ModuleCli = {
  command: 'publish-product',
  async run(rest) {
    const scope = readScope(rest)
    const productId = readFlag(rest, 'product', 'productId')
    if (!scope || !productId) {
      console.error(USAGE)
      return
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    const product = await em.findOne(CatalogProduct, { id: productId, ...scope, deletedAt: null })
    if (!product) {
      console.error(`Product ${productId} not found in org=${scope.organizationId}, tenant=${scope.tenantId}`)
      return
    }
    const result = await openProductTask(container, scope, { id: product.id, sku: product.sku ?? null, title: product.title }, {
      appUrl: process.env.APP_URL ?? null,
    })
    console.log(result.status === 'skipped'
      ? `Skipped (${result.reason}); run \`mercato task_delegation seed-demo\` and \`mercato website_publishing ensure-process\` first.`
      : `Task ${result.taskId} ${result.created ? 'created' : 'reused'}, ${result.status}; the workers run ${WEBSITE_CHANGE_PROCESS}.`)
  },
}

const ensureProcess: ModuleCli = {
  command: 'ensure-process',
  async run(rest) {
    const scope = readScope(rest)
    if (!scope) return
    const container = await createRequestContainer()
    const result = await ensureWebsiteChangeProcess(container, scope)
    console.log(`${WEBSITE_CHANGE_PROCESS} ${result.processDefinitionId} (workflow ${result.workflowDefinitionId}) ready for org=${scope.organizationId}`)
  },
}

const websitePublishingCli: ModuleCli[] = [publishProduct, ensureProcess]

export default websitePublishingCli
