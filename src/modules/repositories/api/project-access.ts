import type { EntityManager } from '@mikro-orm/postgresql'
import type { TimeTrackingAccessResolver } from '@open-mercato/core/modules/staff/di'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { readTimeTrackingSettings } from '@open-mercato/core/modules/staff/lib/time-tracking/settings'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { RepositoryRouteContext } from './route-context'

export async function requireRouteProjectAccess(context: RepositoryRouteContext, projectId: string): Promise<void> {
  const { commandContext, tenantId, organizationId, userId } = context
  const projects = await commandContext.container.resolve<QueryEngine>('queryEngine').query<{ id: string }>('staff:staff_time_project', {
    fields: ['id'], filters: { id: projectId }, page: { page: 1, pageSize: 1 }, tenantId, organizationId,
  })
  if (!projects.items[0]) throw new CrudHttpError(404, { code: 'project_not_found', error: 'repositories.errors.projectNotFound' })
  const canManageAll = await commandContext.container.resolve<{ userHasAllFeatures(id: string, features: string[], scope: { tenantId: string; organizationId: string }): Promise<boolean> }>('rbacService')
    .userHasAllFeatures(userId, ['staff.timesheets.projects.manage'], { tenantId, organizationId })
  const settings = await readTimeTrackingSettings(commandContext.container.resolve<ModuleConfigService>('moduleConfigService'), { tenantId })
  const access = await commandContext.container.resolve<TimeTrackingAccessResolver>('timeTrackingAccessResolver').resolveProjectAccess({
    em: commandContext.container.resolve<EntityManager>('em').fork(), tenantId, organizationId, userId, canManageAll,
    assignmentGraceDays: settings.access.assignmentGraceDays,
  })
  if (!access.canManageAll && !access.projectIds.includes(projectId)) {
    throw new CrudHttpError(403, { code: 'project_forbidden', error: 'repositories.errors.projectForbidden' })
  }
}
