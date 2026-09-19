import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TaskDelegateSidebar from './widget.client'
const widget: InjectionWidgetModule<{ taskId?: string }> = {
  metadata: { id: 'tasks.injection.task-delegate-sidebar', title: 'tasks.delegate.title', features: ['tasks.view'], requiredModules: ['staff'], priority: 50 },
  Widget: TaskDelegateSidebar,
}
export default widget
