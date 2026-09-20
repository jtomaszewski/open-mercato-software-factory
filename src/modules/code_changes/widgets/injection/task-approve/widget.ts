import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TaskApprove from './widget.client'
const widget: InjectionWidgetModule<{ taskId?: string }> = {
  metadata: { id: 'code_changes.injection.task-approve', title: 'code_changes.approve.title', features: ['task_delegation.delegate', 'code_changes.decide'], requiredModules: ['staff', 'task_delegation'], priority: 10 },
  Widget: TaskApprove,
}
export default widget
