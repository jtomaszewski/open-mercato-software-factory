import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { readTimeTrackingSettings } from '@open-mercato/core/modules/staff/lib/time-tracking/settings'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export type RbacServiceLike = {
  userHasAllFeatures(userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }): Promise<boolean>
}

export type TaskScope = { tenantId: string; organizationId: string; userId: string }

export async function requireTaskScope(ctx: CommandRuntimeContext): Promise<TaskScope> {
  const { translate } = await resolveTranslations()
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const userId = ctx.auth?.sub ?? null
  if (!tenantId || !organizationId || !userId) {
    throw new CrudHttpError(403, { code: 'scope_required', error: translate('tasks.errors.scopeRequired', 'Tenant and organization scope are required.') })
  }
  if (ctx.organizationIds && !ctx.organizationIds.includes(organizationId)) {
    throw new CrudHttpError(403, { code: 'scope_required', error: translate('tasks.errors.scopeUnavailable', 'Organization scope is not available.') })
  }
  return { tenantId, organizationId, userId }
}

export async function requireFeature(ctx: CommandRuntimeContext, feature: string): Promise<TaskScope> {
  const scope = await requireTaskScope(ctx)
  let rbac: RbacServiceLike
  try {
    rbac = ctx.container.resolve<RbacServiceLike>('rbacService')
  } catch {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(403, { code: 'forbidden', error: translate('tasks.errors.permissionUnavailable', 'Permission could not be verified.') })
  }
  if (!await rbac.userHasAllFeatures(scope.userId, [feature], scope)) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(403, { code: 'forbidden', error: translate('tasks.errors.forbidden', 'Permission denied.') })
  }
  return scope
}

export async function hasFeature(ctx: CommandRuntimeContext, feature: string): Promise<boolean> {
  try {
    const scope = await requireTaskScope(ctx)
    const rbac = ctx.container.resolve<RbacServiceLike>('rbacService')
    return await rbac.userHasAllFeatures(scope.userId, [feature], scope)
  } catch {
    return false
  }
}

export async function readTaskAssignmentGraceDays(ctx: CommandRuntimeContext, tenantId: string): Promise<number> {
  const config = ctx.container.resolve<ModuleConfigService>('moduleConfigService')
  const settings = await readTimeTrackingSettings(config, { tenantId })
  return settings.access.assignmentGraceDays
}
