import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import BoardChrome from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'task_delegation.injection.board-chrome',
    title: 'task_delegation.assign.title',
    features: ['task_delegation.view'],
    requiredModules: ['staff'],
    priority: 90,
  },
  Widget: BoardChrome,
}
export default widget
