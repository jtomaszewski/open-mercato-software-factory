export const metadata = {
  requireAuth: true,
  requireFeatures: ['repositories.view'],
  pageTitle: 'Repositories',
  pageTitleKey: 'repositories.nav.title',
  pageGroup: 'Code',
  pageGroupKey: 'backend.nav.code',
  pageOrder: 20,
  icon: 'git-branch',
  // Reached from the Code section's tab bar, not from the sidebar: one Code entry, not two.
  navHidden: true,
  breadcrumb: [{ label: 'Repositories', labelKey: 'repositories.nav.title' }],
}

export default metadata
