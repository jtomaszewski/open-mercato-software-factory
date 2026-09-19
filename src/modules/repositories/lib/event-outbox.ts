import { LockMode, type EntityManager } from '@mikro-orm/postgresql'
import { getGlobalEventBus } from '@open-mercato/shared/modules/events'
import { RepositoryEventIntent } from '../data/entities'
import { emitRepositoriesEvent } from '../events'

export type RepositoryEventId =
  | 'repositories.connection.connected'
  | 'repositories.connection.status_changed'
  | 'repositories.repository.registered'
  | 'repositories.repository.updated'
  | 'repositories.repository.qualified'
  | 'repositories.repository.status_changed'
  | 'repositories.project_link.changed'

export function queueRepositoryEventIntent(
  em: EntityManager,
  eventId: RepositoryEventId,
  payload: Record<string, unknown> & { tenantId: string; organizationId: string },
): RepositoryEventIntent {
  const intent = em.create(RepositoryEventIntent, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    eventId,
    payload,
  })
  em.persist(intent)
  return intent
}

export async function deliverRepositoryEventIntent(intent: RepositoryEventIntent): Promise<void> {
  if (!getGlobalEventBus()) throw new Error('[internal] Repository event bus is unavailable')
  await emitRepositoriesEvent(intent.eventId as RepositoryEventId, intent.payload, {
    persistent: true,
    tenantId: intent.tenantId,
    organizationId: intent.organizationId,
  })
}

export async function deliverAndMarkRepositoryEventIntent(em: EntityManager, intent: RepositoryEventIntent): Promise<void> {
  await deliverRepositoryEventIntent(intent)
  await em.transactional(async (tx) => {
    const current = await tx.findOne(RepositoryEventIntent, { id: intent.id, deliveredAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
    if (!current) return
    current.deliveredAt = new Date()
    await tx.flush()
  })
}

export async function tryDeliverRepositoryEventIntent(em: EntityManager, intent: RepositoryEventIntent): Promise<void> {
  try {
    await deliverAndMarkRepositoryEventIntent(em, intent)
  } catch {
    // The recovery worker will retry the durable intent.
  }
}
