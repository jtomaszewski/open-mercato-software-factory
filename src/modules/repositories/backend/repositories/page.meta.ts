export const metadata = {
  requireAuth: true,
  requireFeatures: ['repositories.view'],
  pageTitle: 'Code repositories',
  pageTitleKey: 'repositories.nav.title',
  pageGroup: 'External systems',
  pageGroupKey: 'backend.nav.externalSystems',
  pageOrder: 20,
  icon: 'git-branch',
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Code repositories', labelKey: 'repositories.nav.title' }],
}
