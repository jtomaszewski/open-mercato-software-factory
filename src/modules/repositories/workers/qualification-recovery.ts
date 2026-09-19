import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  REPOSITORY_BROKER,
  dispatchPersistedQualificationAttempt,
  persistedQualificationAttempt,
} from '../lib/qualification-dispatch'
import {
  CodeRepository,
  RepositoryConnection,
  RepositoryEventIntent,
  RepositoryQualificationDispatch,
} from '../data/entities'
import type { RepositoryBroker } from '../lib/broker'
import { deliverAndMarkRepositoryEventIntent } from '../lib/event-outbox'
import { REPOSITORIES_RECOVERY_QUEUE } from '../lib/recovery-queue'

export { REPOSITORIES_RECOVERY_QUEUE } from '../lib/recovery-queue'

const logger = createLogger('repositories').child({ component: 'qualification-recovery' })
const recoveryPayloadSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export const metadata: WorkerMeta = {
  queue: REPOSITORIES_RECOVERY_QUEUE,
  id: 'repositories:qualification-recovery',
  concurrency: 1,
  schedulerSafe: true,
  schedulerRequiredFeatures: ['repositories.manage'],
}

async function deliverPendingEvents(em: EntityManager, scope: z.infer<typeof recoveryPayloadSchema>): Promise<void> {
  const intents = await em.find(RepositoryEventIntent, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deliveredAt: null,
  }, { limit: 100, orderBy: { createdAt: 'asc' } })
  for (const intent of intents) {
    await deliverAndMarkRepositoryEventIntent(em, intent)
  }
}

async function retryPendingQualifications(
  em: EntityManager,
  broker: RepositoryBroker,
  scope: z.infer<typeof recoveryPayloadSchema>,
): Promise<void> {
  const repositories = await em.find(CodeRepository, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'active',
    accessStatus: 'granted',
    qualificationStatus: 'running',
    deletedAt: null,
  }, { limit: 100, orderBy: { qualificationStartedAt: 'asc' } })
  let dispatchError: unknown = null
  for (const repository of repositories) {
    if (!repository.qualificationAttemptId) continue
    const dispatch = await em.findOne(RepositoryQualificationDispatch, {
      repositoryId: repository.id,
      attemptId: repository.qualificationAttemptId,
      epoch: repository.configEpoch,
      status: { $in: ['pending', 'failed'] },
    })
    if (!dispatch) continue
    const connection = await em.findOne(RepositoryConnection, {
      id: repository.connectionId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'active',
      deletedAt: null,
    })
    if (!connection) continue
    try {
      await dispatchPersistedQualificationAttempt(
        broker,
        em.fork(),
        persistedQualificationAttempt(connection, repository, dispatch.attemptId),
      )
    } catch (error) {
      dispatchError ??= error
    }
  }
  if (dispatchError) throw dispatchError
}

export default async function handle(job: QueuedJob<Record<string, unknown>>, _ctx: JobContext): Promise<void> {
  const parsed = recoveryPayloadSchema.safeParse(job.payload)
  if (!parsed.success) throw new Error('[internal] Repository recovery received an invalid scope')
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em').fork()
  const broker = container.resolve<RepositoryBroker>(REPOSITORY_BROKER)
  let recoveryError: unknown = null
  try {
    await deliverPendingEvents(em, parsed.data)
  } catch (error) {
    recoveryError = error
    logger.warn('Repository event recovery will be retried', { err: error })
  }
  try {
    await retryPendingQualifications(em, broker, parsed.data)
  } catch (error) {
    recoveryError ??= error
    logger.warn('Repository qualification recovery will be retried', { err: error })
  }
  if (recoveryError) throw recoveryError
}
