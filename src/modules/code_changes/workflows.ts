import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

/**
 * The change-request commands a workflow may call as a step.
 *
 * Only the run's own three are offered. `approve` and `reject` are deliberately absent: both
 * require the caller to be the task's accountable assignee, which a workflow principal never is,
 * so offering them in the Studio would advertise a step that always fails. Autonomous approval
 * needs that assignee rule to become a policy first — see the README.
 */
export const CODE_CHANGES_WORKFLOW_COMMAND_IDS = [
  'code_changes.change_request.start',
  'code_changes.change_request.record_pull_request',
  'code_changes.change_request.mark_failed',
] as const

registerWorkflowSafeCommands([
  {
    commandId: 'code_changes.change_request.start',
    requiredFeatures: ['task_delegation.process'],
    labelKey: 'code_changes.workflow.startChangeRequest',
  },
  {
    commandId: 'code_changes.change_request.record_pull_request',
    requiredFeatures: ['task_delegation.process'],
    labelKey: 'code_changes.workflow.recordPullRequest',
  },
  {
    commandId: 'code_changes.change_request.mark_failed',
    requiredFeatures: ['task_delegation.process'],
    labelKey: 'code_changes.workflow.markFailed',
  },
])
