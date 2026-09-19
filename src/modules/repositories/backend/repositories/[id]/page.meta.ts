export const metadata = {
  requireAuth: true,
  requireFeatures: ['repositories.manage'],
  pageTitle: 'Repository',
  pageTitleKey: 'repositories.detail.title',
  pageGroup: 'External systems',
  pageGroupKey: 'backend.nav.externalSystems',
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [
    { label: 'Code repositories', labelKey: 'repositories.nav.title', href: '/backend/repositories' },
    { label: 'Repository', labelKey: 'repositories.detail.title' },
  ],
}
