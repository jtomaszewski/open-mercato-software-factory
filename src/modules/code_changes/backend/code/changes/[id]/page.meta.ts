export const metadata = {
  requireAuth: true,
  requireFeatures: ['task_delegation.view'],
  pageTitle: 'Change request',
  pageTitleKey: 'code_changes.changeRequests.detail.title',
  pageGroup: 'Code',
  pageGroupKey: 'backend.nav.code',
  navHidden: true,
  breadcrumb: [
    { label: 'Code changes', labelKey: 'code_changes.changeRequests.nav.title', href: '/backend/code/changes' },
    { label: 'Change request', labelKey: 'code_changes.changeRequests.detail.title' },
  ],
}

export default metadata
