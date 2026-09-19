import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureWebsiteChangeProcess } from './lib/workflow'

export const setup: ModuleSetupConfig = {
  // Structural, not demo data: every tenant gets the process a delegation to the Software Engineer starts.
  async seedDefaults({ container, tenantId, organizationId }) {
    await ensureWebsiteChangeProcess(container, { tenantId, organizationId })
  },
}

export default setup
