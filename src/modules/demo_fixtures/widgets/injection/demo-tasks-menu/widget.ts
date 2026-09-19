import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

// The task board as a top-level item: the demo sidebar hides its "My work" parent (lib/demoSidebar.ts).
const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'demo_fixtures.injection.demo-tasks-menu',
  },
  menuItems: [
    {
      id: 'demo_fixtures-task-board',
      labelKey: 'demo_fixtures.menu.taskBoard',
      label: 'Tasks',
      icon: 'layers',
      href: '/backend/staff/time-tracking/board',
      features: ['staff.timesheets.tasks.view'],
      groupId: 'staff.time_tracking.nav.group',
      placement: { position: InjectionPosition.First },
    },
  ],
}

export default widget
