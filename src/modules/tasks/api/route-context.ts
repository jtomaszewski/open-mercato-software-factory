import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export type TaskRouteContext = {
  commandContext: CommandRuntimeContext
  userFeatures: string[]
  userId: string
  tenantId: string
  organizationId: string
}

export async function withTaskRoute(
  request: Request,
  features: string[],
  handler: (context: TaskRouteContext) => Promise<Response>,
): Promise<Response> {
  const { translate } = await resolveTranslations()
  const denied = (status: number) => Response.json({ error: translate('tasks.errors.forbidden') }, { status })
  const auth = await getAuthFromRequest(request)
  if (!auth) return denied(401)
  if (!auth.sub || !auth.tenantId) return denied(403)
  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = scope?.selectedId
  if (!organizationId || scope.selectionRejected || (scope.allowedIds && !scope.allowedIds.includes(organizationId))) return denied(403)
  const tenantId = scope.tenantId ?? auth.tenantId
  const rbac = container.resolve<RbacService>('rbacService')
  if (!await rbac.userHasAllFeatures(auth.sub, features, { tenantId, organizationId })) return denied(403)
  const granted = await rbac.getGrantedFeatures(auth.sub, { tenantId, organizationId })
  try {
    return await handler({
      commandContext: { container, auth: { ...auth, tenantId, orgId: organizationId }, organizationScope: scope, selectedOrganizationId: organizationId, organizationIds: [organizationId], request },
      userFeatures: granted,
      userId: auth.sub,
      tenantId,
      organizationId,
    })
  } catch (error) {
    if (isCrudHttpError(error)) return Response.json(error.body, { status: error.status })
    if (error instanceof z.ZodError) return Response.json({ error: translate('tasks.errors.validation'), fieldErrors: error.flatten().fieldErrors }, { status: 400 })
    throw error
  }
}
