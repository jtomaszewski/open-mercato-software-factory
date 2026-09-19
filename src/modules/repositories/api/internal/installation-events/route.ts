import { LockMode, type EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { CodeRepository, RepositoryConnection } from '../../../data/entities'
import { installationEventSchema } from '../../../data/validators'
import {
  REPOSITORY_BROKER,
  dispatchPersistedQualificationAttempt,
  queueFreshQualificationAttempt,
  type PersistedQualificationAttempt,
} from '../../../lib/qualification-dispatch'
import { readBoundedBrokerRequestBody, type RepositoryBroker } from '../../../lib/broker'
import { applyAuthoritativeProviderGrant, shouldRequalifyAfterProviderGrant } from '../../../lib/provider-state'
import { isRepositoryConnectionBindingCurrent, snapshotRepositoryConnectionBinding } from '../../../lib/installation-event-fence'
import { authenticateAndClaimBrokerRequest } from '../auth'
import { verifyBrokerCallbackSignature } from '../../../lib/broker'
import { queueRepositoryEventIntent, tryDeliverRepositoryEventIntent } from '../../../lib/event-outbox'

export const metadata = { POST: { requireAuth: false } }

export async function POST(request: Request) {
  const rawBody = await readBoundedBrokerRequestBody(request)
  if (rawBody === null) return Response.json({ error: 'payload_too_large' }, { status: 413 })
  if (!verifyBrokerCallbackSignature({ request, rawBody })) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const decoded: unknown = (() => { try { return JSON.parse(rawBody) } catch { return null } })()
  const parsed = installationEventSchema.safeParse(decoded)
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em').fork()
  const connection = await em.findOne(RepositoryConnection, { installationId: parsed.data.installationId, deletedAt: null })
  if (!connection) {
    try {
      const authenticated = await em.transactional((tx) => authenticateAndClaimBrokerRequest(request, rawBody, tx))
      if (!authenticated) return Response.json({ error: 'unauthorized' }, { status: 401 })
      return Response.json({ applied: false })
    } catch (error) {
      if (isUniqueViolation(error, 'repositories_broker_replays_direction_request_uq')) {
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      }
      throw error
    }
  }
  if (parsed.data.event === 'suspended' || parsed.data.event === 'removed') {
    const unavailableStatus = parsed.data.event
    let changed: { connection: RepositoryConnection; eventIntent: ReturnType<typeof queueRepositoryEventIntent> } | null
    try {
      changed = await em.transactional(async (tx) => {
        if (!await authenticateAndClaimBrokerRequest(request, rawBody, tx)) return null
        const currentConnection = await tx.findOne(RepositoryConnection, { id: connection.id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (!currentConnection) return null
        const repositories = await tx.find(CodeRepository, { connectionId: currentConnection.id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        currentConnection.status = unavailableStatus
        for (const repository of repositories) repository.accessStatus = 'unavailable'
        const eventIntent = queueRepositoryEventIntent(tx, 'repositories.connection.status_changed', {
          connectionId: currentConnection.id,
          status: currentConnection.status,
          tenantId: currentConnection.tenantId,
          organizationId: currentConnection.organizationId,
        })
        await tx.flush()
        return { connection: currentConnection, eventIntent }
      })
    } catch (error) {
      if (isUniqueViolation(error, 'repositories_broker_replays_direction_request_uq')) {
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      }
      throw error
    }
    if (!changed) return Response.json({ applied: false })
    await tryDeliverRepositoryEventIntent(em.fork(), changed.eventIntent)
    return Response.json({ applied: true })
  }
  const observedBinding = snapshotRepositoryConnectionBinding(connection)
  const broker = container.resolve<RepositoryBroker>(REPOSITORY_BROKER)
  const grant = await broker.refreshInstallation({ installationId: connection.installationId, authorizationId: connection.brokerAuthorizationId })
  let refreshed: { applied: boolean; attempts: PersistedQualificationAttempt[]; eventIntent?: ReturnType<typeof queueRepositoryEventIntent> }
  try {
    refreshed = await em.transactional(async (tx) => {
      if (!await authenticateAndClaimBrokerRequest(request, rawBody, tx)) return { applied: false as const, attempts: [] }
      const currentConnection = await tx.findOne(RepositoryConnection, { id: connection.id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!currentConnection || !isRepositoryConnectionBindingCurrent(currentConnection, observedBinding)) {
        return { applied: false as const, attempts: [] }
      }
      const repositories = await tx.find(CodeRepository, { connectionId: currentConnection.id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      const queued: PersistedQualificationAttempt[] = []
      for (const repository of repositories) {
        const granted = grant.repositories.find((item) => item.id === repository.githubRepositoryId) ?? null
        const previousAccessStatus = repository.accessStatus
        applyAuthoritativeProviderGrant(repository, granted)
        if (shouldRequalifyAfterProviderGrant(previousAccessStatus, repository.accessStatus)) {
          queued.push(queueFreshQualificationAttempt(tx, currentConnection, repository))
        }
      }
      currentConnection.status = 'active'
      currentConnection.accountLogin = grant.accountLogin
      const eventIntent = queueRepositoryEventIntent(tx, 'repositories.connection.status_changed', {
        connectionId: currentConnection.id,
        status: currentConnection.status,
        tenantId: currentConnection.tenantId,
        organizationId: currentConnection.organizationId,
      })
      await tx.flush()
      return { applied: true as const, attempts: queued, eventIntent }
    })
  } catch (error) {
    if (isUniqueViolation(error, 'repositories_broker_replays_direction_request_uq')) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw error
  }
  if (!refreshed.applied) return Response.json({ applied: false })
  let qualificationFailures = 0
  for (const attempt of refreshed.attempts) {
    try {
      await dispatchPersistedQualificationAttempt(broker, em.fork(), attempt)
    } catch {
      qualificationFailures += 1
    }
  }
  if (refreshed.eventIntent) await tryDeliverRepositoryEventIntent(em.fork(), refreshed.eventIntent)
  return Response.json({ applied: true, qualificationFailures })
}
