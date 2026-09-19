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
      { path: '/backend/definitions/create', groupKey: 'workflows.module.name' },
      { path: '/login' },
    ])
    expect(hidden).toEqual(['/backend/catalog/categories', '/backend/staff/time-tracking'])
  })

  it('keeps the visible items pointing at installed pages', () => {
    const paths = backendRouteMetadata.map((route) => route.pattern ?? route.path)
    const injected = ['/backend/staff/time-tracking/board', '/backend/customers/deals', '/backend/customers/companies']
    for (const href of [...DEMO_SIDEBAR_VISIBLE_ITEMS, ...injected]) {
      expect(paths).toContain(href)
    }
    const hidden = demoSidebarHiddenItems(backendRouteMetadata)
    expect(hidden).toEqual(expect.arrayContaining(['/backend/staff/time-tracking', ...injected.slice(1)]))
  })
})
