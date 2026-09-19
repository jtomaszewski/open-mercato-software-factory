import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { RepositoryConnectState } from '../../../data/entities'
import { connectionCompleteSchema, installationGrantSchema } from '../../../data/validators'
import { REPOSITORY_BROKER } from '../../../lib/qualification-dispatch'
import { stageVerifiedConnectionGrant } from '../../../lib/verified-connection-grant'
import { RepositoryBrokerError, sha256Hex, type RepositoryBroker } from '../../../lib/broker'
import { ConnectionConsentError, resolveConnectionConsent } from '../../../lib/connection-consent'
import { withRepositoryRoute } from '../../route-context'
import { repositoriesTag, repositoryErrorSchema } from '../../openapi'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['repositories.manage'] } }

export async function POST(request: Request) {
  return withRepositoryRoute(request, ['repositories.manage'], async ({ commandContext, tenantId, organizationId, userId }) => {
    const input = connectionCompleteSchema.parse(await readJsonSafe(request, {}))
    const em = commandContext.container.resolve<EntityManager>('em').fork()
    const state = await em.findOne(RepositoryConnectState, {
      tenantId,
      organizationId,
      userId,
      nonceHash: sha256Hex(input.state),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    })
    if (!state) return Response.json({ error: 'repositories.errors.connectionStateExpired' }, { status: 400 })
    let consent
    try {
      consent = resolveConnectionConsent(input, state.expectedInstallationId ?? null)
    } catch (error) {
      if (error instanceof ConnectionConsentError) {
        return Response.json({ error: `repositories.errors.${error.code}` }, { status: 400 })
      }
      throw error
    }
    if (consent.kind === 'waiting') return Response.json({ status: 'waiting' })
    const grant = await commandContext.container.resolve<RepositoryBroker>(REPOSITORY_BROKER).verifyInstallation({ installationId: consent.installationId, code: consent.code })
    if (grant.installationId !== consent.installationId) throw new RepositoryBrokerError('invalid_response')
    const verificationId = stageVerifiedConnectionGrant(grant)
    const bus = commandContext.container.resolve<CommandBus>('commandBus')
    const executed = await bus.execute('repositories.connection.complete', {
      input: { stateId: state.id, verificationId },
      ctx: commandContext,
    })
    return Response.json(executed.result, { status: 201 })
  })
}

export const openApi: OpenApiRouteDoc = { tag: repositoriesTag, summary: 'Complete GitHub App consent', methods: {
  POST: { summary: 'Verify OAuth consent and bind a GitHub installation', requestBody: { contentType: 'application/json', schema: connectionCompleteSchema }, responses: [{ status: 201, description: 'Installation connected', schema: z.object({ status: z.literal('connected'), connectionId: z.string().uuid(), grantedRepositories: installationGrantSchema.shape.repositories }) }, { status: 200, description: 'Waiting for organization owner approval', schema: z.object({ status: z.literal('waiting') }) }], errors: [{ status: 400, description: 'Expired or reused state', schema: repositoryErrorSchema }, { status: 409, description: 'Installation already bound', schema: repositoryErrorSchema }, { status: 502, description: 'Broker verification failed', schema: repositoryErrorSchema }] },
} }
