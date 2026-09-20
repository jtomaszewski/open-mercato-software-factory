export const metadata = {
  requireAuth: true,
  requireFeatures: ['code_changes.view'],
  pageTitle: 'Code changes',
  pageTitleKey: 'code_changes.changeRequests.nav.title',
  pageGroup: 'Code',
  pageGroupKey: 'backend.nav.code',
  pageOrder: 10,
  icon: 'git-pull-request-arrow',
  breadcrumb: [{ label: 'Code changes', labelKey: 'code_changes.changeRequests.nav.title' }],
}

export default metadata
