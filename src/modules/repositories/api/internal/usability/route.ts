import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { usabilityQuerySchema } from '../../../data/validators'
import type { RepositoryTargetResolver } from '../../../lib/target-resolver'
import { authenticateAndClaimBrokerRequest } from '../auth'

export const metadata = { GET: { requireAuth: false } }

export async function GET(request: Request) {
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em').fork()
  const authenticated = await em.transactional((tx) => authenticateAndClaimBrokerRequest(request, '', tx))
  if (!authenticated) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = usabilityQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return Response.json({ usable: false, reason: 'binding_unavailable' })
  try {
    const target = await container.resolve<RepositoryTargetResolver>('repositoryTargetResolver').resolveDelegationTarget({
      delegationId: parsed.data.delegationId,
    })
    if (target.repositoryId !== parsed.data.repositoryId) return Response.json({ usable: false, reason: 'binding_unavailable' })
    if (target.configEpoch !== parsed.data.epoch || target.profileDigest !== parsed.data.profileDigest) {
      return Response.json({ usable: false, reason: 'repository_changed' })
    }
    if (target.installationId !== parsed.data.installationId
      || target.brokerAuthorizationId !== parsed.data.authorizationId
      || target.githubRepositoryId !== parsed.data.githubRepositoryId
      || target.baseBranch !== parsed.data.baseBranch) {
      return Response.json({ usable: false, reason: 'repository_changed' })
    }
    return Response.json({ usable: true })
  } catch (error) {
    if (!isCrudHttpError(error)) throw error
    const code = typeof error.body.code === 'string' ? error.body.code : 'binding_unavailable'
    const reason = code === 'repository_not_linked' ? 'repository_unlinked'
      : code === 'repository_changed' || code === 'repository_not_qualified' ? 'repository_changed'
      : code === 'repository_unavailable' ? 'repository_unavailable'
      : 'binding_unavailable'
    return Response.json({ usable: false, reason })
  }
}
