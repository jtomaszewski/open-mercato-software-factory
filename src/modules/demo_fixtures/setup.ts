import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedMetalZbiornikiDemo } from './lib/metalZbiorniki'

export const setup: ModuleSetupConfig = {
  async seedExamples({ em, container, tenantId, organizationId }) {
    await seedMetalZbiornikiDemo(em, container, { tenantId, organizationId })
  },
}

export default setup
