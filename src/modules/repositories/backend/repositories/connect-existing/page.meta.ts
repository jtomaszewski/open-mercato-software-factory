export const metadata = {
  requireAuth: true,
  requireFeatures: ['repositories.manage'],
  pageTitle: 'Connect existing GitHub installation',
  pageTitleKey: 'repositories.connect.existingTitle',
  pageGroup: 'External systems',
  pageGroupKey: 'backend.nav.externalSystems',
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [
    { label: 'Code repositories', labelKey: 'repositories.nav.title', href: '/backend/repositories' },
    { label: 'Connect existing GitHub installation', labelKey: 'repositories.connect.existingTitle' },
  ],
}
