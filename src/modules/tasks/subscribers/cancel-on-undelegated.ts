import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'

export const metadata = {
  event: 'tasks.task.undelegated',
  persistent: true,
  id: 'tasks:cancel-on-undelegated',
}

export type TaskUndelegatedPayload = {
  processInstanceId?: string | null
  tenantId?: string
  organizationId?: string
}

type WorkflowExecutorLike = {
  completeWorkflow(
    em: EntityManager,
    container: AwilixContainer,
    instanceId: string,
    status: 'CANCELLED',
  ): Promise<void>
}

type SubscriberContext = {
  resolve: <T>(name: string) => T
  hasRegistration?: (name: string) => boolean
}

export default async function cancelOnUndelegated(
  payload: TaskUndelegatedPayload,
  context: SubscriberContext,
): Promise<void> {
  const { processInstanceId, tenantId, organizationId } = payload
  if (!processInstanceId || !tenantId || !organizationId) return
  if (!context.hasRegistration?.('ProcessInstance') || !context.hasRegistration?.('workflowExecutor')) return
  const em = context.resolve<EntityManager>('em').fork()
  const scope = { tenantId, organizationId }
  const process = await findOneWithDecryption(em, ProcessInstance, {
    ...scope, id: processInstanceId, deletedAt: null,
  }, {}, scope)
  if (!process?.workflowInstanceId) return
  const workflow = await findOneWithDecryption(em, WorkflowInstance, {
    ...scope, id: process.workflowInstanceId, deletedAt: null,
  }, {}, scope)
  if (!workflow || (workflow.status !== 'RUNNING' && workflow.status !== 'PAUSED')) return
  await context.resolve<WorkflowExecutorLike>('workflowExecutor').completeWorkflow(
    em,
    context as unknown as AwilixContainer,
    workflow.id,
    'CANCELLED',
  )
}
