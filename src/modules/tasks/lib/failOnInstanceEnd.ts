import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowDefinition, WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { resolveWorkflowDefinitionExecutionUserId } from '@open-mercato/core/modules/workflows/lib/definition-grant'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation } from '../data/entities'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export type WorkflowEndPayload = { id?: string; tenantId?: string; organizationId?: string; errorMessage?: string | null }
export type SubscriberContext = { resolve: <T>(name: string) => T }

export async function failDelegatedTask(payload: WorkflowEndPayload, context: SubscriberContext): Promise<void> {
  const { id: workflowInstanceId, tenantId, organizationId } = payload
  if (!workflowInstanceId || !tenantId || !organizationId) return
  const em = context.resolve<EntityManager>('em').fork()
  const scope = { tenantId, organizationId }
  const process = await findOneWithDecryption(em, ProcessInstance, { ...scope, workflowInstanceId, deletedAt: null }, {}, scope)
  if (!process) return
  const delegation = await findOneWithDecryption(em, TaskDelegation, { ...scope, processInstanceId: process.id, releasedAt: null }, {}, scope)
  if (!delegation) return
  const workflowInstance = await findOneWithDecryption(em, WorkflowInstance, { ...scope, id: workflowInstanceId, deletedAt: null }, {}, scope)
  if (!workflowInstance) return
  const definition = await findOneWithDecryption(em, WorkflowDefinition, { ...scope, id: workflowInstance.definitionId, deletedAt: null }, {}, scope)
  const executionUserId = await resolveWorkflowDefinitionExecutionUserId(em, definition, null)
  if (!executionUserId) throw new Error('[internal] Workflow execution principal is unavailable')
  const { translate } = await resolveTranslations()
  const commandContext: CommandRuntimeContext = {
    container: { resolve: context.resolve } as CommandRuntimeContext['container'],
    auth: { sub: executionUserId, tenantId, orgId: organizationId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
  await context.resolve<CommandBus>('commandBus').execute('tasks.task.set_status', {
    input: {
      taskId: delegation.taskId,
      delegationId: delegation.id,
      processInstanceId: process.id,
      stepId: `terminal:${workflowInstanceId}`,
      status: 'failed',
      reason: workflowInstance.errorMessage ?? payload.errorMessage ?? translate('tasks.errors.workflowEnded', 'Workflow ended before task completion.'),
    },
    ctx: commandContext,
  })
}
