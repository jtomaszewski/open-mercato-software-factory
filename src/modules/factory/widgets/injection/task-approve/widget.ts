import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TaskApprove from './widget.client'
const widget: InjectionWidgetModule<{ taskId?: string }> = {
  metadata: { id: 'factory.injection.task-approve', title: 'factory.approve.title', features: ['task_delegation.delegate'], requiredModules: ['staff', 'task_delegation'], priority: 40 },
  Widget: TaskApprove,
}
export default widget
