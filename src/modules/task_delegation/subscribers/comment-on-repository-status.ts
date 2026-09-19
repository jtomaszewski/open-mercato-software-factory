import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { TaskDelegation, TaskProcessWrite } from '../data/entities'

const COMMENT_COMMAND_ID = 'staff.timesheets.task_comments.create'
const DISABLED_COMMENT = 'The linked repository became unavailable because it was disabled. This delegation cannot publish until repository access is restored.'

export const metadata = {
  event: 'repositories.repository.status_changed',
  persistent: true,
  id: 'tasks:comment-on-repository-status',
}

export type RepositoryStatusChangedPayload = {
  repositoryId?: string
  status?: 'active' | 'disabled'
  tenantId?: string
  organizationId?: string
}

type SubscriberContext = {
  resolve: <T>(name: string) => T
  hasRegistration?: (name: string) => boolean
}

function processStepId(delegation: TaskDelegation, status: 'disabled'): string {
  return `repository-status:${delegation.id}:${status}:${delegation.repositoryConfigEpoch ?? 'unknown'}`
}

export default async function commentOnRepositoryStatus(
  payload: RepositoryStatusChangedPayload,
  context: SubscriberContext,
): Promise<void> {
  const { repositoryId, status, tenantId, organizationId } = payload
  if (!repositoryId || status !== 'disabled' || !tenantId || !organizationId) return

  const em = context.resolve<EntityManager>('em').fork()
  const delegations = await em.find(TaskDelegation, {
    tenantId,
    organizationId,
    repositoryId,
    releasedAt: null,
  })
  const commandBus = context.resolve<CommandBus>('commandBus')
  const commandContext: CommandRuntimeContext = {
    container: { resolve: context.resolve } as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    systemActor: true,
  }

  for (const delegation of delegations) {
    const processInstanceId = delegation.processInstanceId ?? delegation.id
    const stepId = processStepId(delegation, status)
    const identity = {
      tenantId,
      organizationId,
      taskId: delegation.taskId,
      processInstanceId,
      stepId,
    }
    const existing = await em.findOne(TaskProcessWrite, identity)
    if (existing) continue

    const created = await commandBus.execute<Record<string, unknown>, { commentId: string }>(COMMENT_COMMAND_ID, {
      input: {
        tenantId,
        organizationId,
        taskId: delegation.taskId,
        body: DISABLED_COMMENT,
      },
      ctx: commandContext,
    })
    em.persist(em.create(TaskProcessWrite, {
      ...identity,
      commandId: COMMENT_COMMAND_ID,
      result: created.result,
    }))
    try {
      await em.flush()
    } catch (error) {
      if (!isUniqueViolation(error, 'task_delegation_process_writes_step_uq')) throw error
    }
  }
}
