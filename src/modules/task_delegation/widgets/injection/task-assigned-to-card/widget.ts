import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TaskAssignedToCard from './widget.client'
const widget: InjectionWidgetModule<{ taskId?: string }> = {
  metadata: { id: 'task_delegation.injection.task-assigned-to-card', title: 'task_delegation.assign.title', features: ['task_delegation.view'], requiredModules: ['staff'], priority: 40 },
  Widget: TaskAssignedToCard,
}
export default widget
