import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

// The published website the factory ships to (SPEC-005). Next inlines NEXT_PUBLIC_* at build time.
const SITE_URL = process.env.NEXT_PUBLIC_FACTORY_SITE_URL?.trim() || 'https://hackaton-stal-zbiorniki-landing.vercel.app'

const widget: InjectionMenuItemWidget = {
  metadata: { id: 'factory.injection.site-link' },
  menuItems: [
    {
      id: 'factory-site-link',
      labelKey: 'factory.siteLink.label',
      label: 'Website ↗',
      // Topbar hrefs render as in-app <Link>; an external site opens in a new tab instead.
      onClick: () => window.open(SITE_URL, '_blank', 'noopener,noreferrer'),
    },
  ],
}

export default widget
