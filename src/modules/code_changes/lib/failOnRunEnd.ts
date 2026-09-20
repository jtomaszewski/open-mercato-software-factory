import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { WorkflowDefinition, WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { resolveWorkflowDefinitionExecutionUserId } from '@open-mercato/core/modules/workflows/lib/definition-grant'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { ChangeRequest } from '../data/entities'

const logger = createLogger('code_changes').child({ component: 'fail-on-run-end' })

export type WorkflowEndPayload = { id?: string; tenantId?: string; organizationId?: string; errorMessage?: string | null }
export type SubscriberContext = { resolve: <T>(name: string) => T }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/**
 * Closes the change request of a run that ended without closing it itself.
 *
 * `closeOnFailure` in the workflow function handles the failures the function can see. It cannot
 * handle the ones that kill the function: a worker restart mid-run, a cancelled instance, an
 * engine-level failure. The task survives those — `task_delegation` listens for the same events
 * and moves it back to Backlog — but the change request used to sit at `generating` forever,
 * so the board said the work failed while the Code section still said it was being prepared.
 *
 * Deliberately tolerant of ordering: the delegation may already be released by the time this
 * runs, so the run is identified from the process instance's own input rather than from a live
 * delegation row.
 */
export async function failRunChangeRequest(payload: WorkflowEndPayload, context: SubscriberContext): Promise<void> {
  const { id: workflowInstanceId, tenantId, organizationId } = payload
  if (!workflowInstanceId || !tenantId || !organizationId) return
  const scope = { tenantId, organizationId }
  const em = context.resolve<EntityManager>('em').fork()

  const process = await findOneWithDecryption(em, ProcessInstance, { ...scope, workflowInstanceId, deletedAt: null }, {}, scope)
  if (!process) return
  const input = record(process.input)
  const taskId = typeof input?.taskId === 'string' ? input.taskId : null
  const delegationId = typeof input?.delegationId === 'string' ? input.delegationId : null
  if (!taskId || !delegationId) return

  // Only a change request still in flight: a decided one is history, and a run that ended after
  // its pull request opened leaves something a person can still act on.
  const changeRequest = await em.findOne(ChangeRequest, { ...scope, delegationId, status: 'generating', deletedAt: null })
  if (!changeRequest) return

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
  await context.resolve<CommandBus>('commandBus').execute('code_changes.change_request.mark_failed', {
    input: {
      taskId,
      delegationId,
      processInstanceId: process.id,
      reason: workflowInstance.errorMessage
        ?? payload.errorMessage
        ?? translate('code_changes.changeRequests.errors.runEnded', 'The run ended before the change was ready.'),
    },
    ctx: commandContext,
  })
  logger.info('closed the change request of a run that ended', { changeRequestId: changeRequest.id, workflowInstanceId })
}
