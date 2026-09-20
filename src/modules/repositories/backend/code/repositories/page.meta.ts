export const metadata = {
  requireAuth: true,
  requireFeatures: ['repositories.view'],
  pageTitle: 'Repositories',
  pageTitleKey: 'repositories.nav.title',
  pageGroup: 'Code',
  pageGroupKey: 'backend.nav.code',
  pageOrder: 20,
  icon: 'git-branch',
  breadcrumb: [{ label: 'Repositories', labelKey: 'repositories.nav.title' }],
}

export default metadata
