import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentPrincipal, ProcessDefinition } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation } from '../data/entities'
import { emitTasksEvent } from '../events'

export const metadata = {
  event: 'tasks.task.delegated',
  persistent: true,
  id: 'tasks:start-factory',
}

export type TaskDelegatedPayload = {
  taskId?: string
  delegationId?: string
  agentId?: string
  delegatedBy?: string
  delegateUserId?: string
  tenantId?: string
  organizationId?: string
}

type SubscriberContext = {
  resolve: <T>(name: string) => T
  hasRegistration?: (name: string) => boolean
}

export default async function startFactory(payload: TaskDelegatedPayload, context: SubscriberContext): Promise<void> {
  if (payload.agentId !== 'factory') return
  const { taskId, delegationId, delegatedBy, delegateUserId, tenantId, organizationId } = payload
  if (!taskId || !delegationId || !delegatedBy || !delegateUserId || !tenantId || !organizationId) {
    throw new Error('[internal] Scoped task delegation payload required')
  }
  if (!context.hasRegistration?.('ProcessDefinition') || !context.hasRegistration?.('AgentPrincipal')) {
    throw new Error('[internal] factory orchestrator is unavailable')
  }
  const em = context.resolve<EntityManager>('em').fork()
  const scope = { tenantId, organizationId }
  const delegation = await findOneWithDecryption(em, TaskDelegation, {
    ...scope, id: delegationId, taskId, delegateUserId, releasedAt: null,
  }, {}, scope)
  if (!delegation) return
  const principal = await findOneWithDecryption(em, AgentPrincipal, {
    ...scope, userId: delegateUserId, agentDefinitionId: 'factory', enabled: true, deletedAt: null,
  }, {}, scope)
  if (!principal) return
  const definition = await findOneWithDecryption(em, ProcessDefinition, {
    ...scope, name: 'factory.deliver', enabled: true, deletedAt: null,
  }, {}, scope)
  if (!definition || !definition.triggers?.some((trigger) => trigger.kind === 'manual')) {
    throw new Error('[internal] factory.deliver is unavailable')
  }
  const commandContext: CommandRuntimeContext = {
    container: { resolve: context.resolve } as CommandRuntimeContext['container'],
    auth: { sub: delegatedBy, tenantId, orgId: organizationId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
  const started = await context.resolve<CommandBus>('commandBus').execute<Record<string, unknown>, { executionId: string }>('agent_orchestrator.processes.startExecution', {
    input: {
      tenantId,
      organizationId,
      processDefinitionId: definition.id,
      input: { taskId, delegationId },
      idempotencyKey: `task:${taskId}:${delegationId}`,
      sourceEntityType: 'staff:staff_time_task',
      sourceEntityId: taskId,
      triggeredBy: { kind: 'manual', ref: delegatedBy },
    },
    ctx: commandContext,
  })
  const current = await findOneWithDecryption(em, TaskDelegation, {
    ...scope, id: delegationId, taskId, delegateUserId,
  }, {}, scope)
  if (!current) return
  current.processInstanceId ??= started.result.executionId
  current.updatedAt = new Date()
  await em.flush()
  if (current.releasedAt) {
    await emitTasksEvent('tasks.task.undelegated', {
      taskId,
      delegationId,
      processInstanceId: started.result.executionId,
      tenantId,
      organizationId,
    }, { persistent: true, tenantId, organizationId })
  }
}
