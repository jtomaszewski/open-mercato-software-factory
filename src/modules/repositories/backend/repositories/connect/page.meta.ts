export const metadata = {
  requireAuth: true,
  requireFeatures: ['repositories.manage'],
  pageTitle: 'Connect GitHub',
  pageTitleKey: 'repositories.connect.title',
  pageGroup: 'External systems',
  pageGroupKey: 'backend.nav.externalSystems',
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [
    { label: 'Code repositories', labelKey: 'repositories.nav.title', href: '/backend/repositories' },
    { label: 'Connect GitHub', labelKey: 'repositories.connect.title' },
  ],
}
