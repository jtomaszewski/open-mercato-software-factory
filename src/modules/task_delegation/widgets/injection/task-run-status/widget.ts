import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TaskRunStatus from './widget.client'

const widget: InjectionWidgetModule<{ taskId?: string }> = {
  metadata: {
    id: 'task_delegation.injection.task-run-status',
    title: 'task_delegation.runBar.title',
    // Everyone who can see the task sees its state; only the actions are gated, inside the widget,
    // so a user without `task_delegation.delegate` reads why rather than meeting a dead control.
    features: ['task_delegation.view'],
    requiredModules: ['staff'],
    priority: 20,
  },
  Widget: TaskRunStatus,
}
export default widget
