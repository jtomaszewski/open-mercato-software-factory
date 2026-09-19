import type { EntityManager } from '@mikro-orm/postgresql'
import { RepositoryBrokerReplay } from '../../data/entities'
import { verifyBrokerCallbackSignature } from '../../lib/broker'

export async function authenticateAndClaimBrokerRequest(request: Request, rawBody: string, em: EntityManager): Promise<boolean> {
  const verified = verifyBrokerCallbackSignature({ request, rawBody })
  if (!verified) return false
  em.persist(em.create(RepositoryBrokerReplay, { direction: 'callback', requestId: verified.requestId, keyId: verified.keyId }))
  await em.flush()
  return true
}
