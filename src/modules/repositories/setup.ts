import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { REPOSITORIES_RECOVERY_QUEUE } from './lib/recovery-queue'

type SchedulerServiceLike = {
  register(registration: Record<string, unknown>): Promise<void>
}

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['repositories.*'],
    admin: ['repositories.*'],
  },
  async seedDefaults({ container, tenantId, organizationId }) {
    const schedulerService = container.resolve<SchedulerServiceLike>('schedulerService')
    await schedulerService.register({
      id: stableScheduleUuid(`repositories:recovery:${tenantId}:${organizationId}`),
      name: 'Repository recovery',
      description: 'Delivers repository events and retries pending qualification attempts.',
      scopeType: 'organization',
      tenantId,
      organizationId,
      scheduleType: 'interval',
      scheduleValue: '1m',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: REPOSITORIES_RECOVERY_QUEUE,
      targetPayload: { tenantId, organizationId },
      sourceType: 'module',
      sourceModule: 'repositories',
      isEnabled: true,
    })
  },
}

export default setup
