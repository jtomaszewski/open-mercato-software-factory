import { describe, expect, it } from '@jest/globals'
import { backendRouteMetadata } from '@/.mercato/generated/backend-route-metadata.generated'
import { DEMO_SIDEBAR_VISIBLE_ITEMS, demoSidebarHiddenItems } from '../lib/demoSidebar'

describe('demoSidebarHiddenItems', () => {
  it('hides every static backend page except the visible ones', () => {
    const hidden = demoSidebarHiddenItems([
      { path: '/backend/catalog/products' },
      { path: '/backend/catalog/categories' },
      { pattern: '/backend/catalog/products/[id]' },
      { path: '/backend/staff/time-tracking' },
      { path: '/backend/staff/time-tracking' },
      { path: '/login' },
    ])
    expect(hidden).toEqual(['/backend/catalog/categories', '/backend/staff/time-tracking'])
  })

  it('keeps the visible items pointing at installed pages', () => {
    const paths = backendRouteMetadata.map((route) => route.pattern ?? route.path)
    // Caseload ships with the enterprise agents modules, which CI does not enable.
    const coreItems = DEMO_SIDEBAR_VISIBLE_ITEMS.filter((href) => href !== '/backend/caseload')
    for (const href of [...coreItems, '/backend/staff/time-tracking/board']) {
      expect(paths).toContain(href)
    }
    expect(demoSidebarHiddenItems(backendRouteMetadata)).toContain('/backend/staff/time-tracking')
  })
})
