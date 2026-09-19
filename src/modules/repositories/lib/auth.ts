import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export type RepositoryScope = { tenantId: string; organizationId: string; userId: string }

type RbacServiceLike = {
  userHasAllFeatures(userId: string, required: string[], scope: { tenantId: string; organizationId: string }): Promise<boolean>
}

export async function requireRepositoryScope(ctx: CommandRuntimeContext, feature: string | string[]): Promise<RepositoryScope> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const userId = ctx.auth?.sub ?? null
  if (!tenantId || !organizationId || !userId || (ctx.organizationIds && !ctx.organizationIds.includes(organizationId))) {
    throw new CrudHttpError(403, { code: 'scope_required', error: 'repositories.errors.scopeRequired' })
  }
  const rbac = ctx.container.resolve<RbacServiceLike>('rbacService')
  const requiredFeatures = Array.isArray(feature) ? feature : [feature]
  if (!await rbac.userHasAllFeatures(userId, requiredFeatures, { tenantId, organizationId })) {
    throw new CrudHttpError(403, { code: 'forbidden', error: 'repositories.errors.forbidden' })
  }
  if (ctx.runAs?.source === 'agent') {
    throw new CrudHttpError(403, { code: 'agent_forbidden', error: 'repositories.errors.agentForbidden' })
  }
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const actor = await em.findOne(User, { id: userId, tenantId, deletedAt: null }, { fields: ['id', 'kind'] })
  if (!actor || actor.kind === 'agent') {
    throw new CrudHttpError(403, { code: 'agent_forbidden', error: 'repositories.errors.agentForbidden' })
  }
  return { tenantId, organizationId, userId }
}
