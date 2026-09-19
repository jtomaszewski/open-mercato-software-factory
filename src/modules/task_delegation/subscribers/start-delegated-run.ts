import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentPrincipal, ProcessDefinition } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation } from '../data/entities'
import { emitTaskDelegationEvent } from '../events'
import { findRosterEntry } from '../lib/agentRoster'
import { canResolve } from '../lib/subscriberServices'

export const metadata = {
  event: 'task_delegation.task.delegated',
  persistent: true,
  id: 'task_delegation:start-delegated-run',
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

export default async function startDelegatedRun(payload: TaskDelegatedPayload, context: SubscriberContext): Promise<void> {
  // The roster owns the role → process pair. An agent id no row names is not ours to start.
  const roster = findRosterEntry(payload.agentId)
  if (!roster) return
  const { taskId, delegationId, delegatedBy, delegateUserId, tenantId, organizationId } = payload
  if (!taskId || !delegationId || !delegatedBy || !delegateUserId || !tenantId || !organizationId) {
    throw new Error('[internal] Scoped task delegation payload required')
  }
  if (!canResolve(context, 'ProcessDefinition') || !canResolve(context, 'AgentPrincipal')) {
    throw new Error('[internal] the agent orchestrator is unavailable')
  }
  const em = context.resolve<EntityManager>('em').fork()
  const scope = { tenantId, organizationId }
  const delegation = await findOneWithDecryption(em, TaskDelegation, {
    ...scope, id: delegationId, taskId, delegateUserId, releasedAt: null,
  }, {}, scope)
  if (!delegation) return
  // `payload.agentId` rather than the roster's own id: a principal provisioned under a legacy
  // id still matches a roster entry, and this must find that principal, not its successor's id.
  const principal = await findOneWithDecryption(em, AgentPrincipal, {
    ...scope, userId: delegateUserId, agentDefinitionId: payload.agentId, enabled: true, deletedAt: null,
  }, {}, scope)
  if (!principal) return
  const definition = await findOneWithDecryption(em, ProcessDefinition, {
    ...scope, name: roster.processName, enabled: true, deletedAt: null,
  }, {}, scope)
  if (!definition || !definition.triggers?.some((trigger) => trigger.kind === 'manual')) {
    throw new Error(`[internal] ${roster.processName} is unavailable`)
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
    await emitTaskDelegationEvent('task_delegation.task.undelegated', {
      taskId,
      delegationId,
      processInstanceId: started.result.executionId,
      tenantId,
      organizationId,
    }, { persistent: true, tenantId, organizationId })
  }
}
