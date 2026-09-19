import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

export const TASKS_WORKFLOW_COMMAND_IDS = [
  'tasks.task.set_status',
  'tasks.task.link',
  'tasks.task.create_followup',
] as const

registerWorkflowSafeCommands([
  {
    commandId: 'tasks.task.set_status',
    requiredFeatures: ['tasks.process'],
    labelKey: 'tasks.workflow.setStatus',
  },
  {
    commandId: 'tasks.task.link',
    requiredFeatures: ['tasks.process'],
    labelKey: 'tasks.workflow.link',
  },
  {
    commandId: 'tasks.task.create_followup',
    requiredFeatures: ['tasks.process'],
    labelKey: 'tasks.workflow.createFollowup',
  },
])
