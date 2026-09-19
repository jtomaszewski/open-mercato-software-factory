import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { GitHubAppError } from '../lib/github-app'
import { requireRepositoryScope } from '../lib/auth'

export type RepositoryRouteContext = {
  commandContext: CommandRuntimeContext
  tenantId: string
  organizationId: string
  userId: string
  userFeatures: string[]
}

export async function withRepositoryRoute(
  request: Request,
  features: string[],
  handler: (context: RepositoryRouteContext) => Promise<Response>,
): Promise<Response> {
  const auth = await getAuthFromRequest(request)
  if (!auth) return Response.json({ error: 'repositories.errors.unauthorized' }, { status: 401 })
  if (!auth.sub || !auth.tenantId) return Response.json({ error: 'repositories.errors.forbidden' }, { status: 403 })
  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = scope?.selectedId
  if (!organizationId || scope.selectionRejected || (scope.allowedIds && !scope.allowedIds.includes(organizationId))) {
    return Response.json({ error: 'repositories.errors.forbidden' }, { status: 403 })
  }
  const tenantId = scope.tenantId ?? auth.tenantId
  try {
    const commandContext: CommandRuntimeContext = {
      container,
      auth: { ...auth, tenantId, orgId: organizationId },
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      request,
    }
    await requireRepositoryScope(commandContext, features)
    const rbac = container.resolve<RbacService>('rbacService')
    return await handler({
      commandContext,
      tenantId,
      organizationId,
      userId: auth.sub,
      userFeatures: await rbac.getGrantedFeatures(auth.sub, { tenantId, organizationId }),
    })
  } catch (error) {
    if (isCrudHttpError(error)) return Response.json(error.body, { status: error.status })
    if (error instanceof z.ZodError) return Response.json({ error: 'repositories.errors.validation', fieldErrors: error.flatten().fieldErrors }, { status: 400 })
    if (error instanceof GitHubAppError) {
      const status = error.code === 'not_configured' ? 503 : error.code === 'consent_refused' ? 403 : error.code === 'not_granted' ? 422 : 502
      return Response.json({ code: error.code, error: `repositories.errors.github.${error.code}` }, { status })
    }
    throw error
  }
}
