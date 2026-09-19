import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TaskDelegateBadge from './widget.client'
const widget: InjectionWidgetModule<{ taskId?: string }> = {
  metadata: { id: 'tasks.injection.task-delegate-badge', title: 'tasks.delegate.title', features: ['tasks.view'], requiredModules: ['staff'], priority: 50 },
  Widget: TaskDelegateBadge,
}
export default widget
