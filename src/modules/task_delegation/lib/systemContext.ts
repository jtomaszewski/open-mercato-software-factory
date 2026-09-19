import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export type TaskDelegationScope = { tenantId: string; organizationId: string }

/**
 * The command context the module's CLI steps run under: no signed-in user, so `systemActor` marks
 * the write as the platform's own rather than an administrator acting on someone's behalf, and the
 * scope is pinned to exactly the one organization the operator named.
 */
export function systemContext(container: AwilixContainer, scope: TaskDelegationScope): CommandRuntimeContext {
  return {
    container,
    auth: { sub: null, tenantId: scope.tenantId, orgId: scope.organizationId } as unknown as CommandRuntimeContext['auth'],
    systemActor: true,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}
