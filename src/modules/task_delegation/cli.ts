import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { seedTaskDelegationDemo } from './lib/demoSetup'
import { DEVELOPER_AGENT_DISPLAY_NAME } from './lib/agentIdentity'
import { renameAgentPrincipal, type RenameAgentResult } from './lib/renameAgent'

const USAGE = 'Usage: mercato task_delegation seed-demo --tenant <tenantId> --org <organizationId> [--admin <email>]'
const RENAME_USAGE = 'Usage: mercato task_delegation rename-agent --tenant <tenantId> --org <organizationId>'

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
      `Task delegation demo (org=${organizationId}): project WWW ${result.projectId}, ` +
        `staff member ${result.staffMemberId ?? 'skipped (no admin user)'}, ` +
        `${DEVELOPER_AGENT_DISPLAY_NAME} agent ${result.agentUserId ?? 'skipped (orchestrator disabled)'}`,
    )
  },
}

function describe(result: RenameAgentResult): string {
  switch (result.outcome) {
    case 'renamed':
      return `renamed ${result.previousName ?? '(unnamed)'} → ${DEVELOPER_AGENT_DISPLAY_NAME} (user ${result.userId})`
    case 'unchanged':
      return `nothing to do, already ${DEVELOPER_AGENT_DISPLAY_NAME} (user ${result.userId})`
    case 'not-provisioned':
      return 'nothing to do, no agent principal in this organization'
    case 'orchestrator-disabled':
      return 'nothing to do, orchestrator disabled'
  }
}

/**
 * Renames an already-provisioned agent principal (SPEC-008). `seed-demo` cannot do it: the
 * orchestrator writes the display name only when it creates the user, so a database seeded before
 * the rename keeps the old name however often setup is re-run.
 */
const renameAgent: ModuleCli = {
  command: 'rename-agent',
  async run(rest) {
    const tenantId = readFlag(rest, 'tenant', 'tenantId')
    const organizationId = readFlag(rest, 'org', 'organizationId')
    if (!tenantId || !organizationId) {
      console.error(RENAME_USAGE)
      return
    }
    const container = await createRequestContainer()
    const result = await renameAgentPrincipal(container, { tenantId, organizationId })
    console.log(`Task delegation agent (org=${organizationId}): ${describe(result)}`)
  },
}

export default [seedDemo, renameAgent]
