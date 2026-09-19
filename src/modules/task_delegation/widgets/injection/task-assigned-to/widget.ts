import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TaskAssignedToHeader from './widget.client'
const widget: InjectionWidgetModule<{ taskId?: string }> = {
  metadata: { id: 'task_delegation.injection.task-assigned-to', title: 'task_delegation.assign.title', features: ['task_delegation.view'], requiredModules: ['staff'], priority: 10 },
  Widget: TaskAssignedToHeader,
}
export default widget
