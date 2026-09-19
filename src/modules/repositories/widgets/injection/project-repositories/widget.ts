import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ProjectRepositories from './widget.client'

const widget: InjectionWidgetModule<{ projectId?: string | null }> = {
  metadata: {
    id: 'repositories.injection.project-repositories',
    title: 'repositories.projectLinks.tab',
    features: ['repositories.link'],
    requiredModules: ['staff'],
    priority: 20,
  },
  Widget: ProjectRepositories,
}

export default widget
