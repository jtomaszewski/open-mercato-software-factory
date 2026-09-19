import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

// Items the demo sidebar (lib/demoSidebar.ts) moves: a role default can hide and relabel items,
// not move them between groups, so the originals are hidden there and re-added here.
const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'demo_fixtures.injection.demo-menu',
  },
  menuItems: [
    // The task board, top-level: its "My work" parent is hidden.
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
    // Sales reads Deals, Orders, Customers.
    {
      id: 'demo_fixtures-deals',
      labelKey: 'demo_fixtures.menu.deals',
      label: 'Deals',
      icon: 'briefcase',
      href: '/backend/customers/deals',
      features: ['customers.deals.view'],
      groupId: 'customers~sales.nav.group',
      placement: { position: InjectionPosition.First },
    },
    {
      id: 'demo_fixtures-customers',
      labelKey: 'demo_fixtures.menu.customers',
      label: 'Customers',
      icon: 'building2',
      href: '/backend/customers/companies',
      features: ['customers.companies.view'],
      groupId: 'customers~sales.nav.group',
      placement: { position: InjectionPosition.Last },
    },
  ],
}

export default widget
