import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { WorkflowDefinition, WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { resolveWorkflowDefinitionExecutionUserId } from '@open-mercato/core/modules/workflows/lib/definition-grant'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { TaskDelegation } from '../data/entities'
import { requireFeature } from './auth'

type ProcessAuthorityInput = {
  taskId: string
  delegationId: string
  processInstanceId: string
}

export type ProcessAuthority = {
  delegation: TaskDelegation | null
  process: ProcessInstance
  workflowInstance: WorkflowInstance
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

async function forbidden(): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(403, {
    code: 'workflow_principal_required',
    error: translate('tasks.errors.workflowPrincipalRequired', 'The persisted workflow execution principal is required.'),
  })
}

export async function requireProcessAuthority(
  ctx: CommandRuntimeContext,
  input: ProcessAuthorityInput,
): Promise<ProcessAuthority> {
  const scope = await requireFeature(ctx, 'tasks.process')
  const em = ctx.transactionalEm
  if (!em) throw new Error('[internal] Tasks process command requires a managed transaction')
  const decryptScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const process = await findOneWithDecryption(em, ProcessInstance, {
    ...decryptScope,
    id: input.processInstanceId,
    sourceEntityType: 'staff:staff_time_task',
    sourceEntityId: input.taskId,
    deletedAt: null,
  }, {}, decryptScope)
  const processInput = record(process?.input)
  if (!process?.workflowInstanceId
    || processInput?.taskId !== input.taskId
    || processInput?.delegationId !== input.delegationId) throw await forbidden()

  const workflowInstance = await findOneWithDecryption(em, WorkflowInstance, {
    ...decryptScope,
    id: process.workflowInstanceId,
    deletedAt: null,
  }, {}, decryptScope)
  if (!workflowInstance) throw await forbidden()
  const definition = await findOneWithDecryption(em, WorkflowDefinition, {
    ...decryptScope,
    id: workflowInstance.definitionId,
  }, {}, decryptScope)
  const fallbackUserId = workflowInstance.metadata?.initiatedBy ?? definition?.createdBy ?? null
  const executionUserId = await resolveWorkflowDefinitionExecutionUserId(em, definition, fallbackUserId)
  if (!executionUserId || executionUserId !== scope.userId) throw await forbidden()
  const user = await findOneWithDecryption(em, User, {
    ...decryptScope,
    id: executionUserId,
    deletedAt: null,
  }, {}, decryptScope)
  if (!user || user.kind === 'human') throw await forbidden()

  const delegation = await findOneWithDecryption(em, TaskDelegation, {
    ...decryptScope,
    id: input.delegationId,
    taskId: input.taskId,
    releasedAt: null,
  }, {}, decryptScope)
  if (delegation?.processInstanceId && delegation.processInstanceId !== process.id) {
    return { delegation: null, process, workflowInstance }
  }
  return { delegation, process, workflowInstance }
}
