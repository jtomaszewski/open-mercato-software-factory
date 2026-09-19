import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { seedTaskDelegationDemo } from './lib/demoSetup'

const USAGE = 'Usage: mercato task_delegation seed-demo --tenant <tenantId> --org <organizationId> [--admin <email>]'

function readFlag(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const [key, inline] = args[i]!.replace(/^--/, '').split('=', 2)
    if (!names.includes(key!)) continue
    return inline ?? args[i + 1]
  }
  return undefined
}

const seedDemo: ModuleCli = {
  command: 'seed-demo',
  async run(rest) {
    const tenantId = readFlag(rest, 'tenant', 'tenantId')
    const organizationId = readFlag(rest, 'org', 'organizationId')
    if (!tenantId || !organizationId) {
      console.error(USAGE)
      return
    }
    const container = await createRequestContainer()
    const result = await seedTaskDelegationDemo(container, { tenantId, organizationId }, { adminEmail: readFlag(rest, 'admin') })
    console.log(
      `Task delegation demo (org=${organizationId}): project DEMO ${result.projectId}, ` +
        `columns added: ${result.createdColumns.join(', ') || 'none'}, ` +
        `staff member ${result.staffMemberId ?? 'skipped (no admin user)'}, ` +
        `Software Engineer agent ${result.agentUserId ?? 'skipped (orchestrator disabled)'}`,
    )
  },
}

export default [seedDemo]
