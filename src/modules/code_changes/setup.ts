import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  readEnabledWorkflowCommandIds,
  resolveWorkflowCommandConfigService,
  writeEnabledWorkflowCommandIds,
} from '@open-mercato/core/modules/workflows/lib/workflow-command-settings'
import { listWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import { CODE_CHANGES_WORKFLOW_COMMAND_IDS } from './workflows'

/**
 * `employee` sees change requests but cannot decide them: a board assignee needs to read what the
 * agent produced, and the merge stays with the roles an organisation trusts with its repositories.
 * Deciding is additionally gated on being the task's assignee at the call site.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['code_changes.*'],
    admin: ['code_changes.*'],
    employee: ['code_changes.view'],
  },
  seedDefaults: async ({ container, tenantId }) => {
    const config = resolveWorkflowCommandConfigService(container)
    if (!config) throw new Error('[internal] Workflow command settings are unavailable')
    const catalogue = listWorkflowSafeCommands()
    const stored = await readEnabledWorkflowCommandIds(config, tenantId)
    const baseline = stored ?? catalogue
      .filter((command) => command.defaultEnabled === true)
      .map((command) => command.commandId)
    await writeEnabledWorkflowCommandIds(config, tenantId, [...new Set([...baseline, ...CODE_CHANGES_WORKFLOW_COMMAND_IDS])])
  },
}

export default setup
