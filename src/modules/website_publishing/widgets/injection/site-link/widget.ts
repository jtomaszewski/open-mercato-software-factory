import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

// The published website the Developer agent's pull requests ship to (SPEC-005). Next inlines NEXT_PUBLIC_* at build time.
const SITE_URL = (process.env.NEXT_PUBLIC_WEBSITE_URL ?? process.env.NEXT_PUBLIC_FACTORY_SITE_URL)?.trim() || 'https://hackaton-stal-zbiorniki-landing.vercel.app'

const widget: InjectionMenuItemWidget = {
  metadata: { id: 'website_publishing.injection.site-link' },
  menuItems: [
    {
      id: 'website-publishing-site-link',
      labelKey: 'website_publishing.siteLink.label',
      label: 'Website ↗',
      // Topbar hrefs render as in-app <Link>; an external site opens in a new tab instead.
      onClick: () => window.open(SITE_URL, '_blank', 'noopener,noreferrer'),
    },
  ],
}

export default widget
