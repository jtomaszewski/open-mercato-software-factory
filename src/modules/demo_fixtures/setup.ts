import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedStalZbiornikiDemo } from './lib/stalZbiorniki'

export const setup: ModuleSetupConfig = {
  async seedExamples({ em, container, tenantId, organizationId }) {
    await seedStalZbiornikiDemo(em, container, { tenantId, organizationId })
  },
}

export default setup
