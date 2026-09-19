import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { CodeRepository, RepositoryConnection } from '../../../data/entities'
import { qualificationCallbackSchema } from '../../../data/validators'
import { canApplyQualificationCallback } from '../../../lib/qualification-fence'
import { authenticateAndClaimBrokerRequest } from '../auth'
import { readBoundedBrokerRequestBody, verifyBrokerCallbackSignature } from '../../../lib/broker'
import { queueRepositoryEventIntent, tryDeliverRepositoryEventIntent } from '../../../lib/event-outbox'

export const metadata = { POST: { requireAuth: false } }

export async function POST(request: Request) {
  const rawBody = await readBoundedBrokerRequestBody(request)
  if (rawBody === null) return Response.json({ error: 'payload_too_large' }, { status: 413 })
  if (!verifyBrokerCallbackSignature({ request, rawBody })) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const parsedJson: unknown = (() => { try { return JSON.parse(rawBody) } catch { return null } })()
  const parsed = qualificationCallbackSchema.safeParse(parsedJson)
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em').fork()
  let result: { authenticated: boolean; applied: boolean; eventIntent?: ReturnType<typeof queueRepositoryEventIntent> }
  try {
    result = await em.transactional(async (tx) => {
      if (!await authenticateAndClaimBrokerRequest(request, rawBody, tx)) return { authenticated: false, applied: false }
      const connection = await tx.findOne(RepositoryConnection, { installationId: parsed.data.installationId, deletedAt: null })
      if (!connection) return { authenticated: true, applied: false }
      const repository = await tx.findOne(
        CodeRepository,
        { id: parsed.data.repositoryId, tenantId: connection.tenantId, organizationId: connection.organizationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      )
      if (!repository || !canApplyQualificationCallback(repository, { connectionId: connection.id, epoch: parsed.data.epoch, attemptId: parsed.data.attemptId })) {
        return { authenticated: true, applied: false }
      }
      repository.qualificationStatus = parsed.data.status
      repository.qualificationEpoch = parsed.data.epoch
      repository.qualificationReport = parsed.data.report
      const eventIntent = queueRepositoryEventIntent(tx, 'repositories.repository.qualified', {
        repositoryId: repository.id,
        status: repository.qualificationStatus,
        tenantId: connection.tenantId,
        organizationId: connection.organizationId,
      })
      await tx.flush()
      return { authenticated: true, applied: true, eventIntent }
    })
  } catch (error) {
    if (isUniqueViolation(error, 'repositories_broker_replays_direction_request_uq')) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw error
  }
  if (!result.authenticated) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (result.eventIntent) await tryDeliverRepositoryEventIntent(em.fork(), result.eventIntent)
  return Response.json({ applied: result.applied })
}
