import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { seedStalZbiornikiDemo } from './lib/stalZbiorniki'
import { seedTaskDelegationDemo } from '../task_delegation/lib/demoSetup'
import { FACTORY_AGENT_DISPLAY_NAME } from '../task_delegation/lib/agentIdentity'

const USAGE = 'Usage: mercato demo_fixtures seed-stal-zbiorniki --tenant <tenantId> --org <organizationId>'

function readFlag(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const [key, inline] = args[i]!.replace(/^--/, '').split('=', 2)
    if (!names.includes(key!)) continue
    return inline ?? args[i + 1]
  }
  return undefined
}

// For a demo instance initialised with `--no-examples`: seeds only the Stal-Zbiorniki
// demo data (catalog, the Park of Poland customer and its order, the DEMO task board), without
// core's furniture examples.
const seedDemo: ModuleCli = {
  command: 'seed-stal-zbiorniki',
  async run(rest) {
    const tenantId = readFlag(rest, 'tenant', 'tenantId')
    const organizationId = readFlag(rest, 'org', 'organizationId')
    if (!tenantId || !organizationId) {
      console.error(USAGE)
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const result = await seedStalZbiornikiDemo(em, container, { tenantId, organizationId })
    const created = (flag: boolean) => (flag ? 'created' : 'already present')
    console.log(
      `Stal-Zbiorniki (org=${organizationId}, tenant=${tenantId}): ${result.products} products created, ` +
        `customer Park of Poland ${created(result.customer)}, order SO-2026-0042 ${created(result.order)}`,
    )
    // The board scenes delegate tasks on the DEMO project to the `factory` agent (SPEC-004).
    const board = await seedTaskDelegationDemo(container, { tenantId, organizationId })
    console.log(`Task board: DEMO project ${board.projectId}, ${FACTORY_AGENT_DISPLAY_NAME} agent ${board.agentUserId ?? 'skipped (orchestrator disabled)'}`)
  },
}

export default [seedDemo]
