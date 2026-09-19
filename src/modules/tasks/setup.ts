import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  readEnabledWorkflowCommandIds,
  resolveWorkflowCommandConfigService,
  writeEnabledWorkflowCommandIds,
} from '@open-mercato/core/modules/workflows/lib/workflow-command-settings'
import { listWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import { TASKS_WORKFLOW_COMMAND_IDS } from './workflows'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['tasks.view', 'tasks.delegate'],
    admin: ['tasks.view', 'tasks.delegate'],
    employee: ['tasks.view', 'tasks.delegate'],
  },
  seedDefaults: async ({ container, tenantId }) => {
    const config = resolveWorkflowCommandConfigService(container)
    if (!config) throw new Error('[internal] Workflow command settings are unavailable')
    const catalogue = listWorkflowSafeCommands()
    const stored = await readEnabledWorkflowCommandIds(config, tenantId)
    const baseline = stored ?? catalogue
      .filter((command) => command.defaultEnabled === true)
      .map((command) => command.commandId)
    await writeEnabledWorkflowCommandIds(config, tenantId, [...new Set([...baseline, ...TASKS_WORKFLOW_COMMAND_IDS])])
  },
}

export default setup
